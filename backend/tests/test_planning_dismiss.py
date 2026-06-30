"""Tests for per-day planning / habit suggestion dismissals."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, User
from app.services import habits as habits_service
from app.services.planning_dismiss import dismiss_suggestion, is_dismissed

TODAY = date(2026, 7, 2)  # Thursday
NOW = datetime(2026, 7, 2, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="dismiss@example.com", timezone="America/New_York")
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


def test_dismiss_habit_hides_for_today_only(db: Session, user: User) -> None:
    for week in range(4):
        db.add(_gym_event(user.id, datetime(2026, 6, 2 + week * 7, 11, 0, tzinfo=UTC)))
        db.add(_gym_event(user.id, datetime(2026, 6, 4 + week * 7, 11, 0, tzinfo=UTC)))
    db.commit()
    habits_service.sync_user_habits(db, user.id, today=TODAY)

    suggestions = habits_service.build_habit_suggestions(
        db, user.id, today=TODAY, locale="zh", now=NOW
    )
    assert len(suggestions) == 1
    habit_id = suggestions[0].habit_id

    dismiss_suggestion(db, user, kind="habit", item_id=habit_id, day=TODAY)
    db.refresh(user)

    assert is_dismissed(user, kind="habit", item_id=habit_id, day=TODAY)
    assert not is_dismissed(user, kind="habit", item_id=habit_id, day=TODAY + timedelta(days=1))

    after = habits_service.build_habit_suggestions(
        db, user.id, today=TODAY, locale="zh", now=NOW
    )
    assert after == []
