"""Waiting-for tracker tests against SQLite."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, User
from app.services import waiting as waiting_service


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="waiting@example.com")
    db.add(u)
    db.commit()
    return u


def _commitment(user_id: str, **kwargs: object) -> Commitment:
    defaults: dict[str, object] = {
        "user_id": user_id,
        "description": "Send the doc",
        "owner": CommitmentOwner.user,
        "counterparty": "Dana",
        "status": CommitmentStatus.open,
        "source_type": SourceType.gmail,
        "confidence": 0.9,
    }
    defaults.update(kwargs)
    return Commitment(**defaults)


def test_splits_by_direction(db: Session, user: User) -> None:
    db.add(_commitment(user.id, owner=CommitmentOwner.user, counterparty="Dana"))
    db.add(_commitment(user.id, owner=CommitmentOwner.counterparty, counterparty="Marc"))
    db.commit()
    view = waiting_service.build_waiting(db, user.id)
    assert [e.commitment.counterparty for e in view.waiting_on_you] == ["Dana"]
    assert [e.commitment.counterparty for e in view.you_are_waiting_on] == ["Marc"]


def test_excludes_closed_and_counterpartyless(db: Session, user: User) -> None:
    db.add(_commitment(user.id, status=CommitmentStatus.done))
    db.add(_commitment(user.id, counterparty=None))
    db.commit()
    view = waiting_service.build_waiting(db, user.id)
    assert view.waiting_on_you == []
    assert view.you_are_waiting_on == []


def test_orders_oldest_first(db: Session, user: User) -> None:
    old = _commitment(user.id, counterparty="Old")
    new = _commitment(user.id, counterparty="New")
    db.add(old)
    db.add(new)
    db.commit()
    # Backdate one commitment so its age is larger.
    old.created_at = datetime.now(UTC) - timedelta(days=10)
    db.commit()
    view = waiting_service.build_waiting(db, user.id)
    assert view.waiting_on_you[0].commitment.counterparty == "Old"
    assert view.waiting_on_you[0].age_days >= 10
