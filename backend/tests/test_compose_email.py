"""Tests for Ask compose-email draft + send."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.capabilities.base import CapabilityError
from app.capabilities.providers.send_email import SendEmailCapability
from app.db.enums import Provider
from app.db.models import ComposeDraft, ConnectedAccount, User
from app.services import gmail
from app.services.compose_email import create_compose_draft
from app.services.crypto import encrypt_token
from tests.fakes import FakeLLM


def _user_with_google(db: Session, *, seed: bool) -> tuple[User, ConnectedAccount]:
    user = User(email="sender@example.com", name="Ray")
    db.add(user)
    db.flush()
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        scopes=["seed"] if seed else ["https://www.googleapis.com/auth/gmail.send"],
        token_ciphertext=encrypt_token({"token": "x"}),
    )
    db.add(account)
    db.commit()
    return user, account


def test_create_compose_draft(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user, _account = _user_with_google(db, seed=True)
    monkeypatch.setattr("app.services.compose_email.get_llm", lambda: FakeLLM())

    draft = create_compose_draft(
        db,
        user,
        recipient_email="leo@example.com",
        recipient_name="Leo",
        intent="dinner tomorrow",
    )
    assert draft.recipient_email == "leo@example.com"
    assert draft.subject
    assert "dinner tomorrow" in draft.body.lower()


def test_send_compose_seed(db: Session) -> None:
    user, account = _user_with_google(db, seed=True)
    draft = ComposeDraft(
        user_id=user.id,
        connected_account_id=account.id,
        recipient_email="leo@example.com",
        recipient_name="Leo",
        subject="Dinner tomorrow?",
        body="Hi Leo,\n\nWant to grab dinner tomorrow?\n\nRay",
        tone="concise",
    )
    db.add(draft)
    db.commit()

    result = SendEmailCapability().execute(db, user, {"compose_draft_id": draft.id})
    assert "leo@example.com" in result.detail


def test_send_compose_gmail(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user, account = _user_with_google(db, seed=False)
    draft = ComposeDraft(
        user_id=user.id,
        connected_account_id=account.id,
        recipient_email="leo@example.com",
        recipient_name="Leo",
        subject="Dinner tomorrow?",
        body="Hi Leo,\n\nWant to grab dinner tomorrow?\n\nRay",
        tone="concise",
    )
    db.add(draft)
    db.commit()

    sent: list[dict[str, Any]] = []

    def fake_send(token: dict[str, Any], **kwargs: Any) -> dict[str, str]:
        sent.append(kwargs)
        return {"id": "msg_1", "thread_id": "thr_1"}

    monkeypatch.setattr(gmail, "send_message", fake_send)
    SendEmailCapability().execute(db, user, {"compose_draft_id": draft.id})
    assert sent[0]["to"] == "leo@example.com"
    assert sent[0]["subject"] == "Dinner tomorrow?"


def test_validate_rejects_other_users_compose(db: Session) -> None:
    owner, account = _user_with_google(db, seed=True)
    other = User(email="other@example.com")
    db.add(other)
    db.commit()
    draft = ComposeDraft(
        user_id=owner.id,
        connected_account_id=account.id,
        recipient_email="leo@example.com",
        recipient_name="Leo",
        subject="Hi",
        body="Hello",
        tone="concise",
    )
    db.add(draft)
    db.commit()
    with pytest.raises(CapabilityError, match="Draft not found"):
        SendEmailCapability().validate(db, other, {"compose_draft_id": draft.id})
