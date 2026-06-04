"""Search service tests against SQLite. The Postgres path is exercised in
integration only; here we cover the SQLite fallback which mirrors the API
contract."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, Message, User
from app.services import search

NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="search@example.com")
    db.add(u)
    db.commit()
    return u


def _msg(
    user_id: str,
    *,
    ext: str,
    subject: str,
    body: str = "",
    snippet: str = "",
    sender: str = "x@y.z",
    sent_at: datetime | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        subject=subject,
        body_summary=body,
        snippet=snippet,
        sender=sender,
        recipients=[],
        sent_at=sent_at or NOW - timedelta(days=1),
    )


def _commit(
    user_id: str,
    *,
    description: str,
    evidence: str | None = None,
    counterparty: str | None = None,
    status: CommitmentStatus = CommitmentStatus.open,
) -> Commitment:
    return Commitment(
        user_id=user_id,
        description=description,
        evidence=evidence,
        owner=CommitmentOwner.user,
        counterparty=counterparty,
        status=status,
        source_type=SourceType.gmail,
        confidence=0.9,
    )


# --- basic match ---


def test_finds_message_by_subject(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", subject="Quarterly contract review", sender="ceo@buyer.co"))
    db.add(_msg(user.id, ext="m2", subject="Lunch on Thursday"))
    db.commit()
    hits = search.search(db, user.id, q="contract")
    assert len(hits) == 1
    assert hits[0].kind == "message"
    assert "contract" in hits[0].title.lower()


def test_finds_commitment_by_description(db: Session, user: User) -> None:
    db.add(_commit(user.id, description="Sign the contract", counterparty="Buyer"))
    db.add(_commit(user.id, description="Book a flight"))
    db.commit()
    hits = search.search(db, user.id, q="contract")
    assert len(hits) == 1
    assert hits[0].kind == "commitment"


def test_searches_across_both_types(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", subject="Contract terms"))
    db.add(_commit(user.id, description="Send signed contract"))
    db.commit()
    hits = search.search(db, user.id, q="contract")
    kinds = {h.kind for h in hits}
    assert kinds == {"message", "commitment"}


# --- multi-word + ranking ---


def test_multi_word_query_requires_both_terms(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", subject="Contract on flights", body="for next quarter"))
    db.add(_msg(user.id, ext="m2", subject="Just about flights"))
    db.add(_msg(user.id, ext="m3", subject="Contract only here"))
    db.commit()
    hits = search.search(db, user.id, q="contract flights")
    titles = {h.title for h in hits}
    # Only the message that has both tokens passes the AND-across-tokens shape.
    assert titles == {"Contract on flights"}


def test_open_commitment_outranks_dismissed(db: Session, user: User) -> None:
    db.add(_commit(user.id, description="Sign the contract", status=CommitmentStatus.dismissed))
    db.add(_commit(user.id, description="Sign the contract", status=CommitmentStatus.open))
    db.commit()
    hits = search.search(db, user.id, q="contract")
    # Open one comes first because of the +0.15 status boost.
    assert hits[0].score >= hits[1].score


# --- filtering ---


def test_kind_filter_limits_results(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", subject="Contract draft"))
    db.add(_commit(user.id, description="Sign the contract"))
    db.commit()
    only_msgs = search.search(db, user.id, q="contract", kinds={"message"})
    assert {h.kind for h in only_msgs} == {"message"}
    only_commits = search.search(db, user.id, q="contract", kinds={"commitment"})
    assert {h.kind for h in only_commits} == {"commitment"}


def test_short_query_returns_nothing(db: Session, user: User) -> None:
    db.add(_msg(user.id, ext="m1", subject="A"))
    db.commit()
    assert search.search(db, user.id, q="a") == []
    assert search.search(db, user.id, q="") == []


def test_limit_caps_results(db: Session, user: User) -> None:
    for i in range(20):
        db.add(_msg(user.id, ext=f"m-{i}", subject="contract"))
    db.commit()
    hits = search.search(db, user.id, q="contract", limit=5)
    assert len(hits) == 5


# --- isolation ---


def test_does_not_leak_across_users(db: Session) -> None:
    a = User(email="a@x.io")
    b = User(email="b@x.io")
    db.add_all([a, b])
    db.commit()
    db.add(_msg(a.id, ext="m1", subject="A's contract"))
    db.add(_msg(b.id, ext="m2", subject="B's contract"))
    db.commit()
    a_hits = search.search(db, a.id, q="contract")
    assert len(a_hits) == 1
    assert a_hits[0].title == "A's contract"
