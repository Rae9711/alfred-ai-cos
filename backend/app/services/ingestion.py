"""Ingestion Agent (PRD 14.1, agent 1): pull recent Gmail messages, normalize,
deduplicate, and persist. Stores a snippet rather than the full body to limit
sensitive data at rest; the extraction pipeline uses the body in-process only.

Sync policy (per connected Gmail mailbox):
  - First connect (no gmail_history_id): backfill the newest Primary inbox messages.
  - All later syncs (default): Gmail history API for newly added mail only.
  - On expired history: fall back to a small recent Primary poll.
  - Label read/unread changes: history API label events (incremental).
  - Deep rescan (incremental=False): optional catchup/unread sweeps for repair.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.enums import MessageClassification, SyncStatus
from app.db.models import ConnectedAccount, Message, User
from app.services import gmail, sender_class
from app.services.connected_accounts import list_google_accounts
from app.services.crypto import decrypt_token, encrypt_token
from app.services.extraction import _EXTRACTION_BLOCKED_CLASSES
from app.services.gmail import HistoryExpiredError, use_gmail_credentials
from app.services.google_oauth import fresh_credentials
from app.services.inbox_filter import message_in_primary_inbox
from app.services.classification_adjust import subject_implies_action_required


@dataclass(frozen=True)
class SyncIngestResult:
    new_messages: list[Message]
    initial_backfill: bool


def _message_exists(db: Session, connected_account_id: str, external_id: str) -> bool:
    if (
        db.scalar(
            select(Message.id).where(
                Message.connected_account_id == connected_account_id,
                Message.external_id == external_id,
            )
        )
        is not None
    ):
        return True
    # Unflushed rows from an earlier ingest step in the same sync transaction.
    for pending in db.new:
        if (
            isinstance(pending, Message)
            and pending.connected_account_id == connected_account_id
            and pending.external_id == external_id
        ):
            return True
    return False


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
    seen_ids: set[str] = set()
    for message_id in message_ids:
        if message_id in seen_ids:
            continue
        seen_ids.add(message_id)
        if _message_exists(db, account.id, message_id):
            continue
        labels = gmail.get_message_label_ids(token, message_id)
        if not gmail.should_ingest_inbox_message(labels):
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
        is_updates_tab = "CATEGORY_UPDATES" in labels
        if cls.cls in _EXTRACTION_BLOCKED_CLASSES and not is_updates_tab:
            continue
        if sender_class.has_bulk_mail_headers(raw.get("headers")) and not is_updates_tab:
            continue
        message.sender_classification = cls.cls
        if subject_implies_action_required(
            subject=raw["subject"],
            snippet=raw["snippet"],
        ):
            message.action_required = True
            if cls.cls in _EXTRACTION_BLOCKED_CLASSES:
                message.classification = MessageClassification.needs_decision
        db.add(message)
        new_messages.append(message)
    return new_messages


def _refresh_gmail_labels(
    db: Session,
    account: ConnectedAccount,
    token: dict,
    *,
    limit: int = 40,
    priority_external_ids: list[str] | None = None,
) -> None:
    """Refresh Gmail labels (and sender class) for one mailbox."""
    user = db.get(User, account.user_id)
    priority_cap = 30
    capped_priority = list(priority_external_ids or [])[:priority_cap]
    unlabeled = list(
        db.scalars(
            select(Message)
            .where(
                Message.connected_account_id == account.id,
                Message.gmail_labels.is_(None),
            )
            .limit(15)
        )
    )
    recent = list(
        db.scalars(
            select(Message)
            .where(Message.connected_account_id == account.id)
            .order_by(Message.sent_at.desc().nullslast())
            .limit(min(limit, 25))
        )
    )
    priority_rows: list[Message] = []
    if capped_priority:
        priority_rows = list(
            db.scalars(
                select(Message).where(
                    Message.connected_account_id == account.id,
                    Message.external_id.in_(capped_priority),
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
            message.sender_classification = sender_class.classify_message(message, user=user).cls


def _sync_recent_primary_catchup(
    db: Session, account: ConnectedAccount, token: dict
) -> list[Message]:
    """Safety net: ingest any recent Primary mail missing from the local store."""
    settings = get_settings()
    recent_ids = gmail.list_recent_message_ids(
        token,
        max_results=settings.sync_recent_primary_max,
        inbox_tab="primary",
    )
    return _ingest_message_ids(db, account, token, recent_ids)


def _sync_unread_inbox(db: Session, account: ConnectedAccount, token: dict) -> list[Message]:
    """Ingest unread inbox mail before Gmail assigns CATEGORY_PERSONAL."""
    settings = get_settings()
    unread_ids = gmail.list_unread_inbox_message_ids(
        token, max_results=settings.sync_unread_max_results
    )
    return _ingest_message_ids(db, account, token, unread_ids)


def _sync_unread_primary(db: Session, account: ConnectedAccount, token: dict) -> list[Message]:
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
        affected, _latest = gmail.list_history_label_affected_message_ids(token, start_history_id)
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


def _sync_incremental_inbox_catchup(
    db: Session, account: ConnectedAccount, token: dict
) -> list[Message]:
    """Pick up new inbox mail History missed (only ids not already stored)."""
    settings = get_settings()
    recent_ids = gmail.list_recent_message_ids(
        token,
        max_results=settings.sync_incremental_catchup_max,
        inbox_tab="all",
    )
    return _ingest_message_ids(db, account, token, recent_ids)


def _sync_account(
    db: Session, account: ConnectedAccount, *, incremental: bool = True
) -> SyncIngestResult:
    settings = get_settings()
    stored_token = decrypt_token(account.token_ciphertext)
    creds, token = fresh_credentials(stored_token)

    # Clear stale "syncing" left by a crashed worker.
    if (
        account.sync_status == SyncStatus.syncing
        and account.last_synced_at
        and (datetime.now(UTC) - account.last_synced_at).total_seconds() > 600
    ):
        account.sync_status = SyncStatus.error
        account.sync_error = "Previous sync interrupted"
        db.commit()

    account.sync_status = SyncStatus.syncing
    db.commit()

    initial_backfill = account.gmail_history_id is None
    new_messages: list[Message] = []
    try:
        with use_gmail_credentials(creds):
            if initial_backfill:
                message_ids = gmail.list_recent_message_ids(
                    token,
                    max_results=settings.sync_initial_max_results,
                    inbox_tab="primary",
                )
                new_messages = _ingest_message_ids(db, account, token, message_ids)
            else:
                history_id = account.gmail_history_id
                assert history_id is not None
                try:
                    message_ids, _latest = gmail.list_history_added_message_ids(
                        token,
                        history_id,
                    )
                    new_messages = _ingest_message_ids(db, account, token, message_ids)
                except HistoryExpiredError:
                    message_ids = gmail.list_recent_message_ids(
                        token,
                        max_results=settings.sync_incremental_fallback_max,
                        inbox_tab="primary",
                    )
                    new_messages = _ingest_message_ids(db, account, token, message_ids)

            if incremental and not initial_backfill:
                new_messages.extend(_sync_incremental_inbox_catchup(db, account, token))

            if account.gmail_history_id:
                _apply_history_label_changes(db, account, token, account.gmail_history_id)

            if not incremental:
                catchup = _sync_recent_primary_catchup(db, account, token)
                unread_inbox = _sync_unread_inbox(db, account, token)
                unread_primary = _sync_unread_primary(db, account, token)
                new_messages.extend(catchup + unread_inbox + unread_primary)
                unread_ids = gmail.list_unread_primary_message_ids(
                    token, max_results=min(settings.sync_unread_max_results, 80)
                )
                _refresh_gmail_labels(db, account, token, priority_external_ids=unread_ids)

            account.gmail_history_id = gmail.get_history_id(token)

        account.sync_status = SyncStatus.ok
        account.last_synced_at = datetime.now(UTC)
        account.sync_error = None
        if token != stored_token:
            account.token_ciphertext = encrypt_token(token)
        db.commit()
    except Exception as exc:
        db.rollback()
        account.sync_status = SyncStatus.error
        account.sync_error = str(exc)[:500]
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
    db: Session,
    user_id: str,
    new_messages: list[Message],
    *,
    reclassify: bool = False,
    reclassify_limit: int = 25,
) -> list[Message]:
    """New ingest rows plus any previously unclassified messages."""
    seen = {m.id for m in new_messages}
    pending = [m for m in messages_pending_extraction(db, user_id) if m.id not in seen]
    if reclassify:
        recent = list(
            db.scalars(
                select(Message)
                .where(
                    Message.user_id == user_id,
                    Message.classification.is_not(None),
                    Message.source != "sms",
                )
                .order_by(Message.sent_at.desc().nullslast())
                .limit(reclassify_limit)
            )
        )
        for m in recent:
            if m.id not in seen and message_in_primary_inbox(m):
                pending.append(m)
                seen.add(m.id)
    return new_messages + pending


def sync_messages(db: Session, user_id: str, *, incremental: bool = True) -> SyncIngestResult:
    """Ingest new Gmail messages for every connected Google mailbox."""
    accounts = list_google_accounts(db, user_id)
    if not accounts:
        raise ValueError("No connected Google account for user")

    all_new: list[Message] = []
    any_initial = False
    errors: list[str] = []
    for account in accounts:
        try:
            result = _sync_account(db, account, incremental=incremental)
            all_new.extend(result.new_messages)
            any_initial = any_initial or result.initial_backfill
        except Exception as exc:
            db.rollback()
            account.sync_status = SyncStatus.error
            account.sync_error = str(exc)[:500]
            db.commit()
            label = account.provider_account_email or account.id
            errors.append(f"{label}: {exc}")
    if errors and not all_new and len(errors) == len(accounts):
        raise ValueError("; ".join(errors))
    return SyncIngestResult(new_messages=all_new, initial_backfill=any_initial)


def ingest_recent_messages(db: Session, user_id: str, *, max_results: int = 25) -> list[Message]:
    """Backward-compatible wrapper. Prefer sync_messages for production sync."""
    del max_results
    return sync_messages(db, user_id).new_messages
