"""Tests for forward-to-inbox: user matching, dedup, original-sender parsing,
end-to-end flow into Message + extracted Commitment, and webhook auth."""

import pytest
from sqlalchemy.orm import Session

from app.db.models import Commitment, Message, User
from app.services import extraction, forward_inbox
from tests.fakes import FakeLLM, fake_commitment

FWD_BODY = """
Hey Albert, please reply to Mary below.

---------- Forwarded message ----------
From: Mary Smith <mary@buyer.com>
Date: Mon, 2 Jun 2026 09:00:00 +0000
Subject: Quote on the contract
To: Adam <adam@adam.dev>

Hi Adam, can you send the signed contract back by Wednesday? Thanks.
"""


@pytest.fixture
def adam(db: Session) -> User:
    u = User(email="adam@adam.dev")
    db.add(u)
    db.commit()
    return u


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(extraction, "get_llm", lambda: fake)


# --- service-level ---


def test_ingest_creates_message_and_extracts(
    db: Session, adam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(
        monkeypatch, FakeLLM(commitments=[fake_commitment(description="Send the signed contract")])
    )
    result = forward_inbox.ingest_forward(
        db,
        forwarder_email="adam@adam.dev",
        subject="Fwd: Quote on the contract",
        body=FWD_BODY,
        original_message_id="<msg-1@buyer.com>",
    )
    assert result is not None
    assert result.deduped is False
    assert result.commitments_extracted == 1

    msg = db.query(Message).one()
    assert msg.user_id == adam.id
    assert msg.source == "forwarded"
    # Original sender is parsed out of the forwarded body, not the forwarder.
    assert "mary@buyer.com" in msg.sender
    assert msg.external_id == "fwd:<msg-1@buyer.com>"
    assert db.query(Commitment).count() == 1


def test_ingest_is_case_insensitive_on_email(
    db: Session, adam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    result = forward_inbox.ingest_forward(
        db,
        forwarder_email="ADAM@Adam.DEV",  # different case
        subject="Fwd: x",
        body="some body",
        original_message_id="<m2>",
    )
    assert result is not None
    assert db.query(Message).count() == 1


def test_ingest_returns_none_for_unknown_user(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    result = forward_inbox.ingest_forward(
        db,
        forwarder_email="stranger@nope.io",
        subject="Fwd: x",
        body="x",
        original_message_id="<m3>",
    )
    assert result is None
    assert db.query(Message).count() == 0


def test_ingest_dedups_on_resend(db: Session, adam: User, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[fake_commitment(description="Reply to Mary")]))
    first = forward_inbox.ingest_forward(
        db,
        forwarder_email="adam@adam.dev",
        subject="Fwd: y",
        body=FWD_BODY,
        original_message_id="<dup-msg>",
    )
    second = forward_inbox.ingest_forward(
        db,
        forwarder_email="adam@adam.dev",
        subject="Fwd: y",
        body=FWD_BODY,
        original_message_id="<dup-msg>",
    )
    assert first is not None and second is not None
    assert second.deduped is True
    assert second.message_id == first.message_id
    assert db.query(Message).count() == 1


def test_ingest_falls_back_to_content_hash_without_message_id(
    db: Session, adam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    # No Message-ID provided. Same subject+body → same dedup key.
    forward_inbox.ingest_forward(
        db,
        forwarder_email="adam@adam.dev",
        subject="hi",
        body="hello world",
        original_message_id=None,
    )
    second = forward_inbox.ingest_forward(
        db,
        forwarder_email="adam@adam.dev",
        subject="hi",
        body="hello world",
        original_message_id=None,
    )
    assert second is not None and second.deduped is True
    assert db.query(Message).count() == 1


# --- webhook endpoint: call the handler directly with mocked settings so we
# don't need a running Postgres + ASGI server. The handler is tiny — auth + a
# call into the service — so direct invocation covers the contract. ---


def _mock_settings(monkeypatch: pytest.MonkeyPatch, secret: str) -> None:
    """Stub get_settings() so the endpoint sees `secret` without env churn."""
    from app.api.v1 import inbox
    from app.core.config import Settings

    class _Stub:
        forward_inbox_secret = secret

    monkeypatch.setattr(inbox, "get_settings", lambda: _Stub())
    # Silence unused-import lint; Settings is the real type we're stubbing.
    _ = Settings


def _payload(**over: object) -> "inbox_mod.ForwardIn":  # noqa: F821
    from app.api.v1 import inbox as inbox_mod

    base = {
        "forwarder": "adam@adam.dev",
        "subject": "Fwd: x",
        "body": "hello",
        "original_message_id": "<m>",
        "received_at": None,
    }
    base.update(over)
    return inbox_mod.ForwardIn(**base)


def test_webhook_503_when_secret_unset(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException

    from app.api.v1 import inbox as inbox_mod

    _mock_settings(monkeypatch, "")
    with pytest.raises(HTTPException) as exc:
        inbox_mod.forward_inbox_webhook(_payload(), x_forward_secret="anything", db=db)
    assert exc.value.status_code == 503


def test_webhook_401_on_bad_secret(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException

    from app.api.v1 import inbox as inbox_mod

    _mock_settings(monkeypatch, "real-secret")
    with pytest.raises(HTTPException) as exc:
        inbox_mod.forward_inbox_webhook(_payload(), x_forward_secret="wrong", db=db)
    assert exc.value.status_code == 401


def test_webhook_404_for_unknown_forwarder(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException

    from app.api.v1 import inbox as inbox_mod

    _mock_settings(monkeypatch, "real-secret")
    _patch_llm(monkeypatch, FakeLLM(commitments=[]))
    with pytest.raises(HTTPException) as exc:
        inbox_mod.forward_inbox_webhook(
            _payload(forwarder="nobody@nope.io"),
            x_forward_secret="real-secret",
            db=db,
        )
    assert exc.value.status_code == 404


def test_webhook_success_path(db: Session, adam: User, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import inbox as inbox_mod

    _mock_settings(monkeypatch, "real-secret")
    _patch_llm(monkeypatch, FakeLLM(commitments=[fake_commitment(description="Sign the contract")]))
    out = inbox_mod.forward_inbox_webhook(
        _payload(body=FWD_BODY, original_message_id="<happy-path>"),
        x_forward_secret="real-secret",
        db=db,
    )
    assert out.deduped is False
    assert out.commitments_extracted == 1
    assert db.query(Message).count() == 1
