"""Build the mobile Inbox list: today's mail, read/replied state, category mapping."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification, Priority
from app.db.models import Message, OutboundReply
from app.services.classification_adjust import (
    apply_action_subject_classification,
    subject_implies_action_required,
    upgrade_human_misclassified_as_fyi,
)

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

# Needs-action tab: only messages ~90% likely to be genuinely useful.
_HIGH_CONFIDENCE_CLASSIFICATIONS = frozenset(
    {
        MessageClassification.needs_reply,
        MessageClassification.needs_decision,
        MessageClassification.deadline,
        MessageClassification.meeting_scheduling,
    }
)
# Reply mail needs action_required; needs_decision qualifies on classification alone
# (LLM sometimes sets action_required=false while still tagging needs_decision).
_CORE_REPLY_CLASSIFICATIONS = frozenset({MessageClassification.needs_reply})
_HIGH_PRIORITIES = frozenset({Priority.critical, Priority.high})
_UNTRUSTED_SENDERS = frozenset({"automated", "bulk", "suspicious", "muted"})


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


def message_user_decided(message: Message) -> bool:
    """True when the user explicitly marked this message handled in the app."""
    headers = message.headers or {}
    return bool(headers.get("user_decided"))


def _classification_storage_value(
    classification: MessageClassification | str | None,
) -> str | None:
    """Normalize classification for JSON headers (DB may return plain strings)."""
    if classification is None:
        return None
    if isinstance(classification, MessageClassification):
        return classification.value
    return str(classification)


def mark_message_user_decided(message: Message) -> None:
    headers = dict(message.headers or {})
    if not headers.get("user_decided"):
        pre_cls = _classification_storage_value(message.classification)
        if pre_cls is not None:
            headers["pre_decide_classification"] = pre_cls
        headers["pre_decide_action_required"] = bool(message.action_required)
    headers["user_decided"] = True
    message.headers = headers


def clear_message_user_decided(message: Message) -> None:
    """Restore a message the user previously marked handled."""
    headers = dict(message.headers or {})
    headers.pop("user_decided", None)
    pre_cls = headers.pop("pre_decide_classification", None)
    pre_action = headers.pop("pre_decide_action_required", None)
    message.headers = headers
    if pre_cls is not None:
        try:
            message.classification = MessageClassification(pre_cls)
        except ValueError:
            pass
    if pre_action is not None:
        message.action_required = bool(pre_action)


def effective_inbox_category(message: Message) -> str:
    """UI category after correcting common LLM FYI mistakes on human mail."""
    if message_user_decided(message):
        return "FYI"
    if message.classification is None:
        # Synced mail awaiting LLM classification — but action_required means
        # the user should treat it as needs-reply, not a vague "Processing" tag.
        if message.action_required or subject_implies_action_required(
            subject=message.subject,
            snippet=message.snippet,
        ):
            return "Needs Reply"
        return "Processing"
    stored = upgrade_human_misclassified_as_fyi(
        classification=message.classification,
        action_required=message.action_required,
        sender_classification=message.sender_classification,
        subject=message.subject,
        snippet=message.snippet,
        body=message.body_summary,
    )
    stored = apply_action_subject_classification(
        stored,
        action_required=message.action_required,
        subject=message.subject,
        snippet=message.snippet,
        body=message.body_summary,
    )
    category = CATEGORY_LABEL.get(stored, "FYI")
    if category in ("FYI", "Waiting") and (
        message.action_required
        or subject_implies_action_required(
            subject=message.subject,
            snippet=message.snippet,
        )
    ):
        return "Needs Reply"
    return category


def message_needs_attention(
    *,
    category: str,
    user_replied: bool,
    user_decided: bool = False,
) -> bool:
    """True when the message belongs in the needs-action tab."""
    if user_decided or user_replied or category == "Processing":
        return False
    return category in _ACTION_CATEGORIES


def message_qualifies_for_needs_action_tab(
    message: Message,
    *,
    category: str,
    user_replied: bool,
    user_decided: bool = False,
) -> bool:
    """~90% precision needs-action tab — stricter than message_needs_attention."""
    if not message_needs_attention(
        category=category,
        user_replied=user_replied,
        user_decided=user_decided,
    ):
        return False
    if message.classification is None:
        return False
    if message.classification not in _HIGH_CONFIDENCE_CLASSIFICATIONS:
        return False
    if (message.sender_classification or "") in _UNTRUSTED_SENDERS:
        return False
    if message.classification == MessageClassification.needs_decision:
        return True
    if message.classification in _CORE_REPLY_CLASSIFICATIONS:
        return bool(message.action_required)
    if not message.action_required:
        return False
    return message.priority in _HIGH_PRIORITIES


def needs_action_message_ids(
    db: Session,
    user_id: str,
    *,
    replied_ids: set[str] | None = None,
) -> set[str]:
    """Message ids that belong in the needs-action inbox tab."""
    from app.services.inbox_filter import message_in_primary_inbox

    cutoff = needs_action_cutoff_utc()
    replied = replied_ids if replied_ids is not None else user_replied_message_ids(db, user_id)
    rows = db.scalars(
        select(Message).where(
            Message.user_id == user_id,
            Message.sent_at.is_not(None),
            Message.sent_at >= cutoff,
            Message.classification != MessageClassification.spam_noise,
        )
    )
    ids: set[str] = set()
    for message in rows:
        if not message_in_primary_inbox(message):
            continue
        category = effective_inbox_category(message)
        if message_qualifies_for_needs_action_tab(
            message,
            category=category,
            user_replied=message.id in replied,
            user_decided=message_user_decided(message),
        ):
            ids.add(message.id)
    return ids
