"""Tests for the snooze module: parser, snooze action, wake conditions, and
the scan_wakes scanner."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, Message, User
from app.services import snooze

TODAY = date(2026, 6, 4)  # Thursday


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="snooze@example.com")
    db.add(u)
    db.commit()
    return u


# --- parser ---


def test_parse_tomorrow() -> None:
    spec = snooze.parse("tomorrow", today=TODAY)
    assert spec is not None
    assert spec.until_date == TODAY + timedelta(days=1)


def test_parse_relative_days() -> None:
    spec = snooze.parse("+3d", today=TODAY)
    assert spec is not None
    assert spec.until_date == TODAY + timedelta(days=3)


def test_parse_relative_weeks() -> None:
    spec = snooze.parse("+2w", today=TODAY)
    assert spec is not None
    assert spec.until_date == TODAY + timedelta(days=14)


def test_parse_weekday_jumps_to_next() -> None:
    # TODAY is Thursday (weekday=3). "monday" should jump to next Monday.
    spec = snooze.parse("monday", today=TODAY)
    assert spec is not None
    assert spec.until_date == TODAY + timedelta(days=4)


def test_parse_weekday_same_day_jumps_a_full_week() -> None:
    # Asking for the SAME weekday means next week, not today.
    spec = snooze.parse("thursday", today=TODAY)
    assert spec is not None
    assert spec.until_date == TODAY + timedelta(days=7)


def test_parse_iso_date() -> None:
    spec = snooze.parse("2026-07-01", today=TODAY)
    assert spec is not None
    assert spec.until_date == date(2026, 7, 1)


def test_parse_until_reply() -> None:
    spec = snooze.parse("until reply", today=TODAY)
    assert spec is not None
    assert spec.until_reply is True
    assert spec.until_date is None


def test_parse_unknown_returns_none() -> None:
    assert snooze.parse("at some point", today=TODAY) is None


# --- snooze + wake ---


def _commit(user_id: str, *, source_id: str | None = None) -> Commitment:
    return Commitment(
        user_id=user_id,
        description="Reply to the proposal",
        evidence=None,
        owner=CommitmentOwner.user,
        counterparty="Mary",
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=0.9,
    )


def test_snooze_sets_status_and_date(db: Session, user: User) -> None:
    c = _commit(user.id)
    db.add(c)
    db.commit()
    spec = snooze.SnoozeSpec(until_date=TODAY + timedelta(days=3))
    snooze.snooze(db, c, spec=spec)
    assert c.status == CommitmentStatus.snoozed
    assert c.snooze_until == TODAY + timedelta(days=3)


def test_wake_clears_conditions(db: Session, user: User) -> None:
    c = _commit(user.id)
    db.add(c)
    db.commit()
    snooze.snooze(db, c, spec=snooze.SnoozeSpec(until_date=TODAY))
    snooze.wake(db, c)
    assert c.status == CommitmentStatus.open
    assert c.snooze_until is None
    assert c.snooze_until_reply is False


# --- scan_wakes ---


def test_scan_wakes_reopens_past_date(db: Session, user: User) -> None:
    c = _commit(user.id)
    db.add(c)
    db.commit()
    snooze.snooze(db, c, spec=snooze.SnoozeSpec(until_date=TODAY - timedelta(days=1)))
    assert snooze.scan_wakes(db, user.id, today=TODAY) == 1
    db.refresh(c)
    assert c.status == CommitmentStatus.open


def test_scan_wakes_skips_future_date(db: Session, user: User) -> None:
    c = _commit(user.id)
    db.add(c)
    db.commit()
    snooze.snooze(db, c, spec=snooze.SnoozeSpec(until_date=TODAY + timedelta(days=5)))
    assert snooze.scan_wakes(db, user.id, today=TODAY) == 0
    db.refresh(c)
    assert c.status == CommitmentStatus.snoozed


def test_scan_wakes_reopens_when_reply_arrives(db: Session, user: User) -> None:
    src = Message(
        user_id=user.id,
        external_id="src",
        thread_id="t-reply",
        sender="mary@buyer.co",
        recipients=["snooze@example.com"],
        sent_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
    )
    db.add(src)
    db.commit()
    c = _commit(user.id, source_id=src.id)
    db.add(c)
    db.commit()
    snooze.snooze(db, c, spec=snooze.SnoozeSpec(until_reply=True))
    # A reply arrives on the same thread after the snooze. We stamp the reply
    # to a far-future time so it's guaranteed to be after the wall-clock moment
    # the snooze flipped updated_at.
    db.add(
        Message(
            user_id=user.id,
            external_id="reply",
            thread_id="t-reply",
            sender="mary@buyer.co",
            recipients=["snooze@example.com"],
            sent_at=datetime(2099, 6, 4, 9, 0, tzinfo=UTC),
        )
    )
    db.commit()
    assert snooze.scan_wakes(db, user.id, today=TODAY) == 1
    db.refresh(c)
    assert c.status == CommitmentStatus.open


def test_scan_wakes_skips_when_no_new_reply(db: Session, user: User) -> None:
    src = Message(
        user_id=user.id,
        external_id="src2",
        thread_id="t-quiet",
        sender="mary@buyer.co",
        recipients=["snooze@example.com"],
        sent_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
    )
    db.add(src)
    db.commit()
    c = _commit(user.id, source_id=src.id)
    db.add(c)
    db.commit()
    snooze.snooze(db, c, spec=snooze.SnoozeSpec(until_reply=True))
    assert snooze.scan_wakes(db, user.id, today=TODAY) == 0
    db.refresh(c)
    assert c.status == CommitmentStatus.snoozed
