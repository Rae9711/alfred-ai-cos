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
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Message, User
from app.services import extraction, sender_class

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

    existing = db.scalar(
        select(Message).where(Message.user_id == user.id, Message.external_id == external_id)
    )
    if existing is not None:
        return ForwardResult(message_id=existing.id, commitments_extracted=0, deduped=True)

    original_sender = _parse_original_sender(body) or forwarder_email
    snippet = (body or "")[:200]
    # Forwarded messages don't carry the original headers, so the classifier
    # works from the parsed sender + subject + snippet only. Still better than
    # leaving the column NULL.
    cls = sender_class.classify(
        sender=original_sender,
        subject=subject,
        snippet=snippet,
        headers=None,
        user=user,
    )
    message = Message(
        user_id=user.id,
        source="forwarded",
        external_id=external_id,
        thread_id=None,
        sender=original_sender,
        recipients=[forwarder_email],
        subject=subject,
        snippet=snippet,
        sent_at=received_at or datetime.now(UTC),
        sender_classification=cls.cls,
    )
    db.add(message)
    db.flush()  # populate message.id before extraction reads it

    commitments = extraction.process_message(db, message, body=body or "")
    db.commit()
    return ForwardResult(
        message_id=message.id,
        commitments_extracted=len(commitments),
        deduped=False,
    )
