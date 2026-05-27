"""Create-calendar-event capability (level 2 reversible write). Books time on the
user's own primary calendar — deletable, no external attendees in v1, so reversible.
Inviting others would be external comm (level 3) and is intentionally out of scope here."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.db.enums import ActionType, RiskLevel
from app.db.models import User
from app.services import calendar as calendar_service


def _parse(ts: Any, field: str) -> datetime:
    if not isinstance(ts, str):
        raise CapabilityError(f"{field} must be an ISO datetime string")
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError as exc:
        raise CapabilityError(f"{field} is not a valid datetime: {ts}") from exc
    if dt.tzinfo is None:
        raise CapabilityError(f"{field} must include a timezone offset")
    return dt


class CalendarEventCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.create_calendar_event,
            risk_level=RiskLevel.reversible_write,
            title="Book time on your calendar",
            summary="Create an event on your Google Calendar.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        if not payload.get("title"):
            raise CapabilityError("An event title is required")
        start = _parse(payload.get("start"), "start")
        end = _parse(payload.get("end"), "end")
        if end <= start:
            raise CapabilityError("The event end must be after its start")

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        start = _parse(payload["start"], "start")
        end = _parse(payload["end"], "end")
        event = calendar_service.book_event(
            db,
            user.id,
            title=str(payload["title"]),
            start=start,
            end=end,
            description=payload.get("description"),
            location=payload.get("location"),
        )
        when = event.start_time.strftime("%a %d %b, %H:%M") if event.start_time else "your calendar"
        return ExecutionResult(
            detail=f"Booked “{event.title}” — {when}",
            reversible=True,
            data={"event_id": event.id},
        )
