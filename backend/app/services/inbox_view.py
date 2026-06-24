"""Build the mobile Inbox list: today's mail, read/replied state, category mapping."""

from __future__ import annotations

from datetime import UTC, datetime
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
    action_required: bool,
    is_unread: bool,
    user_replied: bool,
) -> bool:
    """True when the message belongs in the Reply section (unread + needs action)."""
    if not is_unread or user_replied:
        return False
    if category in _ACTION_CATEGORIES:
        return True
    if action_required and category not in ("Waiting", "FYI", "Processing"):
        return True
    if category == "Waiting":
        return True
    return False
