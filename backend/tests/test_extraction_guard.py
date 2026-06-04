"""Tests for the extraction guard: don't even create commitments from
automated / bulk / suspicious / muted senders. The spam shield caps such
commitments at `low` anyway, but stopping at extraction time saves LLM
tokens AND keeps the inbox visually clean."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.db.models import Commitment, Message, User
from app.services import extraction
from tests.fakes import FakeLLM, fake_commitment


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev")
    db.add(u)
    db.commit()
    return u


def _msg(user_id: str, *, sender: str, cls: str, ext: str = "m1") -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=[],
        subject="Sign the contract by Friday",
        snippet="Adam please sign the contract and confirm payment by Friday.",
        sent_at=datetime(2026, 6, 5, tzinfo=UTC),
        sender_classification=cls,
    )


def _patch(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    monkeypatch.setattr(extraction, "get_llm", lambda: fake)


def test_automated_sender_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Mailchimp marketing email — even with the perfect commitment-shaped
    subject — produces zero Commitment rows because extraction is short-
    circuited at the guard."""
    fake = FakeLLM(commitments=[fake_commitment(description="Sign the contract")])
    _patch(monkeypatch, fake)
    msg = _msg(user.id, sender="hello@brand.mailchimpapp.com", cls="automated")
    db.add(msg)
    db.commit()

    out = extraction.process_message(db, msg, body="ACT NOW: sign the contract")
    assert out == []
    assert db.query(Commitment).count() == 0


def test_bulk_sender_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(commitments=[fake_commitment(description="Sign the contract")])
    _patch(monkeypatch, fake)
    msg = _msg(user.id, sender="news@anywhere.io", cls="bulk")
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="please reply")
    assert out == []


def test_suspicious_sender_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(commitments=[fake_commitment(description="Verify your account")])
    _patch(monkeypatch, fake)
    msg = _msg(user.id, sender="PayPal <support@paypa1.scam.tk>", cls="suspicious")
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="click here to verify")
    assert out == []


def test_muted_sender_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeLLM(commitments=[fake_commitment(description="Hi from a muted contact")])
    _patch(monkeypatch, fake)
    msg = _msg(user.id, sender="x@noise.io", cls="muted")
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="please reply soon")
    assert out == []


def test_person_sender_still_extracts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No regression on the genuine case: a real human's email still extracts."""
    fake = FakeLLM(commitments=[fake_commitment(description="Sign the contract")])
    _patch(monkeypatch, fake)
    msg = _msg(user.id, sender="Mary <mary@buyer.co>", cls="person")
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="please sign")
    assert len(out) == 1


def test_transactional_critical_still_extracts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real Stripe failed-payment alert MUST still produce a commitment so
    the user gets pinged. This is the whole point of the new class."""
    fake = FakeLLM(commitments=[fake_commitment(description="Update your card on Stripe")])
    _patch(monkeypatch, fake)
    msg = _msg(
        user.id,
        sender="billing@stripe.com",
        cls="transactional_critical",
    )
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="card declined")
    assert len(out) == 1


def test_null_classification_extracts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Backwards compatibility: messages from before the classifier existed
    (NULL sender_classification) should still extract — they default to
    person-equivalent at scoring time."""
    fake = FakeLLM(commitments=[fake_commitment(description="hi")])
    _patch(monkeypatch, fake)
    msg = Message(
        user_id=user.id,
        external_id="legacy",
        sender="Mary <mary@buyer.co>",
        recipients=[],
        subject="legacy",
        snippet="legacy",
        sent_at=datetime(2026, 6, 5, tzinfo=UTC),
        # No sender_classification.
    )
    db.add(msg)
    db.commit()
    out = extraction.process_message(db, msg, body="hi")
    assert len(out) == 1
