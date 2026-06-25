"""Update and delete calendar-event capabilities (level 2 reversible writes)."""

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


def _require_event_id(payload: dict[str, Any]) -> str:
    event_id = payload.get("event_id")
    if not isinstance(event_id, str) or not event_id.strip():
        raise CapabilityError("event_id is required")
    return event_id


class UpdateCalendarEventCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.update_calendar_event,
            risk_level=RiskLevel.reversible_write,
            title="Reschedule a calendar event",
            summary="Update an event on your Google Calendar.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        _require_event_id(payload)
        start = payload.get("start")
        end = payload.get("end")
        if start is not None:
            _parse(start, "start")
        if end is not None:
            _parse(end, "end")
        if start is not None and end is not None:
            if _parse(end, "end") <= _parse(start, "start"):
                raise CapabilityError("The event end must be after its start")

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        event_id = _require_event_id(payload)
        start = _parse(payload["start"], "start") if payload.get("start") else None
        end = _parse(payload["end"], "end") if payload.get("end") else None
        event = calendar_service.update_event(
            db,
            user.id,
            event_id,
            title=payload.get("title"),
            start=start,
            end=end,
            description=payload.get("description"),
            location=payload.get("location"),
        )
        when = event.start_time.strftime("%a %d %b, %H:%M") if event.start_time else "your calendar"
        return ExecutionResult(
            detail=f"Updated “{event.title}” — {when}",
            reversible=True,
            data={"event_id": event.id},
        )


class DeleteCalendarEventCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.delete_calendar_event,
            risk_level=RiskLevel.reversible_write,
            title="Cancel a calendar event",
            summary="Remove an event from your Google Calendar.",
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        _require_event_id(payload)

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        event_id = _require_event_id(payload)
        event = calendar_service.get_event(db, user.id, event_id)
        title = event.title or "Event"
        calendar_service.delete_event(db, user.id, event_id)
        return ExecutionResult(
            detail=f"Cancelled “{title}”",
            reversible=True,
            data={"event_id": event_id},
        )
