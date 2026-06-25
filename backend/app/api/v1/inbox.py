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

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import get_db
from app.schemas.api import SmsIngestOut
from app.services import forward_inbox, sms_inbox

router = APIRouter(prefix="/inbox", tags=["inbox"])


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

    return SmsIngestOut(
        message_id=result.message_id,
        commitments_extracted=result.commitments_extracted,
        deduped=result.deduped,
        draft_created=result.draft_created,
    )
