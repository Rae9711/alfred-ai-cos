"""Tests for the SendEmail capability: ownership validation, the seed (no-Google) path,
and the real send path with gmail mocked. Confirms it sends the user's own draft via the
user's own token, and that it's a level-3 (approval-gated) non-reversible action."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.capabilities.base import CapabilityError
from app.capabilities.providers.send_email import SendEmailCapability
from app.db.enums import ActionType, Provider, RiskLevel
from app.db.models import ConnectedAccount, DraftReply, Message, User
from app.services import gmail
from app.services.crypto import encrypt_token


def _user_with_message(db: Session, *, seed: bool) -> tuple[User, DraftReply]:
    user = User(email="sender@example.com")
    db.add(user)
    db.flush()
    db.add(
        ConnectedAccount(
            user_id=user.id,
            provider=Provider.google,
            provider_account_email=user.email,
            scopes=["seed"] if seed else ["https://www.googleapis.com/auth/gmail.send"],
            token_ciphertext=encrypt_token({"token": "x"}),
        )
    )
    db.flush()
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id,
            ConnectedAccount.provider == Provider.google,
        )
    )
    msg = Message(
        user_id=user.id,
        connected_account_id=account.id if account else None,
        external_id="m1",
        thread_id="t1",
        sender="dana@example.com",
        subject="Lunch?",
        snippet="want to grab lunch",
    )
    db.add(msg)
    db.flush()
    draft = DraftReply(user_id=user.id, message_id=msg.id, subject="Re: Lunch?", body="Yes!")
    db.add(draft)
    db.commit()
    return user, draft


def test_describe_is_external_comm_level3() -> None:
    desc = SendEmailCapability().describe()
    assert desc.action_type == ActionType.send_email
    assert desc.risk_level == RiskLevel.external_comm  # level 3 → approval-gated


def test_validate_rejects_other_users_draft(db: Session) -> None:
    _user, draft = _user_with_message(db, seed=True)
    other = User(email="intruder@example.com")
    db.add(other)
    db.commit()
    with pytest.raises(CapabilityError, match="Draft not found"):
        SendEmailCapability().validate(db, other, {"draft_reply_id": draft.id})


def test_validate_rejects_missing_draft(db: Session) -> None:
    user, _draft = _user_with_message(db, seed=True)
    with pytest.raises(CapabilityError, match="Draft not found"):
        SendEmailCapability().validate(db, user, {"draft_reply_id": "nope"})


def test_seed_account_simulates_send(db: Session) -> None:
    user, draft = _user_with_message(db, seed=True)
    result = SendEmailCapability().execute(db, user, {"draft_reply_id": draft.id})
    assert "dev seed" in result.detail
    assert result.reversible is False


def test_real_send_uses_send_message(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user, draft = _user_with_message(db, seed=False)
    rec: dict[str, Any] = {}

    def fake_send_message(_token: dict[str, Any], **kw: Any) -> dict[str, Any]:
        rec.update(kw)
        return {"id": "sent_1", "thread_id": "t1"}

    monkeypatch.setattr(gmail, "send_message", fake_send_message)
    result = SendEmailCapability().execute(db, user, {"draft_reply_id": draft.id})

    # Sends to the original sender, on the source thread, with the user's draft body.
    assert rec["to"] == "dana@example.com"
    assert rec["body"] == "Yes!"
    assert rec["thread_id"] == "t1"
    assert "dana@example.com" in result.detail
    assert result.reversible is False  # email left the mailbox


def test_real_send_uses_existing_gmail_draft_when_present(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, draft = _user_with_message(db, seed=False)
    draft.gmail_draft_id = "gdraft_9"
    db.commit()
    sent_ids: list[str] = []
    monkeypatch.setattr(
        gmail, "send_draft", lambda _t, did: sent_ids.append(did) or {"id": "s", "thread_id": "t1"}
    )
    SendEmailCapability().execute(db, user, {"draft_reply_id": draft.id})
    assert sent_ids == ["gdraft_9"]  # sent the already-pushed draft, not a fresh compose
