"""Build the mobile Inbox list: today's mail, read/replied state, category mapping."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification
from app.db.models import Message, OutboundReply, User
from app.services.classification_adjust import upgrade_human_misclassified_as_fyi

# Backend classification → the Inbox screen's four buckets (+ Processing while classifying).
CATEGORY_LABEL = {
    MessageClassification.needs_reply: "Needs Reply",
    MessageClassification.follow_up_needed: "Needs Reply",
    MessageClassification.needs_decision: "Needs Decision",
    MessageClassification.meeting_scheduling: "Needs Decision",
    MessageClassification.deadline: "Needs Decision",
    MessageClassification.waiting_for_response: "Waiting",
    MessageClassification.informational: "FYI",
    MessageClassification.low_priority: "FYI",
    MessageClassification.sensitive: "FYI",
}

_ACTION_CATEGORIES = frozenset({"Needs Reply", "Needs Decision"})
NEEDS_ACTION_WINDOW_DAYS = 14


def needs_action_cutoff_utc(*, now: datetime | None = None) -> datetime:
    """Oldest sent_at included in the needs-action inbox tab."""
    anchor = now or datetime.now(UTC)
    return anchor - timedelta(days=NEEDS_ACTION_WINDOW_DAYS)


def start_of_today_utc(timezone: str | None) -> datetime:
    """Midnight today in the user's timezone, as UTC."""
    try:
        tz = ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = UTC
    local_now = datetime.now(tz)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(UTC)


def is_gmail_unread(labels: list[str] | None) -> bool:
    """Gmail marks unread mail with the UNREAD label."""
    if labels is None:
        return True
    if not labels:
        return False
    return "UNREAD" in labels


def is_message_unread(message: Message) -> bool:
    if message.source == "sms":
        from app.services.sms_inbox import is_sms_unread

        return is_sms_unread(message)
    return is_gmail_unread(message.gmail_labels)


def user_replied_message_ids(db: Session, user_id: str) -> set[str]:
    rows = db.scalars(
        select(OutboundReply.source_message_id).where(OutboundReply.user_id == user_id)
    )
    return set(rows)


def category_for_message(classification: MessageClassification | None) -> str | None:
    """Map stored classification to a UI bucket. None when still unclassified."""
    if classification is None:
        return None
    return CATEGORY_LABEL.get(classification, "FYI")


def effective_inbox_category(message: Message) -> str:
    """UI category after correcting common LLM FYI mistakes on human mail."""
    if message.classification is None:
        return "Processing"
    stored = upgrade_human_misclassified_as_fyi(
        classification=message.classification,
        action_required=message.action_required,
        sender_classification=message.sender_classification,
        subject=message.subject,
        snippet=message.snippet,
        body=message.body_summary,
    )
    return CATEGORY_LABEL.get(stored, "FYI")


def message_needs_attention(
    *,
    category: str,
    user_replied: bool,
) -> bool:
    """True when the message belongs in the needs-action tab."""
    if user_replied or category == "Processing":
        return False
    return category in _ACTION_CATEGORIES
