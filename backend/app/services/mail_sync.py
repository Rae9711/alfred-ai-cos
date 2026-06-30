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
    db: Session,
    user_id: str,
    *,
    ingest_only: bool = False,
    incremental: bool = True,
    reclassify: bool = False,
) -> tuple[SyncIngestResult, int, int]:
    """Pull new Gmail; classify unless ingest_only (fast path for mobile refresh)."""
    result = ingestion.sync_messages(db, user_id, incremental=incremental)
    if ingest_only:
        processed = classify_pending_messages_sync(db, user_id, reclassify=reclassify)
        return result, processed, 0
    to_process = ingestion.messages_to_process(
        db, user_id, result.new_messages, reclassify=reclassify
    )
    commitments = 0
    for message in to_process:
        commitments += len(extraction.process_message(db, message, force_reclassify=reclassify))
    return result, len(to_process), commitments


def classify_pending_messages_sync(
    db: Session, user_id: str, *, limit: int = 30, reclassify: bool = False
) -> int:
    """Classify messages ingested without waiting for Celery."""
    processed = 0
    pending = ingestion.messages_pending_extraction(db, user_id)[:limit]
    if reclassify:
        extra = ingestion.messages_to_process(db, user_id, [], reclassify=True)[:limit]
        seen = {m.id for m in pending}
        pending = pending + [m for m in extra if m.id not in seen]
    for message in pending:
        extraction.process_message(db, message, force_reclassify=reclassify)
        processed += 1
    return processed


def notify_new_mail(
    db: Session,
    user: User,
    new_messages: list[Message],
    *,
    provider: NotificationProvider,
    now: datetime | None = None,
) -> bool:
    """Push only when fresh mail qualifies for the high-confidence needs-action tab.
    Generic new-mail and FYI arrivals are never pushed. Returns True if a push sent."""
    from app.services.inbox_view import (
        effective_inbox_category,
        message_qualifies_for_needs_action_tab,
        message_user_decided,
        user_replied_message_ids,
    )

    if not new_messages:
        return False
    now_dt = now or datetime.now(UTC)
    replied = user_replied_message_ids(db, user.id)
    enqueued = False
    for message in new_messages:
        if not message_qualifies_for_needs_action_tab(
            message,
            category=effective_inbox_category(message),
            user_replied=message.id in replied,
            user_decided=message_user_decided(message),
        ):
            continue
        sender = (message.sender or "").split("<")[0].strip() or "Someone"
        title = f"Needs action: {sender[:40]}"
        body = (message.subject or message.snippet or "Open your inbox")[:160]
        created = notifications.enqueue(
            db,
            user.id,
            ntype=NotificationType.needs_action_mail,
            title=title[:80],
            body=body,
            payload={"deep_link": "/inbox", "message_id": message.id},
            dedup_key=f"needs_action:{message.id}",
        )
        if created is not None:
            enqueued = True
    if not enqueued:
        return False
    result = notifications.dispatch_pending(
        db, user, now=now_dt.time(), provider=provider
    )
    return result["sent"] > 0


def sync_user_and_notify(
    db: Session,
    user: User,
    *,
    provider: NotificationProvider,
    notify: bool = True,
) -> dict[str, int]:
    """Background/API path: sync one user and push if needs-action mail arrived."""
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
