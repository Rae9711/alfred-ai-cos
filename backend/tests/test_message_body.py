"""Tests for on-demand Gmail body fetch for reply drafting."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import ConnectedAccount, Message, User
from app.services import gmail
from app.services.crypto import encrypt_token
from app.services.message_body import build_draft_context, fetch_message_body


def _message_with_account(db: Session) -> Message:
    user = User(email="user@example.com")
    db.add(user)
    db.flush()
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        scopes=["gmail.readonly"],
        token_ciphertext=encrypt_token({"token": "x"}),
    )
    db.add(account)
    db.flush()
    message = Message(
        user_id=user.id,
        connected_account_id=account.id,
        external_id="gmail-msg-1",
        thread_id="t1",
        sender="Tianyi <tianyi@example.com>",
        subject="Next steps",
        snippet="short preview",
    )
    db.add(message)
    db.commit()
    return message


def test_fetch_message_body_from_gmail(db: Session, monkeypatch) -> None:
    message = _message_with_account(db)
    monkeypatch.setattr(
        gmail,
        "get_message",
        lambda _token, _ext_id: {
            "body": "Step 1: do A\nStep 2: do B\nStep 3: confirm",
            "snippet": "short preview",
        },
    )
    body = fetch_message_body(db, message)
    assert "Step 2" in body
    assert "Step 3" in body


def test_fetch_message_body_falls_back_to_snippet(db: Session, monkeypatch) -> None:
    message = _message_with_account(db)
    monkeypatch.setattr(
        gmail,
        "get_message",
        lambda _token, _ext_id: {"body": "", "snippet": "fallback snippet"},
    )
    body = fetch_message_body(db, message)
    assert body == "fallback snippet"


def test_build_draft_context_includes_subject_and_body() -> None:
    message = Message(
        user_id="u1",
        external_id="x",
        thread_id="t",
        sender="a@b.com",
        subject="Hello",
        snippet="hi",
    )
    ctx = build_draft_context(message=message, body="Full body here")
    assert "Subject: Hello" in ctx
    assert "From: a@b.com" in ctx
    assert "Full body here" in ctx
