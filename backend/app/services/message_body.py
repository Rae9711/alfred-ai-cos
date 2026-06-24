"""Fetch full Gmail message bodies on demand (never persisted)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Message
from app.services import gmail
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token

# Keep draft context within a reasonable token budget.
_MAX_BODY_CHARS = 12_000


def fetch_message_body(db: Session, message: Message) -> str:
    """Return the full plain-text body from Gmail for one stored message."""
    account = get_google_account_for_message(db, message)
    if account is None:
        raise ValueError("Missing connected account for message")
    token = decrypt_token(account.token_ciphertext)
    raw = gmail.get_message(token, message.external_id)
    body = (raw.get("body") or "").strip()
    if not body:
        body = (raw.get("snippet") or message.snippet or "").strip()
    if len(body) > _MAX_BODY_CHARS:
        body = body[:_MAX_BODY_CHARS] + "\n\n[… message truncated …]"
    return body


def build_draft_context(*, message: Message, body: str) -> str:
    """Thread context passed to the draft-reply LLM."""
    return (
        f"Subject: {message.subject or '(none)'}\n"
        f"From: {message.sender}\n\n"
        f"{body}"
    )
