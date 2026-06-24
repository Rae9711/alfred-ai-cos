"""Which synced messages belong in the mobile Inbox (Primary tab only, no promos)."""

from __future__ import annotations

from app.db.enums import MessageClassification
from app.db.models import Message
from app.services.classification_adjust import looks_like_automated_fyi
from app.services.gmail import is_non_primary_tab, is_primary_inbox
from app.services.sender_class import has_bulk_mail_headers

_BULK_SENDER_CLASSES = frozenset({"automated", "bulk", "suspicious", "muted"})
_HIDDEN_CLASSIFICATIONS = frozenset({MessageClassification.spam_noise})


def message_in_primary_inbox(message: Message) -> bool:
    """Return True when this row should appear in the Inbox UI."""
    if looks_like_automated_fyi(subject=message.subject, snippet=message.snippet):
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
    labels = message.gmail_labels
    if not labels:
        # Legacy rows: show classified human mail; hide unlabeled bulk/noise.
        return message.sender_classification not in _BULK_SENDER_CLASSES
    if not is_primary_inbox(labels):
        return False
    return not is_non_primary_tab(labels)
