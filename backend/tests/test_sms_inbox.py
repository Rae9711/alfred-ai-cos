"""SMS forward webhook: ingest, dedup, auto-draft."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DraftReply, Message, User
from app.services import extraction, sms_inbox
from tests.fakes import FakeLLM, fake_commitment


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@example.com", name="Me")
    db.add(u)
    db.commit()
    return u


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(extraction, "get_llm", lambda: fake)
    monkeypatch.setattr(sms_inbox, "get_llm", lambda: fake)


def test_ingest_sms_creates_message_and_draft(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(commitments=[fake_commitment(description="Confirm")])
    _patch_llm(monkeypatch, fake)

    result = sms_inbox.ingest_sms(
        db,
        user=user,
        from_number="+15551234567",
        body="Can you meet tomorrow at 3?",
        from_name="Alex",
        message_id="msg-1",
    )
    assert result.deduped is False
    assert result.draft_created is True

    msg = db.get(Message, result.message_id)
    assert msg is not None
    assert msg.source == "sms"
    assert msg.thread_id == "+15551234567"
    assert "Alex" in msg.sender
    assert db.scalar(select(DraftReply).where(DraftReply.message_id == msg.id)) is not None


def test_ingest_sms_dedupes(db: Session, user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    first = sms_inbox.ingest_sms(
        db,
        user=user,
        from_number="5551234567",
        body="Hello",
        message_id="dup-1",
    )
    second = sms_inbox.ingest_sms(
        db,
        user=user,
        from_number="5551234567",
        body="Hello",
        message_id="dup-1",
    )
    assert second.deduped is True
    assert first.message_id == second.message_id
    assert db.query(Message).count() == 1


def test_sms_token_lookup(db: Session, user: User) -> None:
    token = sms_inbox.ensure_sms_forward_token(user)
    db.commit()
    assert sms_inbox.find_user_by_sms_token(db, token) is not None
    assert sms_inbox.find_user_by_sms_token(db, "bad") is None


def test_normalize_phone() -> None:
    assert sms_inbox.normalize_phone("(555) 123-4567") == "+15551234567"


def test_sms_webhook_endpoint(db: Session, user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import inbox as inbox_mod

    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    token = sms_inbox.ensure_sms_forward_token(user)
    db.commit()

    out = inbox_mod.sms_inbox_webhook(
        inbox_mod.SmsIn(from_number="+15559876543", body="Hi there"),
        x_sms_token=token,
        db=db,
    )
    assert out.deduped is False
    assert out.message_id
    assert out.draft_created is True
