"""Inbox view helpers: today's window, read state, attention buckets."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification
from app.db.models import Message, OutboundReply, User
from app.services.inbox_view import (
    category_for_message,
    is_gmail_unread,
    message_needs_attention,
    start_of_today_utc,
    user_replied_message_ids,
)


def test_category_none_when_unclassified() -> None:
    assert category_for_message(None) is None


def test_is_gmail_unread() -> None:
    assert is_gmail_unread(["INBOX", "UNREAD"]) is True
    assert is_gmail_unread(["INBOX", "CATEGORY_PERSONAL"]) is False
    assert is_gmail_unread(None) is True


def test_message_needs_attention_respects_reply_state() -> None:
    assert (
        message_needs_attention(
            category="Needs Reply",
            action_required=True,
            is_unread=True,
            user_replied=False,
        )
        is True
    )
    assert (
        message_needs_attention(
            category="Needs Reply",
            action_required=True,
            is_unread=True,
            user_replied=True,
        )
        is False
    )


def test_start_of_today_utc_uses_timezone() -> None:
    start = start_of_today_utc("America/New_York")
    assert start.tzinfo is UTC


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com")
    db.add(user)
    db.commit()
    return user


def test_user_replied_message_ids(db: Session, user: User) -> None:
    msg = Message(
        user_id=user.id,
        source="gmail",
        external_id="m1",
        sender="a@b.com",
        recipients=[],
        classification=MessageClassification.needs_reply,
    )
    db.add(msg)
    db.commit()
    db.add(
        OutboundReply(
            user_id=user.id,
            source_message_id=msg.id,
            thread_id="t1",
            recipient="a@b.com",
            subject="Hi",
            sent_at=datetime.now(UTC),
        )
    )
    db.commit()
    assert user_replied_message_ids(db, user.id) == {msg.id}
