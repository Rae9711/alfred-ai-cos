"""Ingestion Agent (PRD 14.1, agent 1): pull recent Gmail messages, normalize,
deduplicate, and persist. Stores a snippet rather than the full body to limit
sensitive data at rest; the extraction pipeline uses the body in-process only.

Sync policy (per connected Gmail mailbox):
  - First connect (no gmail_history_id): backfill the newest Primary inbox messages.
  - Later syncs: Gmail history API for new inbox mail, Primary tab only.
  - On expired history: fall back to a small recent Primary poll.
  - Inbox UI: only messages with CATEGORY_PERSONAL (+ INBOX) are stored/shown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.enums import SyncStatus
from app.db.models import ConnectedAccount, Message, User
from app.services import gmail, sender_class
from app.services.connected_accounts import list_google_accounts
from app.services.crypto import decrypt_token
from app.services.extraction import _EXTRACTION_BLOCKED_CLASSES
from app.services.gmail import HistoryExpiredError
from app.services.inbox_filter import message_in_primary_inbox


@dataclass(frozen=True)
class SyncIngestResult:
    new_messages: list[Message]
    initial_backfill: bool


def _message_exists(db: Session, connected_account_id: str, external_id: str) -> bool:
    return (
        db.scalar(
            select(Message.id).where(
                Message.connected_account_id == connected_account_id,
                Message.external_id == external_id,
            )
        )
        is not None
    )


def _ingest_message_ids(
    db: Session,
    account: ConnectedAccount,
    token: dict,
    message_ids: list[str],
) -> list[Message]:
    user = db.get(User, account.user_id)
    if user is None:
        raise ValueError("Missing user for ingestion")

    new_messages: list[Message] = []
    for message_id in message_ids:
        if _message_exists(db, account.id, message_id):
            continue
        labels = gmail.get_message_label_ids(token, message_id)
        if not gmail.is_primary_inbox(labels):
            continue
        raw = gmail.get_message(token, message_id)
        sent_at = None
        if raw.get("internal_date_ms"):
            sent_at = datetime.fromtimestamp(int(raw["internal_date_ms"]) / 1000, tz=UTC)
        message = Message(
            user_id=account.user_id,
            connected_account_id=account.id,
            source="gmail",
            external_id=raw["external_id"],
            thread_id=raw["thread_id"],
            sender=raw["sender"],
            recipients=raw["recipients"],
            subject=raw["subject"],
            snippet=raw["snippet"],
            sent_at=sent_at,
            headers=raw.get("headers") or {},
            gmail_labels=labels,
        )
        cls = sender_class.classify(
            sender=raw["sender"],
            subject=raw["subject"],
            snippet=raw["snippet"],
            headers=raw.get("headers") or {},
            user=user,
        )
        if cls.cls in _EXTRACTION_BLOCKED_CLASSES:
            continue
        if sender_class.has_bulk_mail_headers(raw.get("headers")):
            continue
        message.sender_classification = cls.cls
        db.add(message)
        new_messages.append(message)
    return new_messages


def _refresh_gmail_labels(
    db: Session,
    account: ConnectedAccount,
    token: dict,
    *,
    limit: int = 120,
    priority_external_ids: list[str] | None = None,
) -> None:
    """Refresh Gmail labels (and sender class) for one mailbox."""
    user = db.get(User, account.user_id)
    unlabeled = list(
        db.scalars(
            select(Message).where(
                Message.connected_account_id == account.id,
                Message.gmail_labels.is_(None),
            )
        )
    )
    recent = list(
        db.scalars(
            select(Message)
            .where(Message.connected_account_id == account.id)
            .order_by(Message.sent_at.desc().nullslast())
            .limit(limit)
        )
    )
    priority_rows: list[Message] = []
    if priority_external_ids:
        priority_rows = list(
            db.scalars(
                select(Message).where(
                    Message.connected_account_id == account.id,
                    Message.external_id.in_(priority_external_ids),
                )
            )
        )
    seen: set[str] = set()
    rows: list[Message] = []
    for message in priority_rows + unlabeled + recent:
        if message.id in seen:
            continue
        seen.add(message.id)
        rows.append(message)
    for message in rows:
        try:
            message.gmail_labels = gmail.get_message_label_ids(token, message.external_id)
        except Exception:
            continue
        if user is not None:
            message.sender_classification = sender_class.classify_message(
                message, user=user
            ).cls


def _sync_unread_primary(
    db: Session, account: ConnectedAccount, token: dict
) -> list[Message]:
    """Ingest any unread Primary mail missing from the local store."""
    settings = get_settings()
    unread_ids = gmail.list_unread_primary_message_ids(
        token, max_results=settings.sync_unread_max_results
    )
    return _ingest_message_ids(db, account, token, unread_ids)


def _apply_history_label_changes(
    db: Session, account: ConnectedAccount, token: dict, start_history_id: str
) -> None:
    """Refresh labels when the user reads/marks unread in Gmail."""
    try:
        affected, _latest = gmail.list_history_label_affected_message_ids(
            token, start_history_id
        )
    except HistoryExpiredError:
        return
    if not affected:
        return
    rows = list(
        db.scalars(
            select(Message).where(
                Message.connected_account_id == account.id,
                Message.external_id.in_(affected),
            )
        )
    )
    for message in rows:
        try:
            message.gmail_labels = gmail.get_message_label_ids(token, message.external_id)
        except Exception:
            continue


def _sync_account(db: Session, account: ConnectedAccount) -> SyncIngestResult:
    settings = get_settings()
    token = decrypt_token(account.token_ciphertext)
    account.sync_status = SyncStatus.syncing
    db.commit()

    initial_backfill = account.gmail_history_id is None
    new_messages: list[Message] = []
    user = db.get(User, account.user_id)
    try:
        if initial_backfill:
            message_ids = gmail.list_recent_message_ids(
                token,
                max_results=settings.sync_initial_max_results,
                inbox_tab="primary",
            )
            new_messages = _ingest_message_ids(db, account, token, message_ids)
        else:
            try:
                message_ids, _latest = gmail.list_history_added_message_ids(
                    token,
                    account.gmail_history_id,
                    label_id="INBOX",
                )
                new_messages = _ingest_message_ids(db, account, token, message_ids)
            except HistoryExpiredError:
                message_ids = gmail.list_recent_message_ids(
                    token,
                    max_results=settings.sync_incremental_fallback_max,
                    inbox_tab="primary",
                )
                new_messages = _ingest_message_ids(db, account, token, message_ids)

        unread_new = _sync_unread_primary(db, account, token)
        new_messages.extend(unread_new)

        if account.gmail_history_id:
            _apply_history_label_changes(db, account, token, account.gmail_history_id)

        unread_ids = gmail.list_unread_primary_message_ids(
            token, max_results=settings.sync_unread_max_results
        )
        _refresh_gmail_labels(db, account, token, priority_external_ids=unread_ids)
        account.gmail_history_id = gmail.get_history_id(token)
        account.sync_status = SyncStatus.ok
        account.last_synced_at = datetime.now(UTC)
        account.sync_error = None
        db.commit()
    except Exception as exc:
        account.sync_status = SyncStatus.error
        account.sync_error = str(exc)
        db.commit()
        raise
    return SyncIngestResult(new_messages=new_messages, initial_backfill=initial_backfill)


def messages_pending_extraction(db: Session, user_id: str) -> list[Message]:
    """Rows ingested earlier that never finished classification/extraction."""
    rows = list(
        db.scalars(
            select(Message).where(
                Message.user_id == user_id,
                Message.classification.is_(None),
                or_(
                    Message.sender_classification.is_(None),
                    Message.sender_classification.notin_(tuple(_EXTRACTION_BLOCKED_CLASSES)),
                ),
            )
        )
    )
    return [m for m in rows if message_in_primary_inbox(m)]


def messages_to_process(
    db: Session, user_id: str, new_messages: list[Message]
) -> list[Message]:
    """New ingest rows plus any previously unclassified messages."""
    seen = {m.id for m in new_messages}
    pending = [m for m in messages_pending_extraction(db, user_id) if m.id not in seen]
    return new_messages + pending


def sync_messages(db: Session, user_id: str) -> SyncIngestResult:
    """Ingest new Gmail messages for every connected Google mailbox."""
    accounts = list_google_accounts(db, user_id)
    if not accounts:
        raise ValueError("No connected Google account for user")

    all_new: list[Message] = []
    any_initial = False
    for account in accounts:
        result = _sync_account(db, account)
        all_new.extend(result.new_messages)
        any_initial = any_initial or result.initial_backfill
    return SyncIngestResult(new_messages=all_new, initial_backfill=any_initial)


def ingest_recent_messages(db: Session, user_id: str, *, max_results: int = 25) -> list[Message]:
    """Backward-compatible wrapper. Prefer sync_messages for production sync."""
    del max_results
    return sync_messages(db, user_id).new_messages
