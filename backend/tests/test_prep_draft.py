"""Tests for prep_draft: idempotency on message_id, fallback when commitment
isn't from an email, and the deep-link contract on the critical push."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import Commitment, DraftReply, Message, Notification, User
from app.services import notifications, prep_draft
from tests.fakes import FakeLLM


@pytest.fixture(autouse=True)
def _patch_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent any real Anthropic call. The LLM call inside ensure_draft_for
    is patched at the import site (`prep_draft.get_llm`) so we don't reach the
    network during tests."""
    monkeypatch.setattr(prep_draft, "get_llm", lambda: FakeLLM())


TODAY = date(2026, 6, 4)
NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="prep@example.com")
    db.add(u)
    db.commit()
    return u


def _email(user_id: str) -> tuple[Message, Commitment]:
    """Build a real message + a critical-shaped commitment pointing at it."""
    msg = Message(
        user_id=user_id,
        external_id="m-deal",
        sender="ceo@buyer.co",
        recipients=["prep@example.com"],
        subject="Contract terms",
        snippet="Adam, can you send the signed contract today?",
        sent_at=NOW,
    )
    c = Commitment(
        user_id=user_id,
        description="Sign the contract",
        evidence="Adam, can you send the signed contract today?",
        owner=CommitmentOwner.user,
        counterparty="CEO",
        due_date=TODAY,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        confidence=0.95,
    )
    return msg, c


def test_ensure_draft_creates_one_for_email_commitment(db: Session, user: User) -> None:
    msg, c = _email(user.id)
    db.add(msg)
    db.commit()
    c.source_id = msg.id
    db.add(c)
    db.commit()

    draft_id = prep_draft.ensure_draft_for(db, user, commitment=c)
    assert draft_id is not None
    assert db.query(DraftReply).count() == 1


def test_ensure_draft_is_idempotent(db: Session, user: User) -> None:
    msg, c = _email(user.id)
    db.add(msg)
    db.commit()
    c.source_id = msg.id
    db.add(c)
    db.commit()
    first = prep_draft.ensure_draft_for(db, user, commitment=c)
    second = prep_draft.ensure_draft_for(db, user, commitment=c)
    assert first == second
    assert db.query(DraftReply).count() == 1


def test_ensure_draft_returns_none_when_not_from_email(db: Session, user: User) -> None:
    c = Commitment(
        user_id=user.id,
        description="Renew passport",
        owner=CommitmentOwner.user,
        counterparty=None,
        status=CommitmentStatus.open,
        source_type=SourceType.voice,
        source_id=None,
        confidence=0.8,
    )
    db.add(c)
    db.commit()
    assert prep_draft.ensure_draft_for(db, user, commitment=c) is None


def test_critical_push_deep_links_to_draft(db: Session, user: User) -> None:
    msg, c = _email(user.id)
    # Push the due date into the past so the ranker rates this critical without
    # needing the full context infrastructure.
    c.due_date = date(2026, 5, 30)
    db.add(msg)
    db.commit()
    c.source_id = msg.id
    db.add(c)
    db.commit()

    enqueued = notifications.scan_top_priorities(db, user, today=TODAY)
    assert enqueued == 1
    notif = db.query(Notification).one()
    assert notif.payload["draft_reply_id"]
    assert notif.payload["deep_link"].startswith("/draft/")


def test_critical_push_falls_back_when_no_email(db: Session, user: User) -> None:
    # Voice-source commitment can't be drafted; the push should still fire
    # and point at /today.
    c = Commitment(
        user_id=user.id,
        description="Renew passport — overdue",
        owner=CommitmentOwner.user,
        counterparty="You",
        due_date=date(2026, 5, 1),
        status=CommitmentStatus.open,
        source_type=SourceType.voice,
        source_id=None,
        confidence=0.95,
    )
    db.add(c)
    db.commit()
    notifications.scan_top_priorities(db, user, today=TODAY)
    n = db.query(Notification).one()
    assert n.payload["deep_link"] == "/today"
    assert "draft_reply_id" not in n.payload
