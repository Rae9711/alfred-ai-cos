"""Tests for the importance-learning module: event recording, decay, bounds,
and integration with the priority ranker."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, Message, User
from app.services import learning
from app.services import priority as p

TODAY = date(2026, 6, 4)
NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="learn@example.com")
    db.add(u)
    db.commit()
    return u


def _msg(user_id: str, sender: str, *, ext: str = "m1") -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=["learn@example.com"],
        sent_at=NOW - timedelta(days=1),
    )


def _commit(
    user_id: str,
    *,
    source_id: str | None = None,
    desc: str = "Approve the contract",
    counterparty: str = "Buyer",
) -> Commitment:
    return Commitment(
        user_id=user_id,
        description=desc,
        evidence=desc,
        owner=CommitmentOwner.user,
        counterparty=counterparty,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=0.9,
    )


# --- recording events shifts the snapshot in the right direction ---


def test_act_event_lifts_sender_and_categories(db: Session, user: User) -> None:
    msg = _msg(user.id, "buyer@deal.co", ext="m-a")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Sign the contract")
    db.add(c)
    db.commit()

    learning.record_event(db, user, event="act", commitment=c)
    view = learning.get_learning(user)
    assert view.by_sender["buyer@deal.co"] > 0
    # 'contract' is in the money category
    assert view.by_category.get("money", 0) > 0


def test_dismiss_pulls_negative(db: Session, user: User) -> None:
    msg = _msg(user.id, "spam@news.co", ext="m-b")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Webinar invitation")
    db.add(c)
    db.commit()
    learning.record_event(db, user, event="dismiss", commitment=c)
    view = learning.get_learning(user)
    assert view.by_sender["spam@news.co"] < 0


def test_snooze_is_neutral(db: Session, user: User) -> None:
    msg = _msg(user.id, "later@thing.co", ext="m-c")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id)
    db.add(c)
    db.commit()
    learning.record_event(db, user, event="snooze", commitment=c)
    view = learning.get_learning(user)
    # Snooze is intentional: park, not vote — values unchanged.
    assert view.by_sender == {}
    assert view.by_category == {}


def test_repeated_acts_saturate_at_bound(db: Session, user: User) -> None:
    msg = _msg(user.id, "vip@board.co", ext="m-d")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Sign the contract")
    db.add(c)
    db.commit()
    for _ in range(50):
        learning.record_event(db, user, event="act", commitment=c)
    view = learning.get_learning(user)
    # ±15 hard cap (with decay subtracted each tick); the magnitude can't blow up.
    assert view.by_sender["vip@board.co"] <= 15.0
    assert view.by_sender["vip@board.co"] >= 10.0  # high but bounded


# --- adjustment_for combines sender + categories with a hard cap ---


def test_adjustment_combines_sender_and_categories() -> None:
    view = learning.LearningView(
        by_sender={"vip@board.co": 5.0},
        by_category={"money": 3.0, "ask": 2.0},
    )
    # 5 + 3 + 2 = 10 (well under the cap)
    assert learning.adjustment_for(view, sender="vip@board.co", categories=["money", "ask"]) == 10.0


def test_adjustment_caps_at_twenty() -> None:
    view = learning.LearningView(
        by_sender={"x@y.z": 15.0}, by_category={"money": 15.0, "ask": 15.0}
    )
    # 15 + 15 + 15 = 45 → clamped to 20.
    assert learning.adjustment_for(view, sender="x@y.z", categories=["money", "ask"]) == 20.0


def test_adjustment_lowercases_sender() -> None:
    view = learning.LearningView(by_sender={"vip@board.co": 5.0}, by_category={})
    # Caller may pass mixed case; lookup is case-insensitive.
    assert learning.adjustment_for(view, sender="VIP@Board.co", categories=[]) == 5.0


# --- learning flows into the priority ranker ---


def test_learning_shifts_ranker_score(db: Session, user: User) -> None:
    msg = _msg(user.id, "vip@board.co", ext="m-rank")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Sign the contract")
    db.add(c)
    db.commit()

    # Baseline: no learning yet.
    ctx_pre = p.build_context(db, user, now=NOW)
    pre = p.score_commitment(c, today=TODAY, context=ctx_pre)

    # Record three acts on the same sender + category.
    for _ in range(3):
        learning.record_event(db, user, event="act", commitment=c)

    # New score lifts and the reason mentions learning.
    ctx_post = p.build_context(db, user, now=NOW)
    post = p.score_commitment(c, today=TODAY, context=ctx_post)
    assert post.score > pre.score
    assert "learned" in post.reason


# --- the update_status route hook records learning automatically ---


def test_status_change_records_learning(db: Session, user: User) -> None:
    from app.api.v1.commitments import update_status

    msg = _msg(user.id, "ceo@buyer.co", ext="m-status")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Sign the contract")
    db.add(c)
    db.commit()
    update_status(commitment_id=c.id, status=CommitmentStatus.done, user=user, db=db)
    view = learning.get_learning(user)
    assert view.by_sender["ceo@buyer.co"] > 0


# --- snooze route records a (neutral) learning event ---


def test_snooze_route_records_event(db: Session, user: User, monkeypatch) -> None:
    from app.api.v1 import commitments as commitments_api
    from app.schemas.api import SnoozeRequest

    msg = _msg(user.id, "later@buyer.co", ext="m-snooze")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id)
    db.add(c)
    db.commit()

    calls: list[str] = []
    real = learning.record_event

    def _spy(*args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(kwargs.get("event", ""))
        return real(*args, **kwargs)

    monkeypatch.setattr(commitments_api.learning, "record_event", _spy)
    commitments_api.snooze_commitment(
        commitment_id=c.id,
        payload=SnoozeRequest(phrase="tomorrow"),
        user=user,
        db=db,
    )
    assert "snooze" in calls


# --- correction signal lowers score more than a plain dismiss ---


def test_correct_event_pulls_negative(db: Session, user: User) -> None:
    msg = _msg(user.id, "invite@vendor.co", ext="m-correct")
    db.add(msg)
    db.commit()
    # Meet the min-sample threshold so the learned delta actually applies.
    for _ in range(_min_events()):
        learning.record_event(db, user, event="correct", message=msg)
    view = learning.get_learning(user)
    assert view.by_sender["invite@vendor.co"] < 0


def _min_events() -> int:
    return learning._MIN_SAMPLES


# --- sub-threshold learned deltas are a no-op in the ranker ---


def test_sub_threshold_is_noop() -> None:
    # Two dismiss events (below the 3-sample threshold) → no adjustment applied.
    view = learning.LearningView(
        by_sender={"cold@x.co": -3.0},
        by_category={},
        sender_counts={"cold@x.co": 2},
    )
    assert learning.adjustment_for(view, sender="cold@x.co", categories=[]) == 0.0
    # At the threshold it applies.
    view_ok = learning.LearningView(
        by_sender={"cold@x.co": -3.0},
        by_category={},
        sender_counts={"cold@x.co": 3},
    )
    assert learning.adjustment_for(view_ok, sender="cold@x.co", categories=[]) == -3.0


# --- exploration mode resurfaces suppressed items ---


def test_explore_skips_negative_delta(db: Session, user: User) -> None:
    msg = _msg(user.id, "muted@news.co", ext="m-explore")
    db.add(msg)
    db.commit()
    c = _commit(user.id, source_id=msg.id, desc="Webinar invitation")
    db.add(c)
    db.commit()
    for _ in range(3):
        learning.record_event(db, user, event="dismiss", commitment=c)

    normal = p.score_commitment(
        c, today=TODAY, context=p.build_context(db, user, now=NOW, explore=False)
    )
    explore = p.score_commitment(
        c, today=TODAY, context=p.build_context(db, user, now=NOW, explore=True)
    )
    # In explore mode the negative learned delta is withheld, so the score is higher.
    assert explore.score >= normal.score
