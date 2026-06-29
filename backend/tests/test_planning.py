"""Planning suggestions: gap detection, effort heuristics, Today integration."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority, SourceType, TaskStatus
from app.db.models import CalendarEvent, Commitment, Task, User
from app.services import planning as planning_service
from app.services.today import build_today

TODAY = date(2026, 6, 29)
NOW = datetime(2026, 6, 29, 15, 0, tzinfo=UTC)  # 11:00 EDT


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="plan@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def _event(user_id: str, start: datetime, *, hours: float = 1.0, title: str) -> CalendarEvent:
    return CalendarEvent(
        user_id=user_id,
        external_id=f"ext-{title}-{start.isoformat()}",
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=hours),
        attendees=[],
        prep_required=False,
    )


def _commitment(user_id: str, description: str, **kwargs) -> Commitment:
    defaults = dict(
        user_id=user_id,
        description=description,
        owner=CommitmentOwner.user,
        counterparty="Barnes",
        due_date=TODAY,
        priority=Priority.high,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        confidence=0.9,
    )
    defaults.update(kwargs)
    return Commitment(**defaults)


# --- pure helpers ---


def test_estimate_effort_quick_patterns() -> None:
    assert planning_service.estimate_effort_minutes("Confirm dinner RSVP") == 5
    assert planning_service.estimate_effort_minutes("Mark invoice paid") == 5


def test_estimate_effort_reply_medium() -> None:
    assert planning_service.estimate_effort_minutes("Reply to Barnes term sheet") == 15


def test_find_free_gap_before_next_meeting() -> None:
    now = NOW
    meeting_start = now + timedelta(minutes=45)
    events = [_event("u1", meeting_start, title="Client call")]
    gaps = planning_service.find_free_gaps(
        events,
        now=now,
        day_end=now + timedelta(hours=8),
    )
    assert len(gaps) >= 1
    assert gaps[0].duration_minutes == 45


def test_find_free_gap_between_meetings() -> None:
    now = NOW
    first_end = now + timedelta(minutes=30)
    second_start = first_end + timedelta(minutes=45)
    events = [
        _event("u1", now - timedelta(minutes=10), hours=40 / 60, title="Standup"),
        _event("u1", second_start, title="Review"),
    ]
    gaps = planning_service.find_free_gaps(
        events,
        now=now,
        day_end=now + timedelta(hours=8),
    )
    assert any(g.duration_minutes == 45 for g in gaps)


# --- integration ---


def test_build_planning_suggests_time_block_for_gap(db: Session, user: User) -> None:
    db.add(
        _commitment(
            user.id,
            "Finish Barnes term sheet reply",
        )
    )
    db.add(_event(user.id, NOW + timedelta(minutes=45), title="Client call"))
    db.commit()

    suggestions, quick_wins = planning_service.build_planning_suggestions(
        db, user.id, today=TODAY, now=NOW
    )

    assert len(suggestions) == 1
    assert suggestions[0].duration_minutes == 45
    assert "Barnes" in suggestions[0].title
    assert suggestions[0].item_type == "commitment"
    assert suggestions[0].estimated_minutes == 15


def test_build_planning_quick_wins(db: Session, user: User) -> None:
    # Block the calendar so items surface as quick wins, not time-block picks.
    db.add(_event(user.id, NOW - timedelta(hours=2), hours=20, title="Busy day"))
    db.add_all(
        [
            _commitment(user.id, "Confirm dinner RSVP"),
            _commitment(user.id, "Reply OK to Tom"),
            Task(
                user_id=user.id,
                title="Mark invoice paid",
                status=TaskStatus.open,
                priority=Priority.low,
                source_type=SourceType.manual,
            ),
        ]
    )
    db.commit()

    _, quick_wins = planning_service.build_planning_suggestions(
        db, user.id, today=TODAY, now=NOW
    )

    titles = {q.title for q in quick_wins}
    assert "Confirm dinner RSVP" in titles
    assert "Reply OK to Tom" in titles
    assert len(quick_wins) <= planning_service.MAX_QUICK_WINS


def test_build_today_includes_planning_fields(db: Session, user: User) -> None:
    db.add(_commitment(user.id, "Confirm dinner RSVP"))
    db.commit()

    dashboard = build_today(db, user.id, today=TODAY)

    assert isinstance(dashboard.suggestions, list)
    assert isinstance(dashboard.quick_wins, list)
    assert dashboard.suggestions or dashboard.quick_wins
