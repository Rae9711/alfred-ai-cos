"""Tests for calendar sync cleanup and event mutations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.capabilities.providers.calendar_event_mutate import (
    DeleteCalendarEventCapability,
    UpdateCalendarEventCapability,
)
from app.db.enums import ActionType, Provider
from app.db.models import CalendarEvent, ConnectedAccount, User
from app.services import calendar, gcal


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com", preferences={"proactiveness": "balanced"})
    db.add(user)
    db.commit()
    return user


def _seed_event(
    db: Session, user: User, external_id: str, *, hours_ahead: int = 2
) -> CalendarEvent:
    start = datetime.now(UTC) + timedelta(hours=hours_ahead)
    event = CalendarEvent(
        user_id=user.id,
        external_id=external_id,
        title="Old title",
        start_time=start,
        end_time=start + timedelta(hours=1),
        attendees=[],
        prep_required=False,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def test_sync_calendar_removes_stale_local_events(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        token_ciphertext="enc",
        scopes=["calendar.readonly", "calendar.events"],
    )
    db.add(account)
    db.commit()

    kept = _seed_event(db, user, "keep_me", hours_ahead=3)
    stale = _seed_event(db, user, "gone", hours_ahead=4)

    start = datetime.now(UTC) + timedelta(hours=3)
    monkeypatch.setattr(
        gcal,
        "list_upcoming_events",
        lambda _token, **kw: [
            {
                "external_id": "keep_me",
                "title": kept.title,
                "start_time": start,
                "end_time": start + timedelta(hours=1),
                "location": None,
                "description": None,
                "attendees": [],
                "html_link": "https://calendar.google.com/keep",
            }
        ],
    )
    monkeypatch.setattr(calendar, "decrypt_token", lambda _c: {"token": "x"})
    monkeypatch.setattr(calendar, "fresh_credentials", lambda _t: (None, {"token": "x"}))

    calendar.sync_calendar(db, user.id)
    assert db.get(CalendarEvent, kept.id) is not None
    assert db.get(CalendarEvent, stale.id) is None


def test_update_capability_requires_event_id() -> None:
    from app.capabilities.base import CapabilityError

    with pytest.raises(CapabilityError, match="event_id"):
        UpdateCalendarEventCapability().validate(None, User(email="a@b.com"), {})  # type: ignore[arg-type]


def test_delete_capability_describes_reversible_write() -> None:
    desc = DeleteCalendarEventCapability().describe()
    assert desc.action_type == ActionType.delete_calendar_event


class _FakeEvents:
    def __init__(self, recorder: dict[str, Any]) -> None:
        self._rec = recorder

    def get(self, *, calendarId: str, eventId: str) -> _FakeEvents:
        self._rec["get"] = {"calendarId": calendarId, "eventId": eventId}
        return self

    def update(self, *, calendarId: str, eventId: str, body: dict[str, Any]) -> _FakeEvents:
        self._rec["update"] = {"calendarId": calendarId, "eventId": eventId, "body": body}
        return self

    def delete(self, *, calendarId: str, eventId: str) -> _FakeEvents:
        self._rec["delete"] = {"calendarId": calendarId, "eventId": eventId}
        return self

    def execute(self) -> dict[str, Any]:
        if "update" in self._rec:
            b = self._rec["update"]["body"]
            return {
                "id": self._rec["update"]["eventId"],
                "summary": b.get("summary", "Updated"),
                "start": b.get("start", {"dateTime": "2026-05-28T17:00:00+00:00"}),
                "end": b.get("end", {"dateTime": "2026-05-28T18:00:00+00:00"}),
                "htmlLink": "https://calendar.google.com/updated",
            }
        return {"id": self._rec.get("get", {}).get("eventId", "evt")}


class _FakeService:
    def __init__(self, recorder: dict[str, Any]) -> None:
        self._rec = recorder

    def events(self) -> _FakeEvents:
        return _FakeEvents(self._rec)


def test_gcal_delete_event_calls_primary_calendar(monkeypatch: pytest.MonkeyPatch) -> None:
    rec: dict[str, Any] = {}
    monkeypatch.setattr(gcal, "_service", lambda _token: _FakeService(rec))
    gcal.delete_event({"token": "x"}, "evt_123")
    assert rec["delete"] == {"calendarId": "primary", "eventId": "evt_123"}
