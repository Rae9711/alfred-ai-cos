"""Tests for the sender override endpoints — VIP / muted bucket management
and the lockstep reclassification of existing messages."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.api.v1 import senders as senders_api
from app.db.models import Message, User


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev", preferences={})
    db.add(u)
    db.commit()
    return u


def _msg(user_id: str, sender: str, ext: str = "m1") -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=[],
        subject="hi",
        snippet="hi",
        sent_at=datetime(2026, 6, 4, tzinfo=UTC),
    )


def test_list_overrides_empty(db: Session, user: User) -> None:
    out = senders_api.list_overrides(user=user)
    assert out.vip == []
    assert out.muted == []


def test_add_vip_writes_preferences(db: Session, user: User) -> None:
    out = senders_api.add_override(
        senders_api.SenderOverrideRequest(address="board@brand.co", bucket="vip"),
        user=user,
        db=db,
    )
    assert out.vip == ["board@brand.co"]
    assert out.muted == []
    # Persisted on the user.
    db.refresh(user)
    assert "board@brand.co" in user.preferences["sender_overrides"]["vip"]


def test_add_muted_strips_from_vip(db: Session, user: User) -> None:
    # First add as VIP, then mute → must end up only in muted.
    senders_api.add_override(
        senders_api.SenderOverrideRequest(address="x@y.co", bucket="vip"),
        user=user,
        db=db,
    )
    out = senders_api.add_override(
        senders_api.SenderOverrideRequest(address="x@y.co", bucket="muted"),
        user=user,
        db=db,
    )
    assert out.vip == []
    assert out.muted == ["x@y.co"]


def test_lowercases_address(db: Session, user: User) -> None:
    out = senders_api.add_override(
        senders_api.SenderOverrideRequest(address="BOARD@Brand.CO", bucket="vip"),
        user=user,
        db=db,
    )
    assert "board@brand.co" in out.vip


def test_remove_override(db: Session, user: User) -> None:
    senders_api.add_override(
        senders_api.SenderOverrideRequest(address="x@y.co", bucket="muted"),
        user=user,
        db=db,
    )
    out = senders_api.remove_override(address="x@y.co", user=user, db=db)
    assert out.muted == []


def test_adding_vip_reclassifies_existing_messages(db: Session, user: User) -> None:
    """Adding a sender to VIP should flip every existing Message from that
    sender to `sender_classification = 'vip'` so the dashboard updates without
    a re-ingest."""
    # Seed: a message that would normally be classified as `bulk` thanks to the
    # List-Unsubscribe header.
    msg = _msg(user.id, "board@brand.co", "m1")
    msg.headers = {"list-unsubscribe": "<https://x>"}
    db.add(msg)
    db.commit()

    senders_api.add_override(
        senders_api.SenderOverrideRequest(address="board@brand.co", bucket="vip"),
        user=user,
        db=db,
    )
    db.refresh(msg)
    assert msg.sender_classification == "vip"


def test_domain_only_override_reclassifies_all_at_domain(db: Session, user: User) -> None:
    db.add(_msg(user.id, "a@news.io", "m1"))
    db.add(_msg(user.id, "b@news.io", "m2"))
    db.commit()
    senders_api.add_override(
        senders_api.SenderOverrideRequest(address="news.io", bucket="muted"),
        user=user,
        db=db,
    )
    msgs = db.query(Message).all()
    assert all(m.sender_classification == "muted" for m in msgs)


def test_removing_override_falls_back_to_deterministic(db: Session, user: User) -> None:
    """After remove, the classifier reverts to its rules — a sender that was
    forced VIP because of an override falls back to `bulk` if its headers say so."""
    msg = _msg(user.id, "x@brand.co", "m1")
    msg.headers = {"list-unsubscribe": "<https://x>"}
    db.add(msg)
    db.commit()
    senders_api.add_override(
        senders_api.SenderOverrideRequest(address="x@brand.co", bucket="vip"),
        user=user,
        db=db,
    )
    db.refresh(msg)
    assert msg.sender_classification == "vip"
    senders_api.remove_override(address="x@brand.co", user=user, db=db)
    db.refresh(msg)
    assert msg.sender_classification == "bulk"
