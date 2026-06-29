"""Assistant interpret-and-act tests."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import CalendarEvent, Task, User
from app.schemas.llm import AssistantInterpretation
from app.services.assistant import interpret_and_act
from tests.fakes import FakeLLM


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="ask@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def test_check_calendar_uses_llm_reply(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="check_calendar",
            reply="Tomorrow you have standup at 9am.",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(db, user, text="What's on tomorrow?", tz="America/New_York")
    assert out.action == "none"
    assert "standup" in out.reply


def test_check_calendar_falls_back_to_events(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    start = datetime.now(UTC) + timedelta(hours=3)
    db.add(
        CalendarEvent(
            user_id=user.id,
            external_id="evt_1",
            title="Dentist",
            start_time=start,
            end_time=start + timedelta(hours=1),
            attendees=[],
            prep_required=False,
        )
    )
    db.commit()
    fake = FakeLLM(interpretation=AssistantInterpretation(intent="check_calendar", reply=""))
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(db, user, text="What's coming up?", tz="America/New_York")
    assert out.action == "none"
    assert "Dentist" in out.reply


def test_none_replaces_calendar_only_refusal(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="none",
            reply="I can only help with calendar events.",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(db, user, text="Hello", tz="America/New_York")
    assert out.action == "none"
    assert "only help with calendar" not in out.reply.lower()
    assert "Inbox" in out.reply


def test_none_passes_through_general_reply(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="none",
            reply="The capital of France is Paris.",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(db, user, text="What is the capital of France?", tz="America/New_York")
    assert out.reply == "The capital of France is Paris."


def test_create_task_from_reminder(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    due = date.today() + timedelta(days=1)
    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="create_task",
            title="Pay rent",
            due_date=due,
            reply="",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(
        db, user, text="明天提醒我交房租", tz="America/New_York"
    )
    assert out.action == "created"
    assert "Pay rent" in out.reply
    task = db.query(Task).filter(Task.user_id == user.id).one()
    assert task.title == "Pay rent"
    assert task.due_date == due
    assert task.remind_at is not None


def test_create_task_fallback_when_llm_misses_intent(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="none",
            reply="好的，明天我会提醒你交房租。",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    out = interpret_and_act(
        db, user, text="明天提醒我交房租", tz="America/New_York"
    )
    assert out.action == "created"
    task = db.query(Task).filter(Task.user_id == user.id).one()
    assert "房租" in task.title
    assert task.due_date == date.today() + timedelta(days=1)
