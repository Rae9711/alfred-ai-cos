"""Fetch full Gmail message bodies on demand (never persisted)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Message
from app.services import gmail
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token

# Keep draft context within a reasonable token budget.
_MAX_BODY_CHARS = 12_000
_MAX_THREAD_MESSAGES = 6
_MAX_THREAD_SNIPPET_CHARS = 800


def fetch_message_body(db: Session, message: Message) -> str:
    """Return the full plain-text body for one stored message."""
    if message.source == "sms":
        headers = message.headers or {}
        body = str(headers.get("sms_body") or message.snippet or "").strip()
        if not body:
            raise ValueError("Missing SMS body")
        return body

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


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def fetch_thread_messages(db: Session, message: Message) -> list[Message]:
    """Prior messages in the same thread, oldest first (excluding the current message)."""
    if not message.thread_id:
        return []
    rows = list(
        db.scalars(
            select(Message)
            .where(
                Message.user_id == message.user_id,
                Message.thread_id == message.thread_id,
                Message.id != message.id,
            )
            .order_by(Message.sent_at.asc().nullslast())
        )
    )
    return rows[-_MAX_THREAD_MESSAGES:]


def build_thread_summary(db: Session, message: Message, *, current_body: str) -> str:
    """Assemble prior thread messages for drafting or extraction context."""
    prior = fetch_thread_messages(db, message)
    if not prior and message.source == "sms":
        return ""

    parts: list[str] = []
    for prior_msg in prior:
        if prior_msg.source == "sms":
            headers = prior_msg.headers or {}
            body = str(headers.get("sms_body") or prior_msg.snippet or "").strip()
        else:
            try:
                body = fetch_message_body(db, prior_msg)
            except (ValueError, Exception):
                body = prior_msg.snippet or ""
        body = _truncate(body.strip(), _MAX_THREAD_SNIPPET_CHARS)
        if not body:
            continue
        when = prior_msg.sent_at.strftime("%Y-%m-%d %H:%M") if prior_msg.sent_at else "earlier"
        label = prior_msg.sender or "Unknown"
        if prior_msg.subject and prior_msg.source != "sms":
            parts.append(f"[{when}] From: {label}\nSubject: {prior_msg.subject}\n{body}")
        else:
            parts.append(f"[{when}] {label}:\n{body}")

    if not parts:
        return ""
    return "Earlier in this thread:\n\n" + "\n\n---\n\n".join(parts)


def build_draft_context(
    *, message: Message, body: str, db: Session | None = None, thread_summary: str | None = None
) -> str:
    """Thread context passed to the draft-reply LLM."""
    summary = thread_summary
    if summary is None and db is not None:
        summary = build_thread_summary(db, message, current_body=body)

    if message.source == "sms":
        head = f"SMS from: {message.sender}\n\n"
        if summary:
            return head + summary + "\n\nLatest message:\n" + body
        return head + body

    head = f"Subject: {message.subject or '(none)'}\nFrom: {message.sender}\n\n"
    if summary:
        return head + summary + "\n\nLatest message:\n" + body
    return head + body
