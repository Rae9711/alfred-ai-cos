"""Shared channel ingest: dedup on (user, external_id) and the extraction hand-off."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.models import Commitment, Message, User
from app.services import channel_ingest, extraction
from tests.fakes import FakeLLM, fake_commitment


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="chan@example.com", name="Chan")
    db.add(u)
    db.commit()
    return u


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(extraction, "get_llm", lambda: fake)


def test_ingest_persists_and_extracts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[fake_commitment(description="Send the report")]))
    result = channel_ingest.ingest_channel_message(
        db,
        user=user,
        source="whatsapp",
        external_id="wa:1",
        sender="Bob <15551234567>",
        body="Can you send the report by Friday?",
        thread_id="15551234567",
    )
    assert result.deduped is False
    assert result.commitments_extracted == 1

    msg = db.get(Message, result.message_id)
    assert msg is not None
    assert msg.source == "whatsapp"
    assert msg.thread_id == "15551234567"
    assert db.query(Commitment).count() == 1


def test_ingest_dedups_on_external_id(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    first = channel_ingest.ingest_channel_message(
        db, user=user, source="whatsapp", external_id="wa:dup", sender="a@b.com", body="hi"
    )
    second = channel_ingest.ingest_channel_message(
        db, user=user, source="whatsapp", external_id="wa:dup", sender="a@b.com", body="hi again"
    )
    assert first.deduped is False
    assert second.deduped is True
    assert second.message_id == first.message_id
    assert second.commitments_extracted == 0
    assert db.query(Message).count() == 1
