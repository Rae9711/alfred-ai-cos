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
from app.services import forward_inbox

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
