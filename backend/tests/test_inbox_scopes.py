"""Inbox list scopes: needs_action, unread, synced (email), sms."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.api.v1 import messages as messages_mod
from app.db.enums import MessageClassification
from app.db.models import Message, OutboundReply, User


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="inbox-scopes@example.com")
    db.add(user)
    db.commit()
    return user


def _gmail_message(
    *,
    user_id: str,
    external_id: str,
    sent_at: datetime,
    classification: MessageClassification | None = None,
    labels: list[str] | None = None,
    action_required: bool = False,
    priority: str | None = None,
) -> Message:
    from app.db.enums import Priority

    msg = Message(
        user_id=user_id,
        source="gmail",
        external_id=external_id,
        sender="boss@corp.com",
        subject=f"Subject {external_id}",
        snippet="Please review",
        sent_at=sent_at,
        classification=classification,
        gmail_labels=labels or ["INBOX", "CATEGORY_PERSONAL"],
        sender_classification="person",
    )
    if action_required:
        msg.action_required = True
    if priority:
        msg.priority = Priority(priority)
    elif classification in (
        MessageClassification.needs_reply,
        MessageClassification.needs_decision,
    ):
        msg.priority = Priority.high
        msg.action_required = True
    return msg


def _sms_message(
    *,
    user_id: str,
    external_id: str,
    sent_at: datetime,
    classification: MessageClassification | None = MessageClassification.needs_reply,
) -> Message:
    return Message(
        user_id=user_id,
        source="sms",
        external_id=external_id,
        sender="+15551234567",
        subject="SMS",
        snippet="Text me back",
        sent_at=sent_at,
        classification=classification,
    )


def test_synced_scope_excludes_sms(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(_gmail_message(user_id=user.id, external_id="gmail:1", sent_at=now))
    db.add(_sms_message(user_id=user.id, external_id="sms:1", sent_at=now))
    db.commit()

    out = messages_mod.list_inbox(scope="synced", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].source == "gmail"


def test_unread_scope_includes_email_excludes_sms(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:unread",
            sent_at=now,
            labels=["INBOX", "UNREAD"],
        )
    )
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:read",
            sent_at=now - timedelta(minutes=1),
            labels=["INBOX"],
        )
    )
    db.add(_sms_message(user_id=user.id, external_id="sms:unread", sent_at=now))
    db.commit()

    out = messages_mod.list_inbox(scope="unread", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].source == "gmail"


def test_needs_action_includes_decision_without_action_required(
    db: Session, user: User
) -> None:
    """needs_decision in unread must also appear in 需处理 when action_required=false."""
    from app.db.enums import Priority

    now = datetime.now(UTC)
    msg = _gmail_message(
        user_id=user.id,
        external_id="gmail:decide-unread",
        sent_at=now - timedelta(hours=2),
        classification=MessageClassification.needs_decision,
        labels=["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
    )
    msg.action_required = False
    msg.priority = Priority.medium
    db.add(msg)
    db.commit()

    unread = messages_mod.list_inbox(scope="unread", user=user, db=db)
    needs = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert len(unread.messages) == 1
    assert unread.messages[0].category == "Needs Decision"
    assert len(needs.messages) == 1
    assert needs.messages[0].id == msg.id


def test_needs_action_includes_medium_priority_reply(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:medium",
            sent_at=now - timedelta(hours=1),
            classification=MessageClassification.needs_reply,
            action_required=True,
            priority="medium",
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].category == "Needs Reply"


def test_needs_action_excludes_low_confidence(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:weak",
            sent_at=now - timedelta(hours=1),
            classification=MessageClassification.follow_up_needed,
            action_required=True,
            priority="high",
        )
    )
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:strong",
            sent_at=now - timedelta(hours=2),
            classification=MessageClassification.needs_reply,
            action_required=True,
            priority="high",
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].subject == "Subject gmail:strong"


def test_needs_action_excludes_replied_and_old(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    reply_msg = _gmail_message(
        user_id=user.id,
        external_id="gmail:replied",
        sent_at=now - timedelta(days=2),
        classification=MessageClassification.needs_reply,
    )
    db.add(reply_msg)
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:open",
            sent_at=now - timedelta(days=5),
            classification=MessageClassification.needs_decision,
        )
    )
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:old",
            sent_at=now - timedelta(days=20),
            classification=MessageClassification.needs_reply,
        )
    )
    db.commit()
    db.add(
        OutboundReply(
            user_id=user.id,
            source_message_id=reply_msg.id,
            thread_id="t1",
            recipient="boss@corp.com",
            subject="Re:",
            sent_at=now,
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].category == "Needs Decision"


def test_sms_scope_excludes_spam_noise(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(_sms_message(user_id=user.id, external_id="sms:ok", sent_at=now))
    db.add(
        _sms_message(
            user_id=user.id,
            external_id="sms:spam",
            sent_at=now - timedelta(minutes=1),
            classification=MessageClassification.spam_noise,
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="sms", user=user, db=db)
    assert len(out.messages) == 1
    assert "Text me back" in (out.messages[0].snippet or "")


def test_inbox_scopes_order_newest_first(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:older",
            sent_at=now - timedelta(hours=2),
            classification=MessageClassification.needs_reply,
        )
    )
    db.add(
        _gmail_message(
            user_id=user.id,
            external_id="gmail:newer",
            sent_at=now - timedelta(hours=1),
            classification=MessageClassification.needs_reply,
        )
    )
    db.commit()

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert [m.subject for m in out.messages] == [
        "Subject gmail:newer",
        "Subject gmail:older",
    ]


def test_mark_decided_excludes_from_needs_action(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    msg = _gmail_message(
        user_id=user.id,
        external_id="gmail:decide-me",
        sent_at=now - timedelta(hours=1),
        classification=MessageClassification.needs_reply,
    )
    db.add(msg)
    db.commit()

    messages_mod.mark_decided(msg.id, user=user, db=db)

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert out.messages == []

    synced = messages_mod.list_inbox(scope="synced", user=user, db=db)
    assert len(synced.messages) == 1
    assert synced.messages[0].user_decided is True


def test_mark_undecided_restores_needs_action(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    msg = _gmail_message(
        user_id=user.id,
        external_id="gmail:undecide-me",
        sent_at=now - timedelta(hours=1),
        classification=MessageClassification.needs_reply,
    )
    db.add(msg)
    db.commit()

    messages_mod.mark_decided(msg.id, user=user, db=db)
    messages_mod.mark_undecided(msg.id, user=user, db=db)

    out = messages_mod.list_inbox(scope="needs_action", user=user, db=db)
    assert len(out.messages) == 1
    assert out.messages[0].id == msg.id
    assert out.messages[0].user_decided is False
    assert out.messages[0].category == "Needs Reply"
