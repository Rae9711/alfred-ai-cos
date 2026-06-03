"""Briefing service tests against in-memory SQLite + a fake LLM."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.models import DailyBriefing, User
from app.services import briefing as briefing_service
from tests.fakes import FakeLLM

TODAY = date(2026, 5, 21)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="brief@example.com")
    db.add(u)
    db.commit()
    return u


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(briefing_service, "get_llm", lambda: fake)


def test_generate_creates_one_briefing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM()
    _patch_llm(monkeypatch, fake)
    result = briefing_service.generate_briefing(db, user.id, today=TODAY)
    assert result.summary == "Good morning. 1 thing matters today."
    assert result.date == TODAY
    assert db.query(DailyBriefing).count() == 1
    # The snapshot is the Today payload the LLM saw.
    assert "summary" in fake.briefing_calls[0]


def test_generate_is_idempotent_per_day(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM())
    first = briefing_service.generate_briefing(db, user.id, today=TODAY)
    second = briefing_service.generate_briefing(db, user.id, today=TODAY)
    assert first.id == second.id  # replaced, not duplicated
    assert db.query(DailyBriefing).count() == 1


def test_get_today_returns_none_when_absent(db: Session, user: User) -> None:
    assert briefing_service.get_today_briefing(db, user.id, today=TODAY) is None


# --- per-user-tz morning scheduling ---


def test_due_briefing_date_inside_window_returns_local_today(db: Session, user: User) -> None:
    # 13:00 UTC = 08:00 New York (EDT, UTC-4 in June) — inside the 07-09 window.
    user.timezone = "America/New_York"
    db.add(user)
    db.commit()
    now_utc = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    target = briefing_service.due_briefing_date(db, user, now_utc=now_utc)
    assert target == date(2026, 6, 2)


def test_due_briefing_date_outside_window_returns_none(db: Session, user: User) -> None:
    user.timezone = "America/New_York"
    db.add(user)
    db.commit()
    # 18:00 UTC = 14:00 New York — well past morning.
    now_utc = datetime(2026, 6, 2, 18, 0, tzinfo=UTC)
    assert briefing_service.due_briefing_date(db, user, now_utc=now_utc) is None


def test_due_briefing_date_none_when_briefing_already_exists(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    user.timezone = "America/New_York"
    db.add(user)
    _patch_llm(monkeypatch, FakeLLM())
    # Pre-generate today's briefing in NY local time.
    briefing_service.generate_briefing(db, user.id, today=date(2026, 6, 2))
    now_utc = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    assert briefing_service.due_briefing_date(db, user, now_utc=now_utc) is None


def test_due_briefing_date_handles_bad_timezone(db: Session, user: User) -> None:
    # Garbage timezone falls back to UTC, so 08:00 UTC sits inside the window.
    user.timezone = "Mars/Olympus_Mons"
    db.add(user)
    db.commit()
    now_utc = datetime(2026, 6, 2, 8, 0, tzinfo=UTC)
    assert briefing_service.due_briefing_date(db, user, now_utc=now_utc) == date(2026, 6, 2)


def test_due_briefing_date_respects_user_local_date_rollover(db: Session, user: User) -> None:
    # Tokyo is UTC+9. At 23:00 UTC on June 2nd, Tokyo is already 08:00 on June 3rd.
    user.timezone = "Asia/Tokyo"
    db.add(user)
    db.commit()
    now_utc = datetime(2026, 6, 2, 23, 0, tzinfo=UTC)
    assert briefing_service.due_briefing_date(db, user, now_utc=now_utc) == date(2026, 6, 3)
