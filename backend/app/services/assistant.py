"""Shared assistant logic: resolve the user's timezone and interpret-then-act.

Both the Ask endpoint (free text) and the Inbox "Yes/Add to calendar" action route
through here, so calendar actions from natural language have one audited path."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.db.enums import ActionType
from app.db.models import User
from app.llm import get_llm
from app.services import execution, meeting_prep
from app.services.actions import propose_action_internal


def resolve_timezone(db: Session, user: User, requested: str | None) -> str:
    """Prefer a valid requested (device) timezone and persist it; else the stored one."""
    if requested and requested != user.timezone:
        try:
            ZoneInfo(requested)
            user.timezone = requested
            db.commit()
            return requested
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return user.timezone or "UTC"


def _now_in_tz(timezone: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now(UTC)


def _format_upcoming(db: Session, user_id: str) -> str:
    lines: list[str] = []
    for event in meeting_prep.upcoming_events(db, user_id, within_hours=24 * 14)[:20]:
        when = event.start_time.isoformat() if event.start_time else "?"
        lines.append(f"- id={event.id} | {event.title or 'Untitled'} | {when}")
    return "\n".join(lines) if lines else "(none)"


def _format_local_time(iso: datetime, tz: str) -> str:
    try:
        local = iso.astimezone(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = iso
    return local.strftime("%a %b %-d, %-I:%M %p")


def _calendar_check_reply(db: Session, user_id: str, tz: str) -> str:
    """Fallback when the LLM marks a read-only calendar query but leaves reply empty."""
    events = meeting_prep.upcoming_events(db, user_id, within_hours=48)
    if not events:
        return "Nothing on your calendar in the next couple of days."
    lines = [
        f"• {_format_local_time(e.start_time, tz)} — {e.title or 'Untitled'}"
        for e in events[:8]
        if e.start_time
    ]
    return "Here's what's coming up:\n" + "\n".join(lines)


_CALENDAR_ONLY_RE = (
    r"only help with calendar|can only help with calendar|"
    r"只能.*日历|仅.*日历"
)


@dataclass
class AssistantOutcome:
    action: str  # booked | updated | cancelled | none
    reply: str
    detail: str | None = None


def interpret_and_act(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    """Interpret free text; book, reschedule, or cancel through the capability spine."""
    now = _now_in_tz(tz)
    upcoming = _format_upcoming(db, user.id)
    interp = get_llm().interpret_request(
        text=text,
        now_iso=now.isoformat(),
        timezone=tz,
        upcoming_events=upcoming,
    )

    if interp.intent == "book_calendar" and interp.start and interp.end and interp.title:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_calendar_event,
            target={"title": interp.title, "start": interp.start, "end": interp.end},
            reason="Booked from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="booked", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "reschedule_calendar" and interp.event_id and (interp.start or interp.end):
        target: dict[str, str] = {"event_id": interp.event_id}
        if interp.start:
            target["start"] = interp.start
        if interp.end:
            target["end"] = interp.end
        if interp.title:
            target["title"] = interp.title
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.update_calendar_event,
            target=target,
            reason="Rescheduled from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="updated", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "cancel_calendar" and interp.event_id:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.delete_calendar_event,
            target={"event_id": interp.event_id},
            reason="Cancelled from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return AssistantOutcome(
            action="cancelled", reply=interp.reply or result.detail, detail=result.detail
        )

    if interp.intent == "check_calendar":
        reply = (interp.reply or "").strip() or _calendar_check_reply(db, user.id, tz)
        return AssistantOutcome(action="none", reply=reply)

    reply = (interp.reply or "").strip()
    if not reply or re.search(_CALENDAR_ONLY_RE, reply, re.IGNORECASE):
        reply = (
            "I can check or book your calendar, draft a text by name "
            '(e.g. "text Mom: see you tomorrow" or "给 Mom 发：明天见"), '
            "or help reply from Inbox. What would you like?"
        )
    return AssistantOutcome(action="none", reply=reply)


# Back-compat alias used by message booking tests.
def interpret_and_book(db: Session, user: User, *, text: str, tz: str) -> AssistantOutcome:
    return interpret_and_act(db, user, text=text, tz=tz)
