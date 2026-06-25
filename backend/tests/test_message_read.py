"""Tests for Gmail read/unread sync."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db.enums import Provider
from app.db.models import ConnectedAccount, Message, User
from app.services import gmail
from app.services.crypto import encrypt_token
from app.services.message_read import mark_message_read


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="read@example.com")
    db.add(user)
    db.commit()
    return user


def _message(db: Session, user: User) -> Message:
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        scopes=["gmail.modify"],
        token_ciphertext=encrypt_token({"token": "x"}),
    )
    db.add(account)
    db.flush()
    message = Message(
        user_id=user.id,
        connected_account_id=account.id,
        external_id="gmail-1",
        thread_id="t1",
        sender="friend@example.com",
        subject="Hi",
        snippet="hello",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL", "UNREAD"],
    )
    db.add(message)
    db.commit()
    return message


def test_mark_message_read_updates_gmail_and_db(
    db: Session, user: User, monkeypatch
) -> None:
    message = _message(db, user)
    monkeypatch.setattr(
        gmail,
        "modify_message_labels",
        lambda _token, _mid, *, add=None, remove=None: (
            ["INBOX", "CATEGORY_PERSONAL"] if remove == ["UNREAD"] else []
        ),
    )
    message, gmail_synced = mark_message_read(db, user, message)
    assert gmail_synced is True
    assert message.gmail_labels == ["INBOX", "CATEGORY_PERSONAL"]


def test_mark_message_read_without_modify_scope_updates_local_only(
    db: Session, user: User, monkeypatch
) -> None:
    message = _message(db, user)
    account = db.get(
        ConnectedAccount,
        message.connected_account_id,
    )
    assert account is not None
    account.scopes = ["https://www.googleapis.com/auth/gmail.readonly"]
    db.commit()
    calls: list[str] = []

    def boom(*_a, **_k):
        calls.append("nope")
        return []

    monkeypatch.setattr(gmail, "modify_message_labels", boom)
    message, gmail_synced = mark_message_read(db, user, message)
    assert gmail_synced is False
    assert calls == []
    assert message.gmail_labels == ["INBOX", "CATEGORY_PERSONAL"]


def test_mark_message_read_is_idempotent(db: Session, user: User, monkeypatch) -> None:
    message = _message(db, user)
    message.gmail_labels = ["INBOX", "CATEGORY_PERSONAL"]
    db.commit()
    calls: list[str] = []
    monkeypatch.setattr(
        gmail,
        "modify_message_labels",
        lambda _token, mid, *, add=None, remove=None: calls.append(mid) or [],
    )
    mark_message_read(db, user, message)
    assert calls == []
