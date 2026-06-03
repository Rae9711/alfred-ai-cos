"""Tests for the upgraded priority ranker — VIP, stranger, dismissal, thread depth,
keyword signals. The baseline scorer is covered by test_priority.py; this file
exercises the ScoringContext path that build_today now wires up."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import (
    CommitmentOwner,
    CommitmentStatus,
    SourceType,
)
from app.db.models import Commitment, Message, User
from app.services import priority as p

TODAY = date(2026, 6, 2)
NOW = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev")
    db.add(u)
    db.commit()
    return u


def _message(
    user_id: str,
    *,
    sender: str,
    recipients: list[str] | None = None,
    thread_id: str | None = None,
    sent_at: datetime | None = None,
    external_id: str | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=external_id or f"m-{sender}-{sent_at}",
        thread_id=thread_id,
        sender=sender,
        recipients=recipients or ["me@adam.dev"],
        sent_at=sent_at or (NOW - timedelta(days=1)),
    )


def _commitment(
    user_id: str,
    *,
    source_id: str | None = None,
    description: str = "Reply to the proposal",
    counterparty: str = "Mary",
    confidence: float = 0.9,
    status: CommitmentStatus = CommitmentStatus.open,
    owner: CommitmentOwner = CommitmentOwner.user,
    due_date: date | None = None,
    evidence: str | None = None,
    from_automated: bool = False,
) -> Commitment:
    return Commitment(
        user_id=user_id,
        description=description,
        evidence=evidence,
        owner=owner,
        counterparty=counterparty,
        due_date=due_date,
        status=status,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=confidence,
        from_automated=from_automated,
    )


# --- VIP boost: senders the user replies to often rank higher ---


def test_vip_sender_scores_higher_than_stranger(db: Session, user: User) -> None:
    # Three outbound replies to the VIP, plus one inbound, builds a real history.
    for i in range(3):
        db.add(
            _message(
                user.id,
                sender="me@adam.dev",
                recipients=["vip@board.co"],
                external_id=f"out-{i}",
            )
        )
    inbound_vip = _message(user.id, sender="vip@board.co", external_id="m-vip")
    inbound_stranger = _message(user.id, sender="random@unknown.io", external_id="m-stranger")
    db.add_all([inbound_vip, inbound_stranger])
    db.commit()

    db.add(_commitment(user.id, source_id=inbound_vip.id, counterparty="VIP"))
    db.add(_commitment(user.id, source_id=inbound_stranger.id, counterparty="Stranger"))
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    vip_c, stranger_c = db.query(Commitment).all()
    vip_score = p.score_commitment(vip_c, today=TODAY, context=ctx)
    stranger_score = p.score_commitment(stranger_c, today=TODAY, context=ctx)

    assert vip_score.score > stranger_score.score
    assert "regularly reply" in vip_score.reason or "talking with" in vip_score.reason


# --- Stranger penalty: a first-time sender is dampened ---


def test_first_time_sender_is_penalized(db: Session, user: User) -> None:
    msg = _message(user.id, sender="cold@outreach.io")
    db.add(msg)
    db.commit()
    db.add(_commitment(user.id, source_id=msg.id))
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    scored = p.score_commitment(db.query(Commitment).one(), today=TODAY, context=ctx)
    assert "first-time sender" in scored.reason


# --- Engagement velocity: many inbound + zero replies = ignored sender ---


def test_ignored_sender_is_dampened(db: Session, user: User) -> None:
    # Six inbound from the same sender, no replies from user → user clearly ignores them.
    for i in range(6):
        db.add(
            _message(
                user.id,
                sender="news@spam.io",
                external_id=f"spam-{i}",
                sent_at=NOW - timedelta(days=i + 1),
            )
        )
    db.commit()
    latest = db.query(Message).order_by(Message.sent_at.desc()).first()
    assert latest is not None
    db.add(_commitment(user.id, source_id=latest.id))
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    scored = p.score_commitment(db.query(Commitment).one(), today=TODAY, context=ctx)
    assert "don't reply" in scored.reason


# --- Dismissal history: prior dismissals from the same sender push future items down ---


def test_repeat_dismissals_lower_score(db: Session, user: User) -> None:
    # Sender with two previously dismissed commitments + one new open one.
    sender = "noisy@vendor.com"
    old1 = _message(user.id, sender=sender, external_id="old1", sent_at=NOW - timedelta(days=20))
    old2 = _message(user.id, sender=sender, external_id="old2", sent_at=NOW - timedelta(days=15))
    new = _message(user.id, sender=sender, external_id="new", sent_at=NOW - timedelta(days=1))
    db.add_all([old1, old2, new])
    db.commit()
    db.add(
        _commitment(user.id, source_id=old1.id, status=CommitmentStatus.dismissed, counterparty="V")
    )
    db.add(
        _commitment(user.id, source_id=old2.id, status=CommitmentStatus.dismissed, counterparty="V")
    )
    db.add(_commitment(user.id, source_id=new.id, counterparty="V"))
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    open_c = db.query(Commitment).filter(Commitment.status == CommitmentStatus.open).one()
    scored = p.score_commitment(open_c, today=TODAY, context=ctx)
    assert "dismissed" in scored.reason


# --- Thread depth: 4+ messages on a thread in a week pushes the item up ---


def test_active_thread_lifts_score(db: Session, user: User) -> None:
    thread = "t-active-deal"
    sender = "buyer@acquirer.com"
    for i in range(5):
        db.add(
            _message(
                user.id,
                sender=sender,
                external_id=f"th-{i}",
                thread_id=thread,
                sent_at=NOW - timedelta(days=i),
            )
        )
    db.commit()
    latest = (
        db.query(Message)
        .filter(Message.thread_id == thread)
        .order_by(Message.sent_at.desc())
        .first()
    )
    assert latest is not None
    db.add(_commitment(user.id, source_id=latest.id))
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    scored = p.score_commitment(db.query(Commitment).one(), today=TODAY, context=ctx)
    assert "5 messages in this thread this week" in scored.reason


# --- Keyword signals: money/legal language and direct asks both add weight ---


def test_high_stakes_keywords_boost(db: Session, user: User) -> None:
    plain = p.score_commitment(
        _commitment("u", description="Reply to Joe about lunch"), today=TODAY
    )
    money = p.score_commitment(
        _commitment("u", description="Sign the contract and wire the invoice"), today=TODAY
    )
    assert money.score > plain.score
    assert "money/legal/contract" in money.reason


def test_direct_ask_phrasing_boosts(db: Session, user: User) -> None:
    fyi = p.score_commitment(_commitment("u", description="FYI on the launch"), today=TODAY)
    ask = p.score_commitment(
        _commitment("u", description="Can you review the spec and approve?"), today=TODAY
    )
    assert ask.score > fyi.score


# --- Composition: a VIP + money + active thread should obviously outrank a stranger FYI ---


def test_composite_ranking_puts_real_signal_at_top(db: Session, user: User) -> None:
    # VIP scenario: 3 prior outbound replies, an active 5-message thread, money keyword.
    vip_email = "ceo@buyer.com"
    db.add(_message(user.id, sender="me@adam.dev", recipients=[vip_email], external_id="o1"))
    db.add(_message(user.id, sender="me@adam.dev", recipients=[vip_email], external_id="o2"))
    db.add(_message(user.id, sender="me@adam.dev", recipients=[vip_email], external_id="o3"))
    for i in range(5):
        db.add(
            _message(
                user.id,
                sender=vip_email,
                thread_id="deal",
                external_id=f"vip-{i}",
                sent_at=NOW - timedelta(days=i),
            )
        )
    db.commit()
    vip_msg = (
        db.query(Message)
        .filter(Message.thread_id == "deal")
        .order_by(Message.sent_at.desc())
        .first()
    )
    assert vip_msg is not None

    # Noise scenario: first-time stranger, FYI text.
    noise_msg = _message(user.id, sender="cold@outreach.io", external_id="cold-1")
    db.add(noise_msg)
    db.commit()

    db.add(
        _commitment(
            user.id,
            source_id=vip_msg.id,
            description="Sign the contract and wire payment",
            counterparty="CEO",
        )
    )
    db.add(
        _commitment(
            user.id,
            source_id=noise_msg.id,
            description="FYI on a webinar",
            counterparty="Cold",
        )
    )
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    commits = db.query(Commitment).all()
    scores = {c.description: p.score_commitment(c, today=TODAY, context=ctx).score for c in commits}
    assert scores["Sign the contract and wire payment"] > scores["FYI on a webinar"] + 30
