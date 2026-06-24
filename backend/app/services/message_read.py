"""Gmail read/unread state: mark read in Gmail and keep local labels in sync."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Message, User
from app.services import gmail
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token
from app.services.inbox_view import is_gmail_unread


def refresh_message_labels(db: Session, message: Message, *, token: dict | None = None) -> list[str]:
    """Fetch current Gmail labels for one stored message."""
    account = get_google_account_for_message(db, message)
    if account is None:
        raise ValueError("Missing connected account for message")
    if token is None:
        token = decrypt_token(account.token_ciphertext)
    labels = gmail.get_message_label_ids(token, message.external_id)
    message.gmail_labels = labels
    return labels


def mark_message_read(db: Session, user: User, message: Message) -> Message:
    """Remove UNREAD in Gmail and update the stored label snapshot."""
    if message.user_id != user.id:
        raise ValueError("Message not found")
    if not is_gmail_unread(message.gmail_labels):
        return message

    account = get_google_account_for_message(db, message)
    if account is None:
        raise ValueError("Missing connected account for message")

    if account.scopes == ["seed"]:
        labels = list(message.gmail_labels or ["INBOX", "CATEGORY_PERSONAL", "UNREAD"])
        message.gmail_labels = [label for label in labels if label != "UNREAD"]
        db.commit()
        return message

    token = decrypt_token(account.token_ciphertext)
    message.gmail_labels = gmail.modify_message_labels(
        token, message.external_id, remove=["UNREAD"]
    )
    db.commit()
    return message
