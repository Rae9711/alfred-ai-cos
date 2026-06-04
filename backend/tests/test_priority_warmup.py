"""Tests for cold-contact warm-up: not every first-time sender is a stranger.

Two warm-up exceptions soften the first-time-sender penalty:
  1. Same-domain warm-up: the user has replied to a colleague at the same
     domain → reduced penalty.
  2. Repeat-cold warm-up: the same sender wrote 2+ times without reply →
     no penalty (it's an active conversation we haven't engaged yet)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, Message, User
from app.services import priority as p

TODAY = date(2026, 6, 5)
NOW = datetime(2026, 6, 5, 12, 0, tzinfo=UTC)


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
    recipients: list[str] | None = None,
    sent_at: datetime | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=recipients or ["me@adam.dev"],
        subject="hi",
        snippet="hi",
        sent_at=sent_at or NOW - timedelta(days=1),
        sender_classification="person",
    )


def _commit(user_id: str, source_id: str) -> Commitment:
    return Commitment(
        user_id=user_id,
        description="Reply to the proposal",
        evidence="ok",
        owner=CommitmentOwner.user,
        counterparty="x",
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=0.9,
    )


def test_pure_cold_keeps_full_first_time_penalty(db: Session, user: User) -> None:
    """No history at all: first-time penalty fires at full -10."""
    msg = _msg(user.id, ext="m1", sender="cold@unknown.io")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id)
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert "first-time sender" in out.reason


def test_same_domain_warm_up_reduces_penalty(db: Session, user: User) -> None:
    """User has emailed mary@buyer.co before. A new john@buyer.co isn't a
    stranger — it's an extended contact at the same company."""
    # Outbound to mary builds the domain trust.
    db.add(
        _msg(
            user.id,
            ext="out1",
            sender="me@adam.dev",
            recipients=["mary@buyer.co"],
        )
    )
    # New inbound from john at the same domain.
    msg = _msg(user.id, ext="m1", sender="john@buyer.co")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id)
    db.add(c)
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # Reduced penalty + the warm-up reason should show.
    assert "new contact at buyer.co" in out.reason
    assert "first-time sender" not in out.reason


def test_repeat_cold_drops_penalty(db: Session, user: User) -> None:
    """Same unknown sender wrote 3 times, user never replied. That's an
    active conversation we haven't engaged — no first-time penalty."""
    for i in range(3):
        db.add(
            _msg(
                user.id,
                ext=f"m{i}",
                sender="persistent@unknown.io",
                sent_at=NOW - timedelta(days=i + 1),
            )
        )
    db.commit()
    latest = (
        db.query(Message)
        .filter(Message.sender == "persistent@unknown.io")
        .order_by(Message.sent_at.desc())
        .first()
    )
    assert latest is not None
    c = _commit(user.id, source_id=latest.id)
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert "first-time sender" not in out.reason
    assert "new contact" not in out.reason


def test_same_domain_warm_up_does_not_apply_to_replied_sender(db: Session, user: User) -> None:
    """If the user has already replied to the EXACT sender, the same-domain
    warm-up doesn't kick in — VIP boost applies instead."""
    db.add(
        _msg(
            user.id,
            ext="out1",
            sender="me@adam.dev",
            recipients=["mary@buyer.co"],
        )
    )
    msg = _msg(user.id, ext="m1", sender="mary@buyer.co")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id)
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # Not a stranger — VIP-style reason should appear (talking with mary).
    assert "talking with" in out.reason or "regularly reply" in out.reason
    # And no first-time penalty.
    assert "first-time sender" not in out.reason


def test_warm_up_score_difference(db: Session, user: User) -> None:
    """Quantitative check: a same-domain warm-up should score higher than a
    pure cold sender (because the penalty was halved from -10 to -5)."""
    # Cold scenario — commit the message before referencing its id (UUID
    # default fires at flush, not at object construction).
    cold = _msg(user.id, ext="cold", sender="x@unknown1.io")
    db.add(cold)
    db.commit()
    cold_c = _commit(user.id, source_id=cold.id)
    db.add(cold_c)

    # Warm-up scenario: outbound to known colleague + new contact at same dom.
    db.add(
        _msg(
            user.id,
            ext="out",
            sender="me@adam.dev",
            recipients=["known@partner.io"],
        )
    )
    warm = _msg(user.id, ext="warm", sender="new@partner.io")
    db.add(warm)
    db.commit()
    warm_c = _commit(user.id, source_id=warm.id)
    db.add(warm_c)
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    cold_score = p.score_commitment(cold_c, today=TODAY, context=ctx).score
    warm_score = p.score_commitment(warm_c, today=TODAY, context=ctx).score
    assert warm_score > cold_score
