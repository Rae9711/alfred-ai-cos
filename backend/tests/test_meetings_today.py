"""Today's schedule listing for the home screen."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, User
from app.services import meeting_prep


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com", timezone="America/New_York")
    db.add(user)
    db.commit()
    return user


def _event(user_id: str, start: datetime, title: str) -> CalendarEvent:
    return CalendarEvent(
        user_id=user_id,
        external_id=f"ext-{title}",
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        attendees=[],
        prep_required=False,
    )


def test_today_events_includes_past_and_future_on_local_day(
    db: Session, user: User
) -> None:
    now = datetime.now(UTC)
    past_today = _event(user.id, now - timedelta(hours=2), "Morning standup")
    later_today = _event(user.id, now + timedelta(hours=2), "Afternoon sync")
    tomorrow = _event(user.id, now + timedelta(days=1), "Tomorrow")
    db.add_all([past_today, later_today, tomorrow])
    db.commit()

    out = meeting_prep.today_events(db, user.id, timezone=user.timezone)
    titles = {e.title for e in out}

    assert "Morning standup" in titles
    assert "Afternoon sync" in titles
    assert "Tomorrow" not in titles


def test_upcoming_events_excludes_past_today(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    past_today = _event(user.id, now - timedelta(hours=2), "Morning standup")
    later_today = _event(user.id, now + timedelta(hours=2), "Afternoon sync")
    db.add_all([past_today, later_today])
    db.commit()

    out = meeting_prep.upcoming_events(db, user.id)
    titles = {e.title for e in out}

    assert "Morning standup" not in titles
    assert "Afternoon sync" in titles


def test_week_events_stays_within_local_week(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    in_week = _event(user.id, now + timedelta(days=1), "This week")
    far = _event(user.id, now + timedelta(days=10), "Far away")
    db.add_all([in_week, far])
    db.commit()

    out = meeting_prep.week_events(db, user.id, timezone=user.timezone)
    titles = {e.title for e in out}

    assert "This week" in titles
    assert "Far away" not in titles
