"""WhatsApp inbound: signature verification, subscription handshake, and ingest."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from typing import Any

import pytest
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.db.models import Message, User
from app.services import extraction, whatsapp_inbox
from tests.fakes import FakeLLM, fake_commitment

APP_SECRET = "app-secret"
VERIFY_TOKEN = "verify-token"


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="wa-in@example.com", name="Me")
    db.add(u)
    db.commit()
    return u


def _sign(raw: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()


def _payload(body: str = "Can you send the report by Friday?") -> dict[str, Any]:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {"phone_number_id": "PN1"},
                            "contacts": [{"wa_id": "15551234567", "profile": {"name": "Bob"}}],
                            "messages": [
                                {
                                    "from": "15551234567",
                                    "id": "wamid.1",
                                    "timestamp": "1700000000",
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ],
                        },
                    }
                ]
            }
        ]
    }


def _mock_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import inbox as inbox_mod

    class _Stub:
        whatsapp_app_secret = APP_SECRET
        whatsapp_verify_token = VERIFY_TOKEN

    monkeypatch.setattr(inbox_mod, "get_settings", lambda: _Stub())


def _post(raw: bytes, signature: str | None, db: Session) -> Any:
    from app.api.v1 import inbox as inbox_mod

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": raw, "more_body": False}

    request = Request({"type": "http", "headers": []}, receive)
    return asyncio.run(
        inbox_mod.whatsapp_inbox_webhook(request, x_hub_signature_256=signature, db=db)
    )


# --- unit: signature + challenge ---


def test_verify_signature_valid_and_invalid() -> None:
    raw = b'{"a":1}'
    good = _sign(raw)
    assert whatsapp_inbox.verify_signature(
        app_secret=APP_SECRET, raw_body=raw, signature_header=good
    )
    assert not whatsapp_inbox.verify_signature(
        app_secret=APP_SECRET, raw_body=raw, signature_header="sha256=deadbeef"
    )
    assert not whatsapp_inbox.verify_signature(
        app_secret=APP_SECRET, raw_body=raw, signature_header=None
    )


def test_verify_challenge_matches_token() -> None:
    assert (
        whatsapp_inbox.verify_challenge(
            verify_token=VERIFY_TOKEN, mode="subscribe", token=VERIFY_TOKEN, challenge="123"
        )
        == "123"
    )
    assert (
        whatsapp_inbox.verify_challenge(
            verify_token=VERIFY_TOKEN, mode="subscribe", token="wrong", challenge="123"
        )
        is None
    )


# --- endpoint: signature enforcement + ingest ---


def test_webhook_rejects_bad_signature(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    _mock_settings(monkeypatch)
    raw = json.dumps(_payload()).encode()
    with pytest.raises(HTTPException) as exc:
        _post(raw, "sha256=nope", db)
    assert exc.value.status_code == 401


def test_webhook_ingests_on_valid_signature(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_settings(monkeypatch)
    monkeypatch.setattr(
        extraction, "get_llm", lambda: FakeLLM(commitments=[fake_commitment(description="Report")])
    )
    raw = json.dumps(_payload()).encode()
    out = _post(raw, _sign(raw), db)
    assert out.ingested == 1

    msg = db.get(Message, out.message_ids[0])
    assert msg is not None
    assert msg.source == "whatsapp"
    assert msg.thread_id == "15551234567"
    assert "Bob" in msg.sender


def test_webhook_dedups_repeat_delivery(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_settings(monkeypatch)
    monkeypatch.setattr(extraction, "get_llm", lambda: FakeLLM(commitments=[]))
    raw = json.dumps(_payload()).encode()
    _post(raw, _sign(raw), db)
    _post(raw, _sign(raw), db)
    assert db.query(Message).filter(Message.source == "whatsapp").count() == 1


def test_find_user_routes_by_preference(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    owner = User(email="owner@example.com", preferences={"whatsapp_phone_number_id": "PN9"})
    other = User(email="other@example.com")
    db.add_all([owner, other])
    db.commit()
    assert whatsapp_inbox.find_whatsapp_user(db, "PN9") is owner
    # No preference match and >1 user → unresolved rather than a wrong guess.
    assert whatsapp_inbox.find_whatsapp_user(db, "PNX") is None
