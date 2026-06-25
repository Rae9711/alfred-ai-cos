"""Inbox list shows Primary-tab mail only (no Promotions / marketing)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.enums import MessageClassification
from app.db.models import Message, User
from app.services.inbox_filter import message_in_primary_inbox


@pytest.fixture
def user(db: Session) -> User:
    user = User(email="me@example.com")
    db.add(user)
    db.commit()
    return user


def test_primary_tab_message_visible(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="p1",
        sender="friend@example.com",
        recipients=[],
        subject="Hi",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
        classification=MessageClassification.informational,
        sender_classification="person",
    )
    assert message_in_primary_inbox(m) is True


def test_updates_tab_visible(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="upd1",
        sender="registrar@umich.edu",
        recipients=[],
        subject="Enrollment notice",
        gmail_labels=["INBOX", "CATEGORY_UPDATES"],
        classification=MessageClassification.informational,
        sender_classification="person",
    )
    assert message_in_primary_inbox(m) is True


def test_updates_bulk_sender_visible(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="upd2",
        sender="MIDAS <midas-research@umich.edu>",
        recipients=[],
        subject="MIDAS digest",
        gmail_labels=["INBOX", "CATEGORY_UPDATES"],
        classification=MessageClassification.low_priority,
        sender_classification="bulk",
        headers={"List-Unsubscribe": "<mailto:unsub@umich.edu>"},
    )
    assert message_in_primary_inbox(m) is True


def test_promotions_tab_hidden(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="promo1",
        sender="shop@example.com",
        recipients=[],
        subject="Sale!",
        gmail_labels=["INBOX", "CATEGORY_PROMOTIONS"],
        classification=MessageClassification.low_priority,
        sender_classification="person",
    )
    assert message_in_primary_inbox(m) is False


def test_primary_tab_bulk_sender_hidden(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="promo2",
        sender="beauty@brand.com",
        recipients=[],
        subject="A Touch of Sweetness",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
        classification=MessageClassification.informational,
        sender_classification="bulk",
    )
    assert message_in_primary_inbox(m) is False


def test_primary_tab_list_unsubscribe_hidden(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="promo3",
        sender="beauty@brand.com",
        recipients=[],
        subject="Sale",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
        classification=MessageClassification.informational,
        sender_classification="person",
        headers={"List-Unsubscribe": "<mailto:unsub@brand.com>"},
    )
    assert message_in_primary_inbox(m) is False


def test_low_priority_visible_on_primary(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="lp1",
        sender="shop@example.com",
        recipients=[],
        subject="Weekly deals",
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
        classification=MessageClassification.low_priority,
        sender_classification="person",
    )
    assert message_in_primary_inbox(m) is True


def test_uncategorized_inbox_unread_visible(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="new1",
        sender="friend@example.com",
        recipients=[],
        subject="Quick question",
        gmail_labels=["INBOX", "UNREAD"],
        classification=MessageClassification.needs_reply,
        sender_classification="person",
    )
    assert message_in_primary_inbox(m) is True


def test_legacy_person_without_labels_visible(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="legacy1",
        sender="a@b.com",
        recipients=[],
        subject="Hello",
        gmail_labels=None,
        sender_classification="person",
        classification=MessageClassification.needs_reply,
        sent_at=datetime.now(UTC),
    )
    assert message_in_primary_inbox(m) is True


def test_legacy_bulk_hidden_without_labels(db: Session, user: User) -> None:
    m = Message(
        user_id=user.id,
        source="gmail",
        external_id="b1",
        sender="noreply@store.com",
        recipients=[],
        subject="Newsletter",
        gmail_labels=None,
        sender_classification="bulk",
    )
    assert message_in_primary_inbox(m) is False
