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

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import get_db
from app.schemas.api import SmsIngestOut
from app.services import forward_inbox, sms_inbox, whatsapp_inbox
from app.services.sms_body import normalize_sms_body_text
from app.services.sms_inbox import UNKNOWN_SMS_SENDER, resolve_sms_sender_phone

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
        stripped = normalize_sms_body_text(value)
        return stripped or None
    if isinstance(value, dict):
        for key in (
            "text",
            "message",
            "body",
            "content",
            "value",
            "WFString",
            "string",
            "Message",
            "Text",
            "Contents",
        ):
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
    backfill: bool = Field(
        default=False,
        description="True when importing historical texts via the backfill shortcut",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_ios_shortcut_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        from_raw = _lookup(data, _FROM_ALIASES)
        phone = _coerce_phone(from_raw)
        body = _coerce_body(_lookup(data, _BODY_ALIASES))
        if not body:
            body = _fallback_body(data, phone)
        from_name = _coerce_optional_str(_lookup(data, _NAME_ALIASES))
        if not from_name and isinstance(from_raw, dict):
            for key in ("name", "fullName", "givenName", "displayName", "firstName"):
                from_name = _coerce_optional_str(from_raw.get(key))
                if from_name:
                    break
        backfill_raw = data.get("backfill")
        backfill = backfill_raw is True or (
            isinstance(backfill_raw, str) and backfill_raw.strip().lower() in {"1", "true", "yes"}
        )
        return {
            "from_number": resolve_sms_sender_phone(phone) if phone else UNKNOWN_SMS_SENDER,
            "body": normalize_sms_body_text(body) if body else body,
            "from_name": from_name,
            "message_id": _coerce_optional_str(data.get("message_id") or data.get("messageId")),
            "received_at": data.get("received_at") or data.get("receivedAt"),
            "backfill": backfill,
        }


@router.post("/sms", response_model=SmsIngestOut)
async def sms_inbox_webhook(
    request: Request,
    x_sms_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SmsIngestOut:
    if not x_sms_token:
        raise HTTPException(status_code=401, detail="Missing X-Sms-Token")
    user = sms_inbox.find_user_by_sms_token(db, x_sms_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid SMS token")

    raw_bytes = await request.body()
    data: Any
    try:
        data = json.loads(raw_bytes.decode("utf-8") if raw_bytes else "{}")
    except json.JSONDecodeError:
        text = raw_bytes.decode("utf-8", errors="replace").strip()
        if not text:
            raise HTTPException(status_code=400, detail="SMS body is required") from None
        data = {"body": text}

    if isinstance(data, dict) and not data:
        logger.warning(
            "SMS inbox empty JSON body user=%s — shortcut likely failed to pass message text",
            user.id,
        )
        raise HTTPException(
            status_code=400,
            detail="SMS body is required — re-import Alfred SMS Forward from You → SMS forwarding",
        )

    try:
        payload = SmsIn.model_validate(data)
    except Exception as exc:
        logger.warning(
            "SMS inbox payload validation failed user=%s errors=%s raw=%r",
            user.id,
            exc,
            raw_bytes[:500].decode("utf-8", errors="replace"),
        )
        raise

    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="SMS body is required")

    try:
        result = sms_inbox.ingest_sms(
            db,
            user=user,
            from_number=payload.from_number,
            body=payload.body,
            from_name=payload.from_name,
            message_id=payload.message_id,
            received_at=payload.received_at,
            backfill=payload.backfill,
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


class WhatsAppOut(BaseModel):
    ingested: int
    message_ids: list[str]


@router.get("/whatsapp")
def whatsapp_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
) -> PlainTextResponse:
    """Meta's one-time subscription handshake — echo the challenge on a token match."""
    settings = get_settings()
    if not settings.whatsapp_verify_token:
        raise HTTPException(status_code=503, detail="WhatsApp inbound is not configured")
    challenge = whatsapp_inbox.verify_challenge(
        verify_token=settings.whatsapp_verify_token,
        mode=hub_mode,
        token=hub_verify_token,
        challenge=hub_challenge,
    )
    if challenge is None:
        raise HTTPException(status_code=403, detail="Verification failed")
    return PlainTextResponse(content=challenge)


@router.post("/whatsapp", response_model=WhatsAppOut)
async def whatsapp_inbox_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> WhatsAppOut:
    settings = get_settings()
    if not settings.whatsapp_app_secret:
        raise HTTPException(status_code=503, detail="WhatsApp inbound is not configured")

    raw_bytes = await request.body()
    if not whatsapp_inbox.verify_signature(
        app_secret=settings.whatsapp_app_secret,
        raw_body=raw_bytes,
        signature_header=x_hub_signature_256,
    ):
        raise HTTPException(status_code=401, detail="Invalid WhatsApp signature")

    try:
        payload = json.loads(raw_bytes.decode("utf-8") if raw_bytes else "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Malformed JSON body") from exc

    message_ids: list[str] = []
    for inbound in whatsapp_inbox.parse_inbound(payload):
        user = whatsapp_inbox.find_whatsapp_user(db, inbound.business_phone_number_id)
        if user is None:
            # Meta retries on non-2xx; unknown recipients are dropped (acked) so a
            # misrouted number doesn't wedge the whole delivery in a retry loop.
            logger.warning(
                "WhatsApp inbound for unrecognised business number=%s",
                inbound.business_phone_number_id[:24],
            )
            continue
        message_ids.append(whatsapp_inbox.ingest_inbound(db, user=user, inbound=inbound))

    return WhatsAppOut(ingested=len(message_ids), message_ids=message_ids)
