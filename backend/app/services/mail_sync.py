"""Sync Gmail for a user (ingest + classify) and optionally push on new mail."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.db.enums import NotificationType
from app.db.models import Message, User
from app.notifications import NotificationProvider
from app.services import extraction, ingestion, notifications
from app.services.ingestion import SyncIngestResult


def run_mail_sync(
    db: Session, user_id: str, *, ingest_only: bool = False, light: bool = False
) -> tuple[SyncIngestResult, int, int]:
    """Pull new Gmail; classify unless ingest_only (fast path for mobile refresh)."""
    result = ingestion.sync_messages(db, user_id, light=light)
    if ingest_only:
        return result, 0, 0
    to_process = ingestion.messages_to_process(db, user_id, result.new_messages)
    commitments = 0
    for message in to_process:
        commitments += len(extraction.process_message(db, message))
    return result, len(to_process), commitments


def notify_new_mail(
    db: Session,
    user: User,
    new_messages: list[Message],
    *,
    provider: NotificationProvider,
    now: datetime | None = None,
) -> bool:
    """Push when fresh mail arrived (not initial backfill). Returns True if a push sent."""
    if not new_messages:
        return False
    now_dt = now or datetime.now(UTC)
    count = len(new_messages)
    first = new_messages[0]
    sender = (first.sender or "").split("<")[0].strip() or "Someone"
    if count == 1:
        title = f"New mail from {sender[:40]}"
        body = (first.subject or first.snippet or "Open your inbox")[:160]
    else:
        title = f"{count} new emails"
        body = (first.subject or first.snippet or "Open your inbox")[:160]

    dedup_key = "mail:" + ":".join(sorted(m.id for m in new_messages))
    created = notifications.enqueue(
        db,
        user.id,
        ntype=NotificationType.new_mail,
        title=title[:80],
        body=body,
        payload={
            "deep_link": "/inbox",
            "message_id": first.id,
            "count": count,
        },
        dedup_key=dedup_key,
    )
    if created is None:
        return False
    result = notifications.dispatch_pending(db, user, now=now_dt.time(), provider=provider)
    return result["sent"] > 0


def sync_user_and_notify(
    db: Session,
    user: User,
    *,
    provider: NotificationProvider,
    notify: bool = True,
) -> dict[str, int]:
    """Background/API path: sync one user and push if new Primary mail arrived."""
    result, processed, commitments = run_mail_sync(db, user.id)
    pushed = 0
    if notify and result.new_messages and not result.initial_backfill:
        if notify_new_mail(db, user, result.new_messages, provider=provider):
            pushed = 1
    return {
        "ingested": len(result.new_messages),
        "pushed": pushed,
        "initial_backfill": int(result.initial_backfill),
        "processed": processed,
        "commitments_found": commitments,
    }
