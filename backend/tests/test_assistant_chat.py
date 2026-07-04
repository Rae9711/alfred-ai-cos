"""Contextual assistant chat tests."""

from __future__ import annotations

from datetime import UTC, datetime

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
    ctx, _cited_ids = build_assistant_context(db, user, tz="America/New_York")
    assert "open loop" in ctx.lower() or "Top priorities" in ctx


def test_build_assistant_context_includes_sms(db: Session, user: User) -> None:
    from app.db.models import Message

    msg = Message(
        user_id=user.id,
        source="sms",
        external_id="sms-1",
        sender="+15551234567",
        subject=None,
        snippet="Dinner Friday at 7?",
        sent_at=datetime.now(UTC),
        classification="needs_reply",
        action_required=True,
    )
    db.add(msg)
    db.commit()
    ctx, cited_ids = build_assistant_context(db, user, tz="America/New_York")
    assert "sms" in ctx.lower()
    assert msg.id in cited_ids


def test_chat_with_context_no_context_returns_empty_state(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(chat_has_context=False)
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(db, user, text="what am I forgetting", tz="America/New_York")
    assert "nothing" in outcome.reply.lower()
    assert "not sure" not in outcome.reply.lower()


def test_chat_with_context_rejects_hallucinated_citation(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(
        chat_reply="You have a meeting with Sarah at 3pm.",
        chat_cited_ids=["does-not-exist-in-context"],
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(db, user, text="what's next", tz="America/New_York")
    assert "Sarah" not in outcome.reply
    assert "not confident" in outcome.reply.lower()


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
    assert len(fake.interpret_calls) == 1


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


# T9 — interpret_and_act's deterministic path and answer_contextual_question's
# free-form path must stay separated (user-main-eng-review-test-plan-
# 20260702-172820.md). test_chat_with_context_creates_reminder above covers the
# case where a real action IS produced (chat_calls stays empty); these two cover
# the other sides of the same invariant.


def test_chat_with_context_plain_question_never_calls_interpret(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Text with no action hint must skip interpret_and_act's LLM call entirely."""
    fake = FakeLLM(chat_reply="You have nothing urgent right now.")
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(db, user, text="how am I doing today", tz="America/New_York")
    assert outcome.reply == "You have nothing urgent right now."
    assert fake.interpret_calls == []
    assert len(fake.chat_calls) == 1


def test_chat_with_context_falls_through_to_free_form_when_no_real_action(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Action-shaped text that resolves to no real action must still fall through
    to the grounded free-form path, not give up with the generic reply."""
    from app.db.models import Task

    fake = FakeLLM(
        interpretation=AssistantInterpretation(intent="none", reply=""),
        chat_reply="Nothing on your task list needs attention right now.",
    )
    monkeypatch.setattr("app.services.assistant.get_llm", lambda: fake)
    outcome = chat_with_context(
        db, user, text="can you help me with my task list", tz="America/New_York"
    )
    # "task" is an action hint, so interpret_and_act is attempted first...
    assert len(fake.interpret_calls) == 1
    # ...but it resolved to no real action, so the free-form path runs instead
    # of surfacing the generic "I'm not sure how to help" reply.
    assert len(fake.chat_calls) == 1
    assert outcome.reply == "Nothing on your task list needs attention right now."
    assert outcome.action == "none"
    assert db.query(Task).filter(Task.user_id == user.id).count() == 0
