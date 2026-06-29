"""Contextual assistant chat tests."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.models import User
from app.schemas.llm import AssistantInterpretation
from app.services.assistant import build_assistant_context, chat_with_context
from tests.fakes import FakeLLM


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="chat@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def test_build_assistant_context_includes_summary(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: FakeLLM())
    ctx = build_assistant_context(db, user, tz="America/New_York")
    assert "open loop" in ctx.lower() or "Top priorities" in ctx


def test_chat_with_context_uses_llm(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(chat_reply="You forgot to reply to Dana.")
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(db, user, text="What am I forgetting?", tz="America/New_York")
    assert outcome.reply == "You forgot to reply to Dana."
    assert outcome.action == "none"
    assert len(fake.chat_calls) == 1


def test_chat_with_context_creates_reminder(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import date, timedelta

    from app.db.models import Task

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
    outcome = chat_with_context(
        db, user, text="remind me tomorrow to pay rent", tz="America/New_York"
    )
    assert "Pay rent" in outcome.reply
    assert outcome.action == "created"
    assert outcome.task_id is not None
    assert db.query(Task).filter(Task.user_id == user.id).count() == 1
    assert len(fake.chat_calls) == 0


def test_chat_with_context_creates_reminder_on_check_calendar_mislabel(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.db.models import Task

    fake = FakeLLM(
        interpretation=AssistantInterpretation(
            intent="check_calendar",
            reply="明天提醒我",
        )
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(
        db, user, text="明天提醒我交房租", tz="America/New_York"
    )
    assert outcome.action == "created"
    assert "房租" in (outcome.task_title or "")
    assert db.query(Task).filter(Task.user_id == user.id).count() == 1
