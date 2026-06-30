"""Pre-draft replies for high-importance items.

When a critical-priority push fires, the user shouldn't have to bounce
through three screens to compose a reply. This module ensures a draft
exists for any commitment that came from an email, so the push can deep-link
to a review-and-send screen.

Idempotent on (user_id, message_id): if a draft already exists for the source
message, we reuse it rather than burning an LLM call per push tick."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import SourceType
from app.db.models import Commitment, DraftReply, Message, User
from app.llm import get_llm
from app.services.message_body import build_draft_context, fetch_message_body
from app.services.writing_style import (
    format_writing_style_prompt,
    get_writing_style,
    maybe_refresh_writing_style,
)


def ensure_draft_for(db: Session, user: User, *, commitment: Commitment) -> str | None:
    """Return the id of a DraftReply suitable for replying to this commitment.
    Creates one when none exists; returns None when the commitment didn't come
    from an email (no thread to reply on) or when LLM/draft generation fails.

    Failure paths return None rather than raising so the calling push scanner
    can fall back to a generic deep link — pre-drafting is a nice-to-have, not
    a blocker for the notification."""
    if commitment.source_type != SourceType.gmail or not commitment.source_id:
        return None

    # `source_id` on Commitment may be either Message.id (extraction path) or
    # Message.external_id (some legacy seed paths). Try both, in that order.
    message = db.get(Message, commitment.source_id)
    if message is None:
        message = db.scalar(
            select(Message).where(
                Message.user_id == user.id,
                Message.external_id == commitment.source_id,
            )
        )
    if message is None or message.user_id != user.id:
        return None

    # Reuse an existing draft if the user (or a prior push) already drafted.
    existing = db.scalar(
        select(DraftReply).where(DraftReply.user_id == user.id, DraftReply.message_id == message.id)
    )
    if existing is not None:
        return existing.id

    try:
        try:
            body = fetch_message_body(db, message)
        except Exception:
            body = (commitment.evidence or message.snippet or "").strip()
        context = build_draft_context(message=message, body=body)
        maybe_refresh_writing_style(db, user)
        style_prompt = format_writing_style_prompt(get_writing_style(user))
        result = get_llm().draft_reply(
            thread_context=context,
            instruction=None,
            tone="concise",
            user_name=user.name,
            writing_style_prompt=style_prompt,
        )
    except Exception:
        # LLM hiccups happen. The notification still fires without a draft.
        return None

    subject = result.subject or f"Re: {message.subject or commitment.description}".strip()
    draft = DraftReply(
        user_id=user.id,
        message_id=message.id,
        subject=subject,
        body=result.body,
        tone="concise",
    )
    db.add(draft)
    db.commit()
    return draft.id
