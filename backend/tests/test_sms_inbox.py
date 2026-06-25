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


def test_resolve_sms_sender_phone_falls_back_when_missing() -> None:
    assert sms_inbox.resolve_sms_sender_phone(None) == sms_inbox.UNKNOWN_SMS_SENDER
    assert sms_inbox.resolve_sms_sender_phone("") == sms_inbox.UNKNOWN_SMS_SENDER
    assert sms_inbox.resolve_sms_sender_phone("unknown") == sms_inbox.UNKNOWN_SMS_SENDER
    assert sms_inbox.resolve_sms_sender_phone("+15551234567") == "+15551234567"


def test_sms_reply_phone_hides_placeholder_sender() -> None:
    from datetime import UTC, datetime

    msg = Message(
        user_id="u1",
        source="sms",
        external_id="sms:test",
        sender="+10000000000",
        snippet="Hi",
        sent_at=datetime.now(UTC),
        headers={"sender_phone": sms_inbox.UNKNOWN_SMS_SENDER, "sms_body": "Hi"},
    )
    assert sms_inbox.sms_reply_phone(msg) is None

    msg.headers = {"sender_phone": "+15551234567", "sms_body": "Hi"}
    assert sms_inbox.sms_reply_phone(msg) == "+15551234567"


def test_display_sender_uses_name_when_phone_unknown() -> None:
    from app.services.sms_inbox import _display_sender

    assert _display_sender(phone=sms_inbox.UNKNOWN_SMS_SENDER, name="Alex") == "Alex"
    assert _display_sender(phone=sms_inbox.UNKNOWN_SMS_SENDER, name=None) == "Unknown sender"


def test_sms_webhook_accepts_body_only_payload(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.v1 import inbox as inbox_mod

    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    token = sms_inbox.ensure_sms_forward_token(user)
    db.commit()

    out = inbox_mod.sms_inbox_webhook(
        inbox_mod.SmsIn.model_validate({"body": "Hello from minimal shortcut"}),
        x_sms_token=token,
        db=db,
    )
    assert out.deduped is False
    msg = db.get(Message, out.message_id)
    assert msg is not None
    assert msg.thread_id == sms_inbox.UNKNOWN_SMS_SENDER


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


@pytest.mark.parametrize(
    ("raw", "expected_phone"),
    [
        ({"from_number": ["+15551234567"], "body": "Hello"}, "+15551234567"),
        ({"from_number": 5551234567, "body": "Hello"}, "+15551234567"),
        ({"fromNumber": "+15551234567", "body": "Hello"}, "+15551234567"),
        ({"phone": "+15551234567", "text": "Hello"}, "+15551234567"),
        ({"sender": {"phone": "+15551234567"}, "message": "Hello"}, "+15551234567"),
        (
            {"from_number": "+15551234567", "body": None, "shortcut_input": "Fallback text"},
            "+15551234567",
        ),
    ],
)
def test_sms_in_coerces_ios_shortcut_payload(raw: dict, expected_phone: str) -> None:
    from app.api.v1.inbox import SmsIn

    parsed = SmsIn.model_validate(raw)
    assert parsed.from_number == expected_phone
    assert parsed.body in ("Hello", "Fallback text")


def test_sms_webhook_accepts_array_from_number(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.v1 import inbox as inbox_mod

    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    token = sms_inbox.ensure_sms_forward_token(user)
    db.commit()

    out = inbox_mod.sms_inbox_webhook(
        inbox_mod.SmsIn.model_validate(
            {"from_number": ["+15551112222"], "body": "Shortcut array phone"}
        ),
        x_sms_token=token,
        db=db,
    )
    assert out.deduped is False
    msg = db.get(Message, out.message_id)
    assert msg is not None
    assert msg.thread_id == "+15551112222"


def test_ingest_sms_succeeds_when_auto_draft_fails(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))

    def boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("LLM down")

    monkeypatch.setattr(sms_inbox, "_auto_draft_reply", boom)

    result = sms_inbox.ingest_sms(
        db,
        user=user,
        from_number="+15551234567",
        body="Can you meet tomorrow?",
        message_id="draft-fail-1",
    )
    assert result.deduped is False
    assert result.draft_created is False
    msg = db.get(Message, result.message_id)
    assert msg is not None
    assert msg.source == "sms"


def test_list_inbox_sms_scope_returns_only_texts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import UTC, datetime

    from app.api.v1 import messages as messages_mod

    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    sms_inbox.ingest_sms(
        db,
        user=user,
        from_number="+15551234567",
        body="Text me back",
        message_id="sms-tab-1",
    )
    db.add(
        Message(
            user_id=user.id,
            source="gmail",
            external_id="gmail:1",
            sender="boss@corp.com",
            subject="Quarterly review",
            snippet="Please review",
            sent_at=datetime.now(UTC),
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="sms", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].source == "sms"
    assert "Text me back" in (out.messages[0].snippet or "")
