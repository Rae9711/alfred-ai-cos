"""Contextual assistant chat tests."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.models import User
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
    reply = chat_with_context(db, user, text="What am I forgetting?", tz="America/New_York")
    assert reply == "You forgot to reply to Dana."
    assert len(fake.chat_calls) == 1
