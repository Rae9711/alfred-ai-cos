"""Tests for rules-based habit detection and proactive suggestions."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, User
from app.services import habits as habits_service


TODAY = date(2026, 7, 1)  # Wednesday
NOW = datetime(2026, 7, 1, 8, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="habit@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def _gym_event(user_id: str, when: datetime) -> CalendarEvent:
    return CalendarEvent(
        user_id=user_id,
        external_id=f"gym-{when.isoformat()}",
        title="健身",
        start_time=when,
        end_time=when + timedelta(hours=1),
        attendees=[],
        prep_required=False,
    )


def test_detect_habits_tue_thu_morning_gym(user: User) -> None:
    # Tuesdays and Thursdays at 7am EDT (11:00 UTC in summer).
    events = []
    for week in range(4):
        tue = datetime(2026, 6, 2 + week * 7, 11, 0, tzinfo=UTC)
        thu = datetime(2026, 6, 4 + week * 7, 11, 0, tzinfo=UTC)
        events.append(_gym_event(user.id, tue))
        events.append(_gym_event(user.id, thu))

    detected = habits_service.detect_habits_from_events(
        events, timezone=user.timezone, reference=TODAY
    )
    assert len(detected) == 1
    habit = detected[0]
    assert habit.activity == "健身"
    assert set(habit.typical_days) == {1, 3}
    assert habit.start_time.hour == 7
    assert habit.confidence >= 0.35


def test_build_habit_suggestion_when_unscheduled_today(db: Session, user: User) -> None:
    # Seed past habit pattern on Tue/Thu only — today is Wed, so no suggestion yet.
    for week in range(4):
        db.add(_gym_event(user.id, datetime(2026, 6, 2 + week * 7, 11, 0, tzinfo=UTC)))
        db.add(_gym_event(user.id, datetime(2026, 6, 4 + week * 7, 11, 0, tzinfo=UTC)))
    db.commit()
    habits_service.sync_user_habits(db, user.id, today=TODAY)

    wed = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    suggestions = habits_service.build_habit_suggestions(
        db, user.id, today=date(2026, 7, 1), locale="zh", now=wed
    )
    assert suggestions == []

    # Thursday with no event scheduled → proactive prompt.
    thu = datetime(2026, 7, 2, 12, 0, tzinfo=UTC)
    suggestions = habits_service.build_habit_suggestions(
        db, user.id, today=date(2026, 7, 2), locale="zh", now=thu
    )
    assert len(suggestions) == 1
    assert "健身" in suggestions[0].prompt
    assert "周四" in suggestions[0].pattern_summary or "周二" in suggestions[0].pattern_summary


def test_no_suggestion_when_event_already_scheduled(db: Session, user: User) -> None:
    for week in range(4):
        db.add(_gym_event(user.id, datetime(2026, 6, 2 + week * 7, 11, 0, tzinfo=UTC)))
        db.add(_gym_event(user.id, datetime(2026, 6, 4 + week * 7, 11, 0, tzinfo=UTC)))
    db.add(_gym_event(user.id, datetime(2026, 7, 2, 11, 0, tzinfo=UTC)))
    db.commit()
    habits_service.sync_user_habits(db, user.id, today=date(2026, 7, 2))

    thu = datetime(2026, 7, 2, 12, 0, tzinfo=UTC)
    suggestions = habits_service.build_habit_suggestions(
        db, user.id, today=date(2026, 7, 2), locale="zh", now=thu
    )
    assert suggestions == []
