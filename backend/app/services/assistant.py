"""Shared assistant logic: resolve the user's timezone and interpret-then-book.

Both the Ask endpoint (free text) and the Inbox "Yes/Add to calendar" action route
through here, so calendar booking from natural language has one audited path."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.db.enums import ActionType
from app.db.models import User
from app.llm import get_llm
from app.services import execution
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


@dataclass
class BookOutcome:
    booked: bool
    reply: str
    detail: str | None = None


def interpret_and_book(db: Session, user: User, *, text: str, tz: str) -> BookOutcome:
    """Interpret free text against the user's clock; if it's a calendar booking, create
    the event through the audited capability spine. Returns the outcome to show."""
    now = _now_in_tz(tz)
    interp = get_llm().interpret_request(text=text, now_iso=now.isoformat(), timezone=tz)

    if interp.intent == "book_calendar" and interp.start and interp.end and interp.title:
        proposal = propose_action_internal(
            db,
            user,
            action_type=ActionType.create_calendar_event,
            target={"title": interp.title, "start": interp.start, "end": interp.end},
            reason="Booked from an assistant request",
        )
        result = execution.execute_proposal(db, user, proposal)
        return BookOutcome(booked=True, reply=interp.reply or result.detail, detail=result.detail)

    return BookOutcome(booked=False, reply=interp.reply)
