"""Tests for week-ahead rhythm briefing."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, ScheduleProposalStatus, SourceType
from app.db.models import CalendarEvent, Commitment, ScheduleProposal, User
from app.services import week_ahead


TODAY = date(2026, 6, 29)  # Monday
NOW_MON = datetime(2026, 6, 29, 9, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="week@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def _event(user_id: str, start: datetime, title: str = "Sync") -> CalendarEvent:
    return CalendarEvent(
        user_id=user_id,
        external_id=f"ev-{start.isoformat()}",
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        attendees=[],
        prep_required=False,
    )


def test_build_week_ahead_summary_zh(db: Session, user: User) -> None:
    from app.db.models import Message

    msg = Message(
        user_id=user.id,
        source="gmail",
        external_id="week-msg-1",
        sender="friend@example.com",
        recipients=[],
        subject="Coffee?",
        sent_at=NOW_MON,
    )
    db.add(msg)
    db.flush()

    wed = datetime(2026, 7, 2, 15, 0, tzinfo=UTC)
    for i in range(5):
        db.add(_event(user.id, NOW_MON + timedelta(days=i)))
    for i in range(4):
        db.add(_event(user.id, wed + timedelta(hours=i)))
    db.add(
        ScheduleProposal(
            user_id=user.id,
            source_message_id=msg.id,
            title="Coffee",
            start_time=wed,
            end_time=wed + timedelta(hours=1),
            timezone="America/New_York",
            location=None,
            participants=[],
            confidence=0.8,
            status=ScheduleProposalStatus.pending,
        )
    )
    db.add(
        Commitment(
            user_id=user.id,
            description="Follow up on venue",
            owner=CommitmentOwner.user,
            counterparty="Sam",
            status=CommitmentStatus.open,
            source_type=SourceType.manual,
            confidence=0.7,
        )
    )
    db.commit()

    result = week_ahead.build_week_ahead(
        db, user.id, today=TODAY, locale="zh", now=NOW_MON
    )
    assert result is not None
    assert "个会" in result.summary
    assert result.busiest_day == "周四"
    assert result.pending_invites == 1
    assert result.show_prominently is True


def test_week_ahead_prominent_sunday_evening(user: User) -> None:
    sun_evening = datetime(2026, 6, 28, 22, 0, tzinfo=UTC)  # Sun 6pm EDT
    assert week_ahead.is_week_boundary_prominent(sun_evening, timezone=user.timezone)


def test_week_ahead_not_prominent_midweek(user: User) -> None:
    wed = datetime(2026, 7, 1, 15, 0, tzinfo=UTC)
    assert not week_ahead.is_week_boundary_prominent(wed, timezone=user.timezone)
