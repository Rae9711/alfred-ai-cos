"""Ingest SMS forwarded from an iOS Shortcut into the shared Message pipeline."""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.db.enums import MessageClassification
from app.db.models import DraftReply, Message, User
from app.llm import get_llm
from app.services import extraction, sender_class
from app.services.message_body import build_draft_context

_SMS_TOKEN_KEY = "sms_forward_token"
_PHONE_RE = re.compile(r"[\d+()\-\s]+")


def ensure_sms_forward_token(user: User) -> str:
    """Return a per-user token the iOS Shortcut sends in X-Sms-Token."""
    prefs = dict(user.preferences or {})
    token = prefs.get(_SMS_TOKEN_KEY)
    if not isinstance(token, str) or len(token) < 16:
        token = secrets.token_urlsafe(32)
        prefs[_SMS_TOKEN_KEY] = token
        user.preferences = prefs
    return token


def find_user_by_sms_token(db: Session, token: str) -> User | None:
    if not token or len(token) < 16:
        return None
    for user in db.scalars(select(User)):
        if (user.preferences or {}).get(_SMS_TOKEN_KEY) == token:
            return user
    return None


def normalize_phone(raw: str) -> str:
    """Best-effort E.164-ish normalization for sms: deep links."""
    cleaned = (raw or "").strip()
    if cleaned.startswith("+"):
        digits = "+" + re.sub(r"\D", "", cleaned[1:])
        return digits
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) == 10:
        return f"+1{digits}"
    if digits:
        return f"+{digits}"
    return cleaned


def _display_sender(*, phone: str, name: str | None) -> str:
    if name and name.strip():
        return f"{name.strip()} ({phone})"
    return phone


def _sms_headers(*, phone: str, body: str) -> dict[str, str | bool]:
    return {
        "sender_phone": phone,
        "sms_body": body,
        "sms_read": False,
    }


def _needs_reply(message: Message) -> bool:
    if message.action_required:
        return True
    return message.classification in {
        MessageClassification.needs_reply,
        MessageClassification.follow_up_needed,
        MessageClassification.needs_decision,
        MessageClassification.meeting_scheduling,
        MessageClassification.deadline,
    }


def _auto_draft_reply(db: Session, user: User, message: Message) -> None:
    if message.source != "sms" or not _needs_reply(message):
        return
    existing = db.scalar(
        select(DraftReply).where(
            DraftReply.user_id == user.id,
            DraftReply.message_id == message.id,
        )
    )
    if existing is not None:
        return
    headers = message.headers or {}
    body = str(headers.get("sms_body") or message.snippet or "")
    context = build_draft_context(message=message, body=body)
    result = get_llm().draft_reply(
        thread_context=context,
        instruction="Reply by SMS. Keep it short and natural for a text message.",
        tone="concise",
        user_name=user.name,
    )
    draft = DraftReply(
        user_id=user.id,
        message_id=message.id,
        subject=None,
        body=result.body,
        tone="concise",
    )
    db.add(draft)


@dataclass
class SmsIngestResult:
    message_id: str
    commitments_extracted: int
    deduped: bool
    draft_created: bool


def ingest_sms(
    db: Session,
    *,
    user: User,
    from_number: str,
    body: str,
    from_name: str | None = None,
    message_id: str | None = None,
    received_at: datetime | None = None,
) -> SmsIngestResult:
    """Create a Message from a forwarded SMS and run classification + optional draft."""
    phone = normalize_phone(from_number)
    if not phone or not _PHONE_RE.search(phone):
        raise ValueError("Invalid sender phone number")
    text = (body or "").strip()
    if not text:
        raise ValueError("SMS body is required")

    if message_id:
        external_id = f"sms:{message_id}"
    else:
        digest_src = f"{phone}|{text[:200]}|{(received_at or datetime.now(UTC)).isoformat()}"
        external_id = f"sms:{abs(hash(digest_src))}"

    existing = db.scalar(
        select(Message).where(Message.user_id == user.id, Message.external_id == external_id)
    )
    if existing is not None:
        return SmsIngestResult(
            message_id=existing.id,
            commitments_extracted=0,
            deduped=True,
            draft_created=db.scalar(
                select(DraftReply.id).where(
                    DraftReply.user_id == user.id,
                    DraftReply.message_id == existing.id,
                )
            )
            is not None,
        )

    sender = _display_sender(phone=phone, name=from_name)
    cls = sender_class.classify(
        sender=sender,
        subject=None,
        snippet=text[:200],
        headers=None,
        user=user,
    )
    message = Message(
        user_id=user.id,
        source="sms",
        external_id=external_id,
        thread_id=phone,
        sender=sender,
        recipients=[],
        subject=None,
        snippet=text[:200],
        sent_at=received_at or datetime.now(UTC),
        sender_classification=cls.cls,
        headers=_sms_headers(phone=phone, body=text),
    )
    db.add(message)
    db.flush()

    commitments = extraction.process_message(db, message, body=text)
    had_draft = False
    try:
        _auto_draft_reply(db, user, message)
        had_draft = db.scalar(
            select(DraftReply.id).where(
                DraftReply.user_id == user.id,
                DraftReply.message_id == message.id,
            )
        ) is not None
        db.commit()
    except Exception:
        db.rollback()
        raise

    return SmsIngestResult(
        message_id=message.id,
        commitments_extracted=len(commitments),
        deduped=False,
        draft_created=had_draft,
    )


def sms_reply_phone(message: Message) -> str | None:
    if message.source != "sms":
        return None
    headers = message.headers or {}
    phone = headers.get("sender_phone")
    return str(phone) if phone else None


def is_sms_unread(message: Message) -> bool:
    if message.source != "sms":
        return True
    headers = message.headers or {}
    return headers.get("sms_read") is not True


def mark_sms_read(message: Message) -> None:
    headers = dict(message.headers or {})
    headers["sms_read"] = True
    message.headers = headers
    flag_modified(message, "headers")
