"""Learn the user's email writing style from sent Gmail and approved drafts."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.db.models import ConnectedAccount, DraftReply, OutboundReply, User
from app.db.enums import Provider
from app.services import gmail
from app.services.connected_accounts import list_google_accounts
from app.services.crypto import decrypt_token

_SENT_LIMIT = 20
_REFRESH_DAYS = 7
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\u2600-\u26FF"
    "\u2700-\u27BF"
    "]",
    flags=re.UNICODE,
)
_GREETING_RE = re.compile(
    r"^(hi|hey|hello|dear|good morning|good afternoon|thanks|thank you|"
    r"你好|您好|嗨|早上好|下午好|感谢)",
    re.IGNORECASE,
)
_CASUAL_MARKERS = re.compile(
    r"\b(yeah|yep|nope|gonna|wanna|lol|btw|imo|thanks!|cheers|ok)\b|！|哈哈|好的呀",
    re.IGNORECASE,
)
_FORMAL_MARKERS = re.compile(
    r"\b(regards|sincerely|respectfully|please find|dear sir|dear madam|"
    r"此致|敬礼|敬请|贵司)\b",
    re.IGNORECASE,
)


def extract_writing_style_from_bodies(bodies: list[str]) -> dict[str, Any]:
    """Rule-based style profile from plain-text email bodies."""
    cleaned = [b.strip() for b in bodies if b and b.strip()]
    if not cleaned:
        return {}

    greetings: list[str] = []
    lengths: list[int] = []
    emoji_hits = 0
    casual = formal = 0
    openings: list[str] = []
    closings: list[str] = []

    for body in cleaned:
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        if not lines:
            continue
        first = lines[0]
        if _GREETING_RE.match(first):
            greetings.append(first[:80])
            openings.append(first[:60])
        lengths.append(len(body))
        emoji_hits += len(_EMOJI_RE.findall(body))
        casual += len(_CASUAL_MARKERS.findall(body))
        formal += len(_FORMAL_MARKERS.findall(body))
        if len(lines) >= 2:
            closings.append(lines[-1][:60])

    avg_len = int(sum(lengths) / len(lengths)) if lengths else 120
    emoji_usage = "frequent" if emoji_hits >= len(cleaned) else "rare" if emoji_hits == 0 else "occasional"

    if formal > casual:
        tone = "professional"
    elif casual > formal:
        tone = "casual"
    else:
        tone = "neutral"

    greeting = max(set(greetings), key=greetings.count) if greetings else "Hi"
    sample_phrases: list[str] = []
    for phrase in openings[:3] + closings[:2]:
        if phrase and phrase not in sample_phrases:
            sample_phrases.append(phrase)

    return {
        "greeting": greeting,
        "tone": tone,
        "length": "short" if avg_len < 120 else "long" if avg_len > 400 else "medium",
        "avg_length_chars": avg_len,
        "emoji_usage": emoji_usage,
        "sample_phrases": sample_phrases[:5],
        "updated_at": datetime.now(UTC).isoformat(),
    }


def format_writing_style_prompt(style: dict[str, Any] | None) -> str | None:
    if not style:
        return None
    lines = [
        "Write like this user:",
        f"- Greeting: {style.get('greeting', 'Hi')}",
        f"- Tone: {style.get('tone', 'neutral')}",
        f"- Length: {style.get('length', 'medium')} (~{style.get('avg_length_chars', 120)} chars)",
        f"- Emoji: {style.get('emoji_usage', 'rare')}",
    ]
    phrases = style.get("sample_phrases") or []
    if phrases:
        lines.append("- Sample phrases: " + "; ".join(phrases[:3]))
    return "\n".join(lines)


def get_writing_style(user: User) -> dict[str, Any] | None:
    raw = (user.preferences or {}).get("writing_style")
    return raw if isinstance(raw, dict) else None


def _store_style(db: Session, user: User, style: dict[str, Any]) -> dict[str, Any]:
    prefs = dict(user.preferences or {})
    prefs["writing_style"] = style
    user.preferences = prefs
    flag_modified(user, "preferences")
    db.add(user)
    db.commit()
    db.refresh(user)
    return style


def fetch_sent_bodies(db: Session, user: User, *, limit: int = _SENT_LIMIT) -> list[str]:
    accounts = list_google_accounts(db, user.id)
    bodies: list[str] = []
    for account in accounts:
        if account.provider != Provider.google or account.scopes == ["seed"]:
            continue
        try:
            token = decrypt_token(account.token_ciphertext)
            ids = gmail.list_sent_message_ids(token, max_results=limit)
            for mid in ids:
                if len(bodies) >= limit:
                    break
                try:
                    msg = gmail.get_message(token, mid)
                    body = (msg.get("body") or msg.get("snippet") or "").strip()
                    if body:
                        bodies.append(body)
                except Exception:
                    continue
        except Exception:
            continue
    return bodies


def refresh_writing_style(db: Session, user: User, *, bodies: list[str] | None = None) -> dict[str, Any] | None:
    """Fetch sent mail (when possible) and persist style in user.preferences."""
    bodies = bodies if bodies is not None else fetch_sent_bodies(db, user)
    style = extract_writing_style_from_bodies(bodies)
    if not style:
        return get_writing_style(user)
    existing = get_writing_style(user) or {}
    merged = {**existing, **style}
    return _store_style(db, user, merged)


def should_refresh_writing_style(user: User, *, today: date | None = None) -> bool:
    today = today or datetime.now(UTC).date()
    style = get_writing_style(user)
    if not style:
        return True
    updated_raw = style.get("updated_at")
    if not updated_raw:
        return True
    try:
        updated = datetime.fromisoformat(str(updated_raw))
    except ValueError:
        return True
    if updated.date() < today:
        return True
    return datetime.now(UTC) - updated > timedelta(days=_REFRESH_DAYS)


def maybe_refresh_writing_style(db: Session, user: User) -> None:
    if should_refresh_writing_style(user):
        refresh_writing_style(db, user)


def incorporate_sent_reply(db: Session, user: User, body: str) -> None:
    """Positive signal from a draft the user edited and sent."""
    body = body.strip()
    if not body:
        return
    patch = extract_writing_style_from_bodies([body])
    if not patch:
        return
    existing = get_writing_style(user) or {}
    phrases = list(existing.get("sample_phrases") or [])
    for phrase in patch.get("sample_phrases") or []:
        if phrase not in phrases:
            phrases.insert(0, phrase)
    existing.update(
        {
            "greeting": patch.get("greeting") or existing.get("greeting"),
            "tone": patch.get("tone") or existing.get("tone"),
            "length": patch.get("length") or existing.get("length"),
            "avg_length_chars": patch.get("avg_length_chars") or existing.get("avg_length_chars"),
            "emoji_usage": patch.get("emoji_usage") or existing.get("emoji_usage"),
            "sample_phrases": phrases[:5],
            "updated_at": datetime.now(UTC).isoformat(),
        }
    )
    _store_style(db, user, existing)


def learn_from_recent_sent_drafts(db: Session, user: User, *, limit: int = 5) -> None:
    """Augment style from OutboundReply rows linked to user-edited DraftReply bodies."""
    rows = list(
        db.scalars(
            select(OutboundReply)
            .where(OutboundReply.user_id == user.id)
            .order_by(OutboundReply.sent_at.desc())
            .limit(limit)
        )
    )
    for outbound in rows:
        draft = db.scalar(
            select(DraftReply)
            .where(
                DraftReply.user_id == user.id,
                DraftReply.message_id == outbound.source_message_id,
            )
            .order_by(DraftReply.created_at.desc())
        )
        if draft and draft.body.strip():
            incorporate_sent_reply(db, user, draft.body)
