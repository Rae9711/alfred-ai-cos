"""Forward-to-inbox webhook (feature F4).

Cloudflare Email Routing receives mail at forward@in.alfredassistants.com, the
Cloudflare Worker parses it, and POSTs a clean payload here. Auth is a shared
secret in X-Forward-Secret — there is no user session because the worker isn't
a human.

Security posture:
  - 503 when the secret is unset (feature disabled).
  - 401 when the secret doesn't match.
  - 404 when the forwarder address isn't a registered user. The worker drops
    silently rather than bouncing, so a non-user emailing the address gets no
    info about whether the system exists."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import get_db
from app.schemas.api import SmsIngestOut
from app.services import forward_inbox, sms_inbox

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inbox", tags=["inbox"])

_FROM_ALIASES = ("from_number", "fromNumber", "phone", "sender_phone", "sender")
_BODY_ALIASES = (
    "body",
    "text",
    "message",
    "content",
    "shortcut_input",
    "shortcutinput",
    "input",
    "message_body",
    "messagebody",
)
_NAME_ALIASES = ("from_name", "fromName", "name", "sender_name")
_SKIP_BODY_KEYS = frozenset(
    {
        *{a.lower() for a in _FROM_ALIASES},
        *{a.lower() for a in _NAME_ALIASES},
        "message_id",
        "messageid",
        "received_at",
        "receivedat",
    }
)


def _lookup(data: dict[str, Any], aliases: tuple[str, ...]) -> Any:
    lower_map = {k.lower(): k for k in data}
    for alias in aliases:
        key = lower_map.get(alias.lower())
        if key is not None:
            return data[key]
    return None


def _coerce_phone(value: Any) -> str | None:
    """Extract a phone-like string from iOS Shortcuts shapes (array, dict, number)."""
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    if isinstance(value, list):
        for item in value:
            coerced = _coerce_phone(item)
            if coerced:
                return coerced
        return None
    if isinstance(value, dict):
        for key in ("phone", "number", "phoneNumber", "Phone Number", "text", "value"):
            if key in value:
                coerced = _coerce_phone(value[key])
                if coerced:
                    return coerced
        for item in value.values():
            coerced = _coerce_phone(item)
            if coerced:
                return coerced
        return None
    text = str(value).strip()
    return text or None


def _coerce_body(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, dict):
        for key in ("text", "message", "body", "content", "value"):
            if key in value:
                coerced = _coerce_body(value[key])
                if coerced:
                    return coerced
        return None
    if isinstance(value, list):
        for item in value:
            coerced = _coerce_body(item)
            if coerced:
                return coerced
        return None
    text = str(value).strip()
    return text or None


def _coerce_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (list, dict)):
        return None
    text = str(value).strip()
    return text or None


def _fallback_body(data: dict[str, Any], phone: str | None) -> str | None:
    """Last resort when Shortcuts omits body but sends message text under another key."""
    for key, value in data.items():
        if key.lower() in _SKIP_BODY_KEYS:
            continue
        coerced = _coerce_body(value)
        if not coerced:
            continue
        if phone and coerced == phone:
            continue
        return coerced
    return None


class ForwardIn(BaseModel):
    """The parsed-email payload the Cloudflare Worker sends. Keep the schema small
    on purpose — anything we don't read here is wasted bytes through the worker."""

    forwarder: str = Field(description="The From: of the inbound email — i.e. the user")
    subject: str | None = None
    body: str = Field(description="Plain-text body, including the quoted original")
    original_message_id: str | None = Field(
        default=None, description="RFC822 Message-ID of the forwarded message (dedup key)"
    )
    received_at: datetime | None = None


class ForwardOut(BaseModel):
    message_id: str
    commitments_extracted: int
    deduped: bool


@router.post("/forward", response_model=ForwardOut)
def forward_inbox_webhook(
    payload: ForwardIn,
    x_forward_secret: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ForwardOut:
    settings = get_settings()
    if not settings.forward_inbox_secret:
        raise HTTPException(status_code=503, detail="Forward-to-inbox is not configured")
    if x_forward_secret != settings.forward_inbox_secret:
        raise HTTPException(status_code=401, detail="Invalid forward secret")

    result = forward_inbox.ingest_forward(
        db,
        forwarder_email=str(payload.forwarder),
        subject=payload.subject,
        body=payload.body,
        original_message_id=payload.original_message_id,
        received_at=payload.received_at,
    )
    if result is None:
        # 404 hides the user-existence signal — same response shape whether the
        # address is wrong or unregistered.
        raise HTTPException(status_code=404, detail="Forwarder not recognised")

    return ForwardOut(
        message_id=result.message_id,
        commitments_extracted=result.commitments_extracted,
        deduped=result.deduped,
    )


class SmsIn(BaseModel):
    """Payload from the user's iOS Shortcut when a new SMS arrives."""

    from_number: str = Field(description="Sender phone number")
    body: str = Field(description="SMS text")
    from_name: str | None = Field(default=None, description="Contact name if available")
    message_id: str | None = Field(
        default=None, description="Optional stable id from Shortcuts for dedup"
    )
    received_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_ios_shortcut_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        phone = _coerce_phone(_lookup(data, _FROM_ALIASES))
        body = _coerce_body(_lookup(data, _BODY_ALIASES))
        if not body:
            body = _fallback_body(data, phone)
        return {
            "from_number": phone,
            "body": body,
            "from_name": _coerce_optional_str(_lookup(data, _NAME_ALIASES)),
            "message_id": _coerce_optional_str(data.get("message_id") or data.get("messageId")),
            "received_at": data.get("received_at") or data.get("receivedAt"),
        }


@router.post("/sms", response_model=SmsIngestOut)
def sms_inbox_webhook(
    payload: SmsIn,
    x_sms_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SmsIngestOut:
    if not x_sms_token:
        raise HTTPException(status_code=401, detail="Missing X-Sms-Token")
    user = sms_inbox.find_user_by_sms_token(db, x_sms_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid SMS token")

    try:
        result = sms_inbox.ingest_sms(
            db,
            user=user,
            from_number=payload.from_number,
            body=payload.body,
            from_name=payload.from_name,
            message_id=payload.message_id,
            received_at=payload.received_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "SMS ingested user=%s from=%s deduped=%s message_id=%s",
        user.id,
        payload.from_number[:20],
        result.deduped,
        result.message_id,
    )

    return SmsIngestOut(
        message_id=result.message_id,
        commitments_extracted=result.commitments_extracted,
        deduped=result.deduped,
        draft_created=result.draft_created,
    )
