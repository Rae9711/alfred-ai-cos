"""Tests for the one-shot backfill that classifies every Message whose
sender_classification is NULL — used after the column is added in production
so the spam shield protects historic commitments without a re-ingest."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.models import Message, User
from app.services import sender_class


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev")
    db.add(u)
    db.commit()
    return u


def _msg(
    user_id: str,
    *,
    ext: str,
    sender: str,
    subject: str | None = "hi",
    headers: dict | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=[],
        subject=subject,
        snippet="hi",
        headers=headers or {},
        sent_at=datetime(2026, 6, 4, tzinfo=UTC),
    )


def test_backfill_classifies_every_null_row(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", sender="Mary <mary@buyer.co>"))
    db.add(
        _msg(
            user.id,
            ext="m2",
            sender="newsletter@brand.io",
            subject="Your weekly digest from Brand",
        )
    )
    db.add(_msg(user.id, ext="m3", sender="support@vendor.io"))
    db.commit()
    n = sender_class.backfill_classifications(db)
    assert n == 3
    msgs = {m.external_id: m.sender_classification for m in db.query(Message).all()}
    assert msgs["m1"] == "person"
    assert msgs["m2"] == "automated"
    assert msgs["m3"] == "role_account"


def test_backfill_is_idempotent(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", sender="Mary <mary@buyer.co>"))
    db.commit()
    first = sender_class.backfill_classifications(db)
    second = sender_class.backfill_classifications(db)
    assert first == 1
    assert second == 0  # nothing left to do


def test_backfill_respects_user_overrides(db: Session, user: User) -> None:
    """A user with `vip` override for a sender should backfill those messages
    as `vip`, not as whatever the deterministic rule would say."""
    user.preferences = {"sender_overrides": {"vip": ["board@brand.co"]}}
    db.add(
        _msg(
            user.id,
            ext="m1",
            sender="board@brand.co",
            headers={"list-unsubscribe": "<https://x>"},
        )
    )
    db.commit()
    sender_class.backfill_classifications(db)
    msg = db.query(Message).one()
    assert msg.sender_classification == "vip"


def test_backfill_scoped_to_one_user(db: Session) -> None:
    a = User(email="a@x.io")
    b = User(email="b@x.io")
    db.add_all([a, b])
    db.commit()
    db.add(_msg(a.id, ext="a1", sender="x@y.co"))
    db.add(_msg(b.id, ext="b1", sender="x@y.co"))
    db.commit()
    n = sender_class.backfill_classifications(db, user_id=a.id)
    assert n == 1
    # b's message is still untouched.
    b_msg = db.query(Message).filter(Message.user_id == b.id).one()
    assert b_msg.sender_classification is None


def test_backfill_handles_large_batches(db: Session, user: User) -> None:
    # 25 messages, batch size 10 → must process all of them across 3 batches.
    for i in range(25):
        db.add(_msg(user.id, ext=f"m{i}", sender=f"x{i}@brand.io"))
    db.commit()
    n = sender_class.backfill_classifications(db, batch_size=10)
    assert n == 25
    remaining = db.query(Message).filter(Message.sender_classification.is_(None)).count()
    assert remaining == 0
