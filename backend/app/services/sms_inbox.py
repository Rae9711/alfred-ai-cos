"""Ingest SMS forwarded from an iOS Shortcut into the shared Message pipeline."""

from __future__ import annotations

import logging
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
from app.services import channel_ingest
from app.services.message_body import build_draft_context
from app.services.sms_body import normalize_sms_body_text
from app.services.writing_style import format_writing_style_prompt, get_writing_style

logger = logging.getLogger(__name__)

_SMS_TOKEN_KEY = "sms_forward_token"
# Placeholder when the iOS shortcut cannot read sender phone (minimal automation).
UNKNOWN_SMS_SENDER = "+10000000000"
_PHONE_RE = re.compile(r"[\d+()\-\s]+")


def ensure_sms_forward_token(user: User) -> str:
    """Return a per-user token the iOS Shortcut sends in X-Sms-Token.

    Prefers the indexed ``users.sms_forward_token`` column. Falls back to (and
    migrates from) the legacy preferences JSON key for rows that predate the column.
    """
    if isinstance(user.sms_forward_token, str) and len(user.sms_forward_token) >= 16:
        return user.sms_forward_token

    prefs = dict(user.preferences or {})
    legacy = prefs.get(_SMS_TOKEN_KEY)
    if isinstance(legacy, str) and len(legacy) >= 16:
        user.sms_forward_token = legacy
        return legacy

    token = secrets.token_urlsafe(32)
    user.sms_forward_token = token
    # Keep preferences in sync so older clients / docs that read prefs still work.
    prefs[_SMS_TOKEN_KEY] = token
    user.preferences = prefs
    flag_modified(user, "preferences")
    return token


def rotate_sms_forward_token(user: User) -> str:
    """Issue a new SMS webhook token (invalidates the previous one immediately)."""
    token = secrets.token_urlsafe(32)
    user.sms_forward_token = token
    prefs = dict(user.preferences or {})
    prefs[_SMS_TOKEN_KEY] = token
    user.preferences = prefs
    flag_modified(user, "preferences")
    return token


def find_user_by_sms_token(db: Session, token: str) -> User | None:
    if not token or len(token) < 16:
        return None
    user = db.scalar(select(User).where(User.sms_forward_token == token))
    if user is not None:
        return user
    # Legacy rows: token only in preferences until ensure_sms_forward_token runs.
    for candidate in db.scalars(select(User).where(User.sms_forward_token.is_(None))):
        if (candidate.preferences or {}).get(_SMS_TOKEN_KEY) == token:
            candidate.sms_forward_token = token
            return candidate
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


def is_unknown_sms_sender(phone: str | None) -> bool:
    """True when Shortcuts could not supply a real sender number."""
    if not phone:
        return True
    return normalize_phone(phone) == UNKNOWN_SMS_SENDER


# Leading junk iOS prepends to some SMS bodies (object-replacement + zero-width chars).
_SMS_BODY_JUNK = "\ufffc\u200b\u200c\u200d\u200e\u200f\ufeff \t"
_BRACKET_SENDER_RE = re.compile(r"^\[([^\]]{1,40})\]")
_ITS_SENDER_RE = re.compile(
    r"^(?:hi|hello|hey)[,!\s]+(?:it['\u2019]s|this is)\s+"
    r"([A-Za-z0-9][\w &.'\u2019-]{1,38}?)\s*[.!,:]",
    re.IGNORECASE,
)
_COLON_SENDER_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9 &.'\u2019-]{1,38}?)\s*[:：]")


def _sender_from_body(body: str | None) -> str | None:
    """Derive a readable sender for A2P / business texts that embed their identity in
    the message, used when the iOS Shortcut could supply neither phone nor contact name.

    "Temu: Your $300 ..." -> "Temu"; "[TikTok] Verification ..." -> "TikTok";
    "Hi, it's CVS Health. Reply ..." -> "CVS Health". Returns None for ordinary personal
    texts (no leading sender marker) so they keep the neutral "Unknown sender" label."""
    if not body:
        return None
    text = body.strip().lstrip(_SMS_BODY_JUNK).strip()
    if not text:
        return None
    for pattern, max_words in (
        (_ITS_SENDER_RE, 5),
        (_BRACKET_SENDER_RE, 5),
        (_COLON_SENDER_RE, 4),
    ):
        m = pattern.match(text)
        if not m:
            continue
        name = m.group(1).strip(" .-'\u2019\t")
        # A real sender label is a short brand/name, not a sentence fragment.
        if name and len(name) <= 40 and 1 <= len(name.split()) <= max_words:
            return name
    return None


def _display_sender(*, phone: str, name: str | None, body: str | None = None) -> str:
    if is_unknown_sms_sender(phone):
        if name and name.strip():
            return name.strip()
        from_body = _sender_from_body(body)
        if from_body:
            return from_body
        return "Unknown sender"
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
    style_prompt = format_writing_style_prompt(get_writing_style(user))
    result = get_llm().draft_reply(
        thread_context=context,
        instruction="Reply by SMS. Keep it short and natural for a text message.",
        tone="concise",
        user_name=user.name,
        writing_style_prompt=style_prompt,
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


def resolve_sms_sender_phone(from_number: str | None) -> str:
    """Normalize sender phone, falling back when Shortcuts cannot supply it."""
    phone = normalize_phone(from_number or "")
    if phone and _PHONE_RE.search(phone):
        return phone
    return UNKNOWN_SMS_SENDER


def ingest_sms(
    db: Session,
    *,
    user: User,
    from_number: str,
    body: str,
    from_name: str | None = None,
    message_id: str | None = None,
    received_at: datetime | None = None,
    backfill: bool = False,
) -> SmsIngestResult:
    """Create a Message from a forwarded SMS and run classification + optional draft."""
    phone = resolve_sms_sender_phone(from_number)
    text = normalize_sms_body_text(body or "")
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

    sender = _display_sender(phone=phone, name=from_name, body=text)
    headers = _sms_headers(phone=phone, body=text)
    if backfill:
        headers["sms_backfill"] = True

    # Core ingest (dedup, classify, persist, extract) via the shared channel path; the
    # SMS-specific bits — backfill spam softening and the auto-drafted reply — layer on top.
    result = channel_ingest.ingest_channel_message(
        db,
        user=user,
        source="sms",
        external_id=external_id,
        sender=sender,
        body=text,
        thread_id=phone,
        received_at=received_at,
        headers=headers,
    )
    message = result.message
    if result.deduped:
        return SmsIngestResult(
            message_id=message.id,
            commitments_extracted=0,
            deduped=True,
            draft_created=db.scalar(
                select(DraftReply.id).where(
                    DraftReply.user_id == user.id,
                    DraftReply.message_id == message.id,
                )
            )
            is not None,
        )

    if backfill and message.classification == MessageClassification.spam_noise:
        message.classification = MessageClassification.informational
    had_draft = False
    try:
        _auto_draft_reply(db, user, message)
        had_draft = (
            db.scalar(
                select(DraftReply.id).where(
                    DraftReply.user_id == user.id,
                    DraftReply.message_id == message.id,
                )
            )
            is not None
        )
    except Exception:
        logger.exception("SMS auto-draft failed for message %s", message.id)
    db.commit()

    return SmsIngestResult(
        message_id=message.id,
        commitments_extracted=result.commitments_extracted,
        deduped=False,
        draft_created=had_draft,
    )


def sms_reply_phone(message: Message) -> str | None:
    if message.source != "sms":
        return None
    headers = message.headers or {}
    phone = headers.get("sender_phone")
    if not phone:
        return None
    phone_str = str(phone)
    if is_unknown_sms_sender(phone_str):
        return None
    return phone_str


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
