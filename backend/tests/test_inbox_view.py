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
    message_qualifies_for_needs_action_tab,
    start_of_today_utc,
    user_replied_message_ids,
)


def test_category_none_when_unclassified() -> None:
    from app.db.models import Message
    from app.services.inbox_view import effective_inbox_category

    assert category_for_message(None) is None
    m = Message(
        user_id="u",
        source="gmail",
        external_id="p",
        sender="a@b.com",
        recipients=[],
    )
    assert effective_inbox_category(m) == "Processing"


def test_effective_inbox_category_action_required_before_classified() -> None:
    from app.db.models import Message
    from app.services.inbox_view import effective_inbox_category

    m = Message(
        user_id="u",
        source="gmail",
        external_id="p2",
        sender="a@b.com",
        recipients=[],
        action_required=True,
    )
    assert effective_inbox_category(m) == "Needs Reply"


def test_effective_inbox_category_past_due_subject_before_classified() -> None:
    from app.db.models import Message
    from app.services.inbox_view import effective_inbox_category

    m = Message(
        user_id="u",
        source="gmail",
        external_id="p3",
        sender="billing@chase.com",
        recipients=[],
        subject="Action needed, your balance is now past due",
        snippet="Please pay now",
        sender_classification="automated",
    )
    assert effective_inbox_category(m) == "Needs Reply"


def test_mark_message_user_decided_accepts_string_classification_from_db() -> None:
    from app.db.models import Message
    from app.services.inbox_view import mark_message_user_decided

    m = Message(
        user_id="u",
        source="gmail",
        external_id="p4b",
        sender="a@b.com",
        recipients=[],
        classification="needs_reply",
        action_required=True,
    )
    mark_message_user_decided(m)
    assert m.headers is not None
    assert m.headers["pre_decide_classification"] == "needs_reply"


def test_message_user_decided_excluded_from_needs_action() -> None:
    from app.db.models import Message
    from app.services.inbox_view import (
        clear_message_user_decided,
        effective_inbox_category,
        mark_message_user_decided,
        message_needs_attention,
        message_user_decided,
    )

    m = Message(
        user_id="u",
        source="gmail",
        external_id="p4",
        sender="a@b.com",
        recipients=[],
        classification=MessageClassification.needs_reply,
        action_required=True,
    )
    mark_message_user_decided(m)
    category = effective_inbox_category(m)
    assert category == "FYI"
    assert (
        message_needs_attention(
            category=category,
            user_replied=False,
            user_decided=True,
        )
        is False
    )

    clear_message_user_decided(m)
    assert message_user_decided(m) is False
    assert m.classification == MessageClassification.needs_reply
    assert m.action_required is True
    assert effective_inbox_category(m) == "Needs Reply"


def test_is_gmail_unread() -> None:
    assert is_gmail_unread(["INBOX", "UNREAD"]) is True
    assert is_gmail_unread(["INBOX", "CATEGORY_PERSONAL"]) is False
    assert is_gmail_unread(None) is True
    assert is_gmail_unread([]) is False


def test_message_needs_attention_respects_reply_state() -> None:
    assert (
        message_needs_attention(
            category="Needs Reply",
            user_replied=False,
        )
        is True
    )
    assert (
        message_needs_attention(
            category="Needs Reply",
            user_replied=True,
        )
        is False
    )
    assert (
        message_needs_attention(
            category="Needs Decision",
            user_replied=False,
        )
        is True
    )
    assert (
        message_needs_attention(
            category="Waiting",
            user_replied=False,
        )
        is False
    )
    assert (
        message_needs_attention(
            category="Processing",
            user_replied=False,
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


def test_effective_inbox_category_upgrades_human_fyi(db: Session, user: User) -> None:
    from app.db.enums import MessageClassification
    from app.db.models import Message
    from app.services.inbox_view import effective_inbox_category

    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="x1",
        sender="friend@example.com",
        recipients=[],
        subject="Please review",
        snippet="Can you confirm by tonight?",
        classification=MessageClassification.informational,
        sender_classification="person",
        action_required=False,
    )
    assert effective_inbox_category(m) == "Needs Reply"


def test_message_qualifies_for_needs_action_tab_requires_high_bar() -> None:
    from app.db.enums import Priority
    from app.db.models import Message
    from app.services.inbox_view import (
        effective_inbox_category,
        message_needs_attention,
        message_qualifies_for_needs_action_tab,
    )

    base = dict(
        user_id="u",
        source="gmail",
        external_id="hq",
        sender="boss@corp.com",
        recipients=[],
        classification=MessageClassification.needs_reply,
        action_required=True,
        priority=Priority.high,
        sender_classification="person",
    )
    m = Message(**base)
    category = effective_inbox_category(m)
    assert message_needs_attention(category=category, user_replied=False) is True
    assert (
        message_qualifies_for_needs_action_tab(
            m, category=category, user_replied=False
        )
        is True
    )

    medium_priority = Message(**{**base, "priority": Priority.medium})
    cat = effective_inbox_category(medium_priority)
    assert (
        message_qualifies_for_needs_action_tab(
            medium_priority, category=cat, user_replied=False
        )
        is True
    )

    low_priority_no_action = Message(
        **{**base, "priority": Priority.low, "action_required": False}
    )
    cat_low = effective_inbox_category(low_priority_no_action)
    assert (
        message_qualifies_for_needs_action_tab(
            low_priority_no_action, category=cat_low, user_replied=False
        )
        is False
    )

    follow_up = Message(
        **{
            **base,
            "classification": MessageClassification.follow_up_needed,
            "priority": Priority.high,
        }
    )
    cat_fu = effective_inbox_category(follow_up)
    assert (
        message_qualifies_for_needs_action_tab(
            follow_up, category=cat_fu, user_replied=False
        )
        is False
    )

    automated = Message(
        **{
            **base,
            "sender_classification": "automated",
        }
    )
    cat_auto = effective_inbox_category(automated)
    assert (
        message_qualifies_for_needs_action_tab(
            automated, category=cat_auto, user_replied=False
        )
        is False
    )


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
