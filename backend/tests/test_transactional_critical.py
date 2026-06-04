"""Tests for the transactional_critical class — verified-issuer alerts that
have legitimate critical action items (Stripe failed payment, AWS deletion
notice, DocuSign signature requested, IRS notice). These bypass the
automated-cap shield because they ARE important; the strict domain check
prevents phishing impersonation."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority, SourceType
from app.db.models import Commitment, Message, User
from app.services import priority as p
from app.services import sender_class as sc

TODAY = date(2026, 6, 5)
NOW = datetime(2026, 6, 5, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@adam.dev")
    db.add(u)
    db.commit()
    return u


# --- classification ---


def test_stripe_failed_payment_is_transactional_critical() -> None:
    out = sc.classify(
        sender="billing@stripe.com",
        subject="Payment failed for your subscription",
        snippet="Your card was declined.",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_stripe_normal_receipt_is_not_critical() -> None:
    # Plain "Your receipt #12345" doesn't match the critical-subject pattern;
    # falls back to the regular transactional/automated rules.
    out = sc.classify(
        sender="receipts@email.stripe.com",
        subject="Your receipt from Acme Co",
        snippet="thanks",
        headers={},
    )
    assert out.cls != "transactional_critical"


def test_docusign_signature_requested_is_critical() -> None:
    out = sc.classify(
        sender="dse@docusign.com",
        subject="Please sign: NDA — Acme x Buyer",
        snippet="A document is ready for your signature.",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_aws_account_suspended_is_critical() -> None:
    out = sc.classify(
        sender="no-reply@aws.amazon.com",
        subject="Action required: your AWS account will be suspended",
        snippet="Update payment to avoid suspension.",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_irs_notice_is_critical() -> None:
    out = sc.classify(
        sender="notifications@irs.gov",
        subject="Action required to verify your identity",
        snippet="...",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_uk_gov_notice_is_critical() -> None:
    out = sc.classify(
        sender="alerts@hmrc.gov.uk",
        subject="Final notice before enforcement",
        snippet="...",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_security_alert_from_google_is_critical() -> None:
    out = sc.classify(
        sender="no-reply@google.com",
        subject="Security alert: unusual sign-in from a new device",
        snippet="...",
        headers={},
    )
    assert out.cls == "transactional_critical"


def test_phishing_claiming_stripe_is_NOT_critical() -> None:
    """The strict domain check is the phishing defense. A subject matching
    the critical pattern but from a fake domain stays suspicious."""
    out = sc.classify(
        sender="Stripe Billing <support@stripe-secure-payment.tk>",
        subject="Payment failed for your subscription",
        snippet="Click to update your card.",
        headers={},
    )
    assert out.cls != "transactional_critical"
    # Should be flagged as suspicious / impersonation.
    assert out.cls == "suspicious"


def test_subject_alone_is_not_enough() -> None:
    """A friend writing 'payment failed' from gmail.com is NOT critical.
    Both conditions must hold: verified-issuer domain AND critical subject."""
    out = sc.classify(
        sender="Mary <mary@gmail.com>",
        subject="payment failed",
        snippet="hi adam fyi",
        headers={},
    )
    assert out.cls != "transactional_critical"


# --- ranker integration ---


def _msg(user_id: str, *, cls: str, sender: str, subject: str, ext: str = "m1") -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=[],
        subject=subject,
        snippet="...",
        sender_classification=cls,
        sent_at=NOW - timedelta(hours=1),
    )


def _commit(
    user_id: str,
    *,
    source_id: str,
    description: str,
    priority_label: Priority = Priority.high,
    due_date: date | None = None,
) -> Commitment:
    return Commitment(
        user_id=user_id,
        description=description,
        evidence=description,
        owner=CommitmentOwner.user,
        counterparty="Stripe",
        due_date=due_date,
        priority=priority_label,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=0.9,
    )


def test_transactional_critical_can_reach_critical(db: Session, user: User) -> None:
    """The whole point: a verified Stripe failed-payment alert produces a
    commitment that scores high enough for the critical-priority push."""
    m = _msg(
        user.id,
        cls="transactional_critical",
        sender="billing@stripe.com",
        subject="Payment failed",
    )
    db.add(m)
    db.commit()
    c = _commit(
        user.id,
        source_id=m.id,
        description="Update your card to avoid suspension",
        priority_label=Priority.critical,
        due_date=TODAY,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # No regression: this CAN reach critical.
    assert out.priority == Priority.critical


def test_automated_stripe_alert_still_caps_at_low(db: Session, user: User) -> None:
    """A Stripe email that does NOT match the critical-subject pattern (e.g.,
    a normal monthly summary) classifies as automated and caps at low even if
    the LLM extracts a commitment from it."""
    m = _msg(
        user.id,
        cls="automated",
        sender="receipts@email.stripe.com",
        subject="Your monthly summary",
    )
    db.add(m)
    db.commit()
    c = _commit(
        user.id,
        source_id=m.id,
        description="Pay your invoice",
        priority_label=Priority.critical,
        due_date=TODAY,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.low
