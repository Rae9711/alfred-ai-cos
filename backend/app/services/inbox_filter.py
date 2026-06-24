"""Which synced messages belong in the mobile Inbox (Primary tab only, no promos)."""

from __future__ import annotations

from app.db.enums import MessageClassification
from app.db.models import Message
from app.services.classification_adjust import looks_like_verification_code
from app.services.gmail import is_non_primary_tab, is_primary_inbox
from app.services.sender_class import has_bulk_mail_headers

_BULK_SENDER_CLASSES = frozenset({"automated", "bulk", "suspicious", "muted"})
_HIDDEN_CLASSIFICATIONS = frozenset(
    {
        MessageClassification.spam_noise,
        MessageClassification.low_priority,
    }
)


def message_in_primary_inbox(message: Message) -> bool:
    """Return True when this row should appear in the Inbox UI."""
    if looks_like_verification_code(
        subject=message.subject, snippet=message.snippet, body=message.body_summary
    ):
        labels = message.gmail_labels or []
        if labels:
            return "INBOX" in labels and "CATEGORY_PROMOTIONS" not in labels
        return True

    if message.sender_classification in _BULK_SENDER_CLASSES:
        return False
    if message.classification in _HIDDEN_CLASSIFICATIONS:
        return False
    if has_bulk_mail_headers(message.headers):
        return False
    if not message.gmail_labels:
        # Hide until sync backfills Gmail labels (avoids legacy promos as FYI).
        return False
    return is_primary_inbox(message.gmail_labels) and not is_non_primary_tab(
        message.gmail_labels
    )
