"""Priority Inbox (PRD 12.4). Lists the user's synced, classified messages for the
Inbox screen, collapsing the fine-grained MessageClassification into the four UI
categories and filtering spam/noise (surfaced only as a count)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import MessageClassification
from app.db.models import Message, User
from app.schemas.api import (
    BookMessageRequest,
    BookMessageResponse,
    InboxMessageOut,
    InboxOut,
)
from app.services.assistant import interpret_and_book, resolve_timezone
from app.services.classification_adjust import automated_fyi_override, looks_like_automated_fyi
from app.services.inbox_filter import message_in_primary_inbox

router = APIRouter(prefix="/messages", tags=["messages"])

# Backend classification → the Inbox screen's four buckets.
_CATEGORY = {
    MessageClassification.needs_reply: "Needs Reply",
    MessageClassification.follow_up_needed: "Needs Reply",
    MessageClassification.needs_decision: "Needs Decision",
    MessageClassification.meeting_scheduling: "Needs Decision",
    MessageClassification.deadline: "Needs Decision",
    MessageClassification.waiting_for_response: "Waiting",
    MessageClassification.informational: "FYI",
    MessageClassification.low_priority: "FYI",
    MessageClassification.sensitive: "FYI",
}
# Classifications that should not appear in the inbox at all (counted as "filtered").
_FILTERED = {MessageClassification.spam_noise}


@router.get("", response_model=InboxOut)
def list_inbox(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InboxOut:
    rows = list(
        db.scalars(
            select(Message)
            .where(Message.user_id == user.id)
            .order_by(Message.sent_at.desc().nullslast())
        )
    )

    messages: list[InboxMessageOut] = []
    filtered = 0
    for m in rows:
        if not message_in_primary_inbox(m):
            filtered += 1
            continue
        if m.classification in _FILTERED:
            filtered += 1
            continue
        # Unclassified (sync ran, extraction pending) → default to FYI rather than drop.
        effective = m.classification
        if looks_like_automated_fyi(
            subject=m.subject, snippet=m.snippet, body=m.body_summary
        ):
            effective = MessageClassification.informational
        category = _CATEGORY.get(effective, "FYI") if effective else "FYI"
        messages.append(
            InboxMessageOut(
                id=m.id,
                sender=m.sender,
                subject=m.subject,
                snippet=m.snippet,
                take=m.body_summary,
                category=category,
                sent_at=m.sent_at,
                action_required=m.action_required,
            )
        )

    return InboxOut(messages=messages, filtered_count=filtered)


@router.post("/{message_id}/book", response_model=BookMessageResponse)
def book_from_message(
    message_id: str,
    payload: BookMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BookMessageResponse:
    """"Yes / Add to calendar" on an event-like message. Interprets the message content
    for a date/time and books it on the user's calendar through the audited spine."""
    message = db.get(Message, message_id)
    if message is None or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")

    tz = resolve_timezone(db, user, payload.timezone)
    # Give the interpreter the message so it can pull the title + time from it.
    text = (
        f"Add this to my calendar if it describes an event with a time.\n"
        f"Subject: {message.subject or '(none)'}\n{message.snippet or ''}"
    )
    outcome = interpret_and_book(db, user, text=text, tz=tz)
    return BookMessageResponse(
        booked=outcome.booked, reply=outcome.reply, detail=outcome.detail
    )
