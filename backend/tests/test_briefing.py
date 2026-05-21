"""Briefing service tests against in-memory SQLite + a fake LLM."""

from datetime import date

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
