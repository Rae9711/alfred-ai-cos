"""Tests for calendar booking: the create-event capability's validation and the gcal
write payload. Pure/mocked — no Google API calls."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest

from app.capabilities.base import CapabilityError
from app.capabilities.providers.calendar_event import CalendarEventCapability
from app.db.enums import ActionType, RiskLevel
from app.db.models import User
from app.services import gcal

# ── Capability metadata + validation ─────────────────────────────────────────


def test_describe_is_reversible_write() -> None:
    desc = CalendarEventCapability().describe()
    assert desc.action_type == ActionType.create_calendar_event
    assert desc.risk_level == RiskLevel.reversible_write  # level 2: no approval card


def _payload(**kw: Any) -> dict[str, Any]:
    base = {
        "title": "Focus block",
        "start": "2026-05-28T17:00:00+02:00",
        "end": "2026-05-28T18:00:00+02:00",
    }
    base.update(kw)
    return base


def test_validate_accepts_a_well_formed_booking() -> None:
    CalendarEventCapability().validate(None, User(email="a@b.com"), _payload())  # type: ignore[arg-type]


def test_validate_rejects_missing_title() -> None:
    with pytest.raises(CapabilityError, match="title"):
        CalendarEventCapability().validate(None, User(email="a@b.com"), _payload(title=""))  # type: ignore[arg-type]


def test_validate_rejects_end_before_start() -> None:
    bad = _payload(start="2026-05-28T18:00:00+02:00", end="2026-05-28T17:00:00+02:00")
    with pytest.raises(CapabilityError, match="after its start"):
        CalendarEventCapability().validate(None, User(email="a@b.com"), bad)  # type: ignore[arg-type]


def test_validate_rejects_naive_datetime() -> None:
    # No offset → ambiguous wall clock; we require the user's tz to be encoded.
    bad = _payload(start="2026-05-28T17:00:00", end="2026-05-28T18:00:00")
    with pytest.raises(CapabilityError, match="timezone offset"):
        CalendarEventCapability().validate(None, User(email="a@b.com"), bad)  # type: ignore[arg-type]


def test_validate_rejects_unparseable_datetime() -> None:
    with pytest.raises(CapabilityError, match="valid datetime"):
        CalendarEventCapability().validate(  # type: ignore[arg-type]
            None, User(email="a@b.com"), _payload(start="tomorrow at 5")
        )


# ── gcal.create_event payload shape (mock the Google service) ────────────────


class _FakeEvents:
    def __init__(self, recorder: dict[str, Any]) -> None:
        self._rec = recorder

    def insert(self, *, calendarId: str, body: dict[str, Any]) -> _FakeEvents:
        self._rec["calendarId"] = calendarId
        self._rec["body"] = body
        return self

    def execute(self) -> dict[str, Any]:
        b = self._rec["body"]
        return {
            "id": "evt_new",
            "summary": b["summary"],
            "start": b["start"],
            "end": b["end"],
            "location": b.get("location"),
            "description": b.get("description"),
            "htmlLink": "https://calendar.google.com/evt_new",
        }


class _FakeService:
    def __init__(self, recorder: dict[str, Any]) -> None:
        self._rec = recorder

    def events(self) -> _FakeEvents:
        return _FakeEvents(self._rec)


def test_create_event_builds_primary_calendar_body(monkeypatch: pytest.MonkeyPatch) -> None:
    rec: dict[str, Any] = {}
    monkeypatch.setattr(gcal, "_service", lambda _token: _FakeService(rec))

    start = datetime(2026, 5, 28, 17, 0, tzinfo=timezone(timedelta(hours=2)))
    end = start + timedelta(hours=1)
    out = gcal.create_event(
        {"token": "x"},
        title="Focus block",
        start=start,
        end=end,
        description="Deep work",
    )

    assert rec["calendarId"] == "primary"
    assert rec["body"]["summary"] == "Focus block"
    # The offset is preserved in the dateTime we send Google (so wall-clock is correct).
    assert rec["body"]["start"]["dateTime"] == "2026-05-28T17:00:00+02:00"
    assert rec["body"]["end"]["dateTime"] == "2026-05-28T18:00:00+02:00"
    assert rec["body"]["description"] == "Deep work"
    # Normalized result carries the link + id back for the confirmation.
    assert out["external_id"] == "evt_new"
    assert out["html_link"] == "https://calendar.google.com/evt_new"


def test_create_event_omits_optional_fields_when_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rec: dict[str, Any] = {}
    monkeypatch.setattr(gcal, "_service", lambda _token: _FakeService(rec))
    start = datetime(2026, 5, 28, 9, 0, tzinfo=UTC)
    gcal.create_event(
        {"token": "x"}, title="Standup", start=start, end=start + timedelta(minutes=15)
    )
    assert "description" not in rec["body"]
    assert "location" not in rec["body"]
