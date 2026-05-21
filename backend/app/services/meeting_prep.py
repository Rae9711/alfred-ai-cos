"""Meeting Prep Agent (PRD 14.1 agent 6, 10.5, journey 4).

For an upcoming event, find related email threads (by attendee email match against
message sender/recipients) and ask the LLM to summarize context, open commitments,
and suggested questions. Read-only and on-demand; nothing is persisted."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, Message
from app.llm import get_llm
from app.schemas.llm import MeetingContextSummary

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _emails_in(text: str | None) -> set[str]:
    if not text:
        return set()
    return {m.lower() for m in _EMAIL_RE.findall(text)}


def upcoming_events(
    db: Session, user_id: str, *, within_hours: int | None = None
) -> list[CalendarEvent]:
    """Events from now forward, optionally limited to the next `within_hours`."""
    now = datetime.now(UTC)
    stmt = select(CalendarEvent).where(
        CalendarEvent.user_id == user_id,
        CalendarEvent.start_time.is_not(None),
        CalendarEvent.start_time >= now,
    )
    if within_hours is not None:
        stmt = stmt.where(CalendarEvent.start_time <= now + timedelta(hours=within_hours))
    return list(db.scalars(stmt.order_by(CalendarEvent.start_time)))


def related_messages(db: Session, user_id: str, event: CalendarEvent) -> list[Message]:
    """Messages whose sender or recipients overlap the event's attendees."""
    attendee_emails = {a.lower() for a in event.attendees}
    if not attendee_emails:
        return []
    candidates = db.scalars(select(Message).where(Message.user_id == user_id))
    matched: list[Message] = []
    for msg in candidates:
        msg_emails = _emails_in(msg.sender) | {e.lower() for e in msg.recipients}
        if attendee_emails & msg_emails:
            matched.append(msg)
    return matched


def prepare(db: Session, user_id: str, event: CalendarEvent) -> MeetingContextSummary:
    """Generate a meeting brief for one event from its related messages."""
    messages = related_messages(db, user_id, event)
    context = [
        f"Subject: {m.subject or '(none)'}\nFrom: {m.sender}\n{m.snippet or ''}"
        for m in messages
    ]
    return get_llm().summarize_meeting_context(
        event_title=event.title or "(untitled meeting)", related_messages=context
    )
