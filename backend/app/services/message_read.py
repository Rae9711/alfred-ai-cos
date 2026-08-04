"""Gmail read/unread state: mark read in Gmail and keep local labels in sync."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import ConnectedAccount, Message, User
from app.services import gmail
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token, encrypt_token
from app.services.gmail import use_gmail_credentials
from app.services.google_oauth import fresh_credentials
from app.services.inbox_view import is_message_unread
from app.services.sms_inbox import mark_sms_read

GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify"


def account_has_gmail_modify(account: ConnectedAccount) -> bool:
    scopes = account.scopes or []
    return GMAIL_MODIFY_SCOPE in scopes or any("gmail.modify" in s for s in scopes)


def _mark_read_local(message: Message) -> None:
    labels = list(message.gmail_labels or ["INBOX", "CATEGORY_PERSONAL", "UNREAD"])
    message.gmail_labels = [label for label in labels if label != "UNREAD"]


def refresh_message_labels(
    db: Session, message: Message, *, token: dict | None = None
) -> list[str]:
    """Fetch current Gmail labels for one stored message."""
    account = get_google_account_for_message(db, message)
    if account is None:
        raise ValueError("Missing connected account for message")
    if token is None:
        stored = decrypt_token(account.token_ciphertext)
        creds, token = fresh_credentials(stored)
    else:
        creds, token = fresh_credentials(token)
    with use_gmail_credentials(creds):
        labels = gmail.get_message_label_ids(token, message.external_id)
    message.gmail_labels = labels
    return labels


def mark_message_read(db: Session, user: User, message: Message) -> tuple[Message, bool]:
    """Remove UNREAD in Gmail when permitted; always update local label snapshot.

    Returns (message, gmail_synced). gmail_synced is False when the mailbox token
    lacks gmail.modify, or when the Gmail write fails (token/network/API) — caller
    should prompt the user to reconnect Gmail when False after a user-initiated
    mark-read.
    """
    if message.user_id != user.id:
        raise ValueError("Message not found")
    if not is_message_unread(message):
        return message, True

    if message.source == "sms":
        mark_sms_read(message)
        db.commit()
        return message, True

    account = get_google_account_for_message(db, message)
    if account is None:
        raise ValueError("Missing connected account for message")

    if account.scopes == ["seed"]:
        _mark_read_local(message)
        db.commit()
        return message, True

    if not account_has_gmail_modify(account):
        _mark_read_local(message)
        db.commit()
        return message, False

    stored_token = decrypt_token(account.token_ciphertext)
    gmail_synced = False
    token = stored_token
    try:
        creds, token = fresh_credentials(stored_token)
        with use_gmail_credentials(creds):
            message.gmail_labels = gmail.modify_message_labels(
                token, message.external_id, remove=["UNREAD"]
            )
        gmail_synced = True
    except Exception:
        # Token refresh / 401 / 403 / 404 / network / 5xx — keep app read state
        # consistent and let the client prompt reconnect when gmail_synced is False.
        _mark_read_local(message)
        gmail_synced = False

    if token != stored_token:
        account.token_ciphertext = encrypt_token(token)
    db.commit()
    return message, gmail_synced
