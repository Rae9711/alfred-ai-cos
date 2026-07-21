"""Forward-to-inbox: turn an email forwarded to forward@in.alfredassistants.com
into a real Albert Message + extracted commitments.

The Cloudflare Email Worker parses the inbound RFC822 and POSTs a clean payload
to /api/v1/inbox/forward. This module owns the user-side: identify the user
from the forwarder address, dedup by original Message-ID, persist a Message, run
extraction so the inbox + ranker treat it like any other email.

Why match by forwarder address (not original sender):
  The user hit "Forward" in their client, so the message arrives From: them. We
  want the item to belong to THEM, not to whoever originally wrote the email.
  The original sender lives inside the body and is preserved for the ranker as
  the message's `sender` (best-effort parsed)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User
from app.services import channel_ingest

# Forwarded bodies typically start with "---------- Forwarded message ----------"
# followed by "From: ...", "Date: ...", etc. Pull the original sender out so the
# Message row's sender field reflects the actual author, not the forwarder.
_FWD_FROM_RE = re.compile(
    r"^\s*From:\s*(?:\"?([^<\"]+)\"?\s*)?<?([\w.+-]+@[\w-]+\.[\w.-]+)>?",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass
class ForwardResult:
    message_id: str
    commitments_extracted: int
    deduped: bool


def _parse_original_sender(body: str) -> str | None:
    """Best-effort extract the original 'From:' email from a forwarded body."""
    m = _FWD_FROM_RE.search(body or "")
    if not m:
        return None
    name, email = m.group(1), m.group(2)
    return f"{name.strip()} <{email}>" if name else email


def find_user_by_email(db: Session, email: str) -> User | None:
    """Lookup is case-insensitive — Gmail addresses are presented in many cases."""
    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    return db.scalar(select(User).where(User.email.ilike(normalized)))


def ingest_forward(
    db: Session,
    *,
    forwarder_email: str,
    subject: str | None,
    body: str,
    original_message_id: str | None,
    received_at: datetime | None = None,
) -> ForwardResult | None:
    """Create a Message + extract commitments from a forwarded email. Returns None
    when the forwarder isn't a registered user (the worker should drop). Idempotent
    on (user_id, external_id): re-forwarding the same message returns the existing
    one with deduped=True."""
    user = find_user_by_email(db, forwarder_email)
    if user is None:
        return None

    # Build a stable external_id. If the worker passed the original Message-ID,
    # use it; otherwise fall back to a content-derived key so two forwards of the
    # same body still dedup (subject + first 200 chars).
    if original_message_id:
        external_id = f"fwd:{original_message_id}"
    else:
        digest_src = f"{subject or ''}|{(body or '')[:200]}"
        external_id = f"fwd:{abs(hash(digest_src))}"

    # The original author lives inside the forwarded body; use it as the Message
    # sender so the ranker attributes the item to whoever actually wrote it.
    original_sender = _parse_original_sender(body) or forwarder_email
    result = channel_ingest.ingest_channel_message(
        db,
        user=user,
        source="forwarded",
        external_id=external_id,
        sender=original_sender,
        body=body or "",
        subject=subject,
        received_at=received_at,
    )
    return ForwardResult(
        message_id=result.message_id,
        commitments_extracted=result.commitments_extracted,
        deduped=result.deduped,
    )
