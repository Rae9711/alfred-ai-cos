"""Which synced messages belong in the mobile Inbox (Primary tab only)."""

from __future__ import annotations

from app.db.enums import MessageClassification
from app.db.models import Message
from app.services.gmail import is_non_primary_tab, is_primary_inbox

_BULK_SENDER_CLASSES = frozenset({"automated", "bulk", "suspicious", "muted"})


def message_in_primary_inbox(message: Message) -> bool:
    """Return True when this row should appear in the Inbox UI."""
    if message.gmail_labels:
        return is_primary_inbox(message.gmail_labels) and not is_non_primary_tab(
            message.gmail_labels
        )
    # Legacy rows (pre-label backfill): hide obvious bulk; keep person mail until
    # the next sync refreshes gmail_labels.
    if message.sender_classification in _BULK_SENDER_CLASSES:
        return False
    if message.classification == MessageClassification.spam_noise:
        return False
    return True
