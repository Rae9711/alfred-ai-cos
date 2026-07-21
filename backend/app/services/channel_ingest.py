"""Shared inbound-message ingestion, one path for every non-Gmail channel.

SMS, forwarded email, and WhatsApp all reduce to the same shape: dedup on
(user_id, external_id), classify the sender, persist a Message, run extraction so the
inbox + ranker treat it like any other message. This module captures that common core
so each channel adapter only has to translate its wire payload into these arguments.

Gmail's own ``ingestion.py`` path is intentionally NOT routed through here — it has a
different sync/dedup model (per-account history cursors) and its own metric hooks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Commitment, Message, User
from app.services import extraction, sender_class


@dataclass
class ChannelIngestResult:
    message: Message
    message_id: str
    commitments_extracted: int
    deduped: bool


def ingest_channel_message(
    db: Session,
    *,
    user: User,
    source: str,
    external_id: str,
    sender: str,
    body: str,
    subject: str | None = None,
    thread_id: str | None = None,
    received_at: datetime | None = None,
    headers: dict[str, Any] | None = None,
) -> ChannelIngestResult:
    """Persist one inbound message and run extraction. Idempotent on
    (user_id, external_id): a repeat delivery returns the existing row with
    ``deduped=True`` and does not re-extract."""
    existing = db.scalar(
        select(Message).where(Message.user_id == user.id, Message.external_id == external_id)
    )
    if existing is not None:
        return ChannelIngestResult(
            message=existing, message_id=existing.id, commitments_extracted=0, deduped=True
        )

    snippet = (body or "")[:200]
    cls = sender_class.classify(
        sender=sender,
        subject=subject,
        snippet=snippet,
        headers=headers,
        user=user,
    )
    message = Message(
        user_id=user.id,
        source=source,
        external_id=external_id,
        thread_id=thread_id,
        sender=sender,
        recipients=[],
        subject=subject,
        snippet=snippet,
        sent_at=received_at or datetime.now(UTC),
        sender_classification=cls.cls,
        headers=headers or {},
    )
    db.add(message)
    db.flush()  # populate message.id before extraction reads it

    commitments: list[Commitment] = extraction.process_message(db, message, body=body)
    db.commit()
    return ChannelIngestResult(
        message=message,
        message_id=message.id,
        commitments_extracted=len(commitments),
        deduped=False,
    )
