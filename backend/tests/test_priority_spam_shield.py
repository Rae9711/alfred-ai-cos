"""End-to-end spam-shield tests for the priority ranker.

These tests assert the BUSINESS CONTRACT we promise the user: marketing,
newsletters, phishing, and notifications can NEVER reach critical priority,
no matter how many bonuses their content triggers. The deterministic sender
classification is the shield; this file exercises it through the ranker.

If any of these tests start failing, the spam shield is leaking — a real
person's email might now get drowned out by marketing in Today's top
priorities, and a phishing email might get a critical-priority push.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import CommitmentOwner, CommitmentStatus, Priority, SourceType
from app.db.models import Commitment, Message, User
from app.services import priority as p

TODAY = date(2026, 6, 4)
NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


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
    subject: str,
    snippet: str = "",
    headers: dict | None = None,
    cls: str = "person",
    ext: str = "m1",
    sent_at: datetime | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        sender=sender,
        recipients=[],
        subject=subject,
        snippet=snippet,
        headers=headers or {},
        sender_classification=cls,
        sent_at=sent_at or NOW - timedelta(days=1),
    )


def _commit(
    user_id: str,
    *,
    source_id: str,
    description: str,
    evidence: str | None = None,
    due_date: date | None = None,
    counterparty: str | None = "Sender",
    priority_label: Priority = Priority.high,
    confidence: float = 0.9,
    from_automated: bool = False,
    owner: CommitmentOwner = CommitmentOwner.user,
) -> Commitment:
    return Commitment(
        user_id=user_id,
        description=description,
        evidence=evidence or description,
        owner=owner,
        counterparty=counterparty,
        due_date=due_date,
        priority=priority_label,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=source_id,
        confidence=confidence,
        from_automated=from_automated,
    )


# ---------- the business contracts ----------


def test_marketing_email_cannot_reach_critical(db: Session, user: User) -> None:
    """A worst-case spam email: hits MONEY keyword, ASK keyword, LLM-critical,
    and a phony deadline. Without the shield it would score ~85 and ping the
    user. WITH the shield it must cap at `low` regardless."""
    msg = _message(
        user.id,
        sender="hello@brand.us4.mailchimpapp.com",
        subject="ACT NOW — Sign up before the discount expires today!",
        snippet="Limited offer. Click here to sign the contract for a free invoice.",
        ext="m-spam",
        cls="automated",  # the ingest classifier would have set this
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract and confirm payment by Friday",
        evidence="ACT NOW — sign the contract — wire payment",
        due_date=TODAY,
        priority_label=Priority.critical,  # the LLM thought so
        confidence=0.9,
        from_automated=True,  # the LLM thought so
    )
    db.add(c)
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # Hard ceiling: automated → max `low`.
    assert out.priority == Priority.low, (
        f"Marketing email reached {out.priority} — shield is leaking"
    )
    assert "capped" in out.reason


def test_bulk_header_floors_priority(db: Session, user: User) -> None:
    """If the inbound carries List-Unsubscribe, it's bulk. Cap at low even if
    every content signal fires."""
    msg = _message(
        user.id,
        sender="Sarah Updates <sarah@anywhere.io>",
        subject="Today's must-read",
        snippet="Some news",
        headers={"list-unsubscribe": "<https://x.io/unsub>"},
        cls="bulk",
        ext="m-bulk",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract today",
        evidence="contract due today",
        due_date=TODAY,
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.low


def test_phishing_cannot_be_visible_at_all(db: Session, user: User) -> None:
    """A suspicious-class sender should never show up — even with extreme content
    signals, priority must be `noise` so it's invisible in Today."""
    msg = _message(
        user.id,
        sender="PayPal <support@paypa1.scam.tk>",
        subject="Re: payment confirmation",
        snippet="Click here to verify your account before it is suspended.",
        cls="suspicious",
        ext="m-phish",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Verify your account",
        evidence="please confirm",
        due_date=TODAY,
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.noise


def test_role_account_caps_at_high(db: Session, user: User) -> None:
    """info@/support@/team@ can be real people but the address is shared.
    Cap at `high` so a role account can still be important but never tops a
    real person with the same content."""
    msg = _message(
        user.id,
        sender="support@vendor.io",
        subject="Re: your incident ticket",
        snippet="here is the resolution",
        cls="role_account",
        ext="m-role",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract today",
        evidence="contract due",
        due_date=TODAY - timedelta(days=2),  # really overdue → would-be critical
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority in (Priority.low, Priority.medium, Priority.high)
    assert out.priority != Priority.critical


def test_vip_override_lets_a_marketer_reach_critical(db: Session, user: User) -> None:
    """The escape hatch: if the user explicitly marks a sender VIP, even a
    Mailchimp-platform address can hit critical when the content warrants it."""
    user.preferences = {"sender_overrides": {"vip": ["board@brand.com"]}}
    db.commit()
    msg = _message(
        user.id,
        sender="board@brand.com",
        subject="Sign contract today",
        snippet="...",
        # VIP override should run BEFORE the deterministic classifier; the
        # ingest pipeline writes `vip` to sender_classification when it sees it.
        cls="vip",
        ext="m-vip",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract today",
        evidence="contract due today",
        due_date=TODAY,
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.critical


def test_muted_buries_a_real_person(db: Session, user: User) -> None:
    """The other side of the override: a muted sender can't push past low."""
    msg = _message(
        user.id,
        sender="noisy@person.co",
        subject="Need to sign the contract",
        snippet="please",
        cls="muted",  # ingest-pipeline wrote this from user.preferences override
        ext="m-mut",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract today",
        evidence="please send signed copy",
        due_date=TODAY,
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.low


def test_real_person_still_reaches_critical(db: Session, user: User) -> None:
    """The shield must not regress the genuine case. A real person with an
    overdue ask + money keywords should still hit critical."""
    msg = _message(
        user.id,
        sender="Mary Smith <mary@buyer.co>",
        subject="Quick — the contract",
        snippet="Adam, please sign and wire payment.",
        cls="person",
        ext="m-real",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract and wire payment",
        evidence="please sign and send",
        due_date=TODAY - timedelta(days=2),  # overdue
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority == Priority.critical


def test_low_confidence_floors_to_medium(db: Session, user: User) -> None:
    """Even a real person's ask floors at medium when extraction confidence
    is below 0.5 — we won't ping the user about something the model isn't sure
    is even a real ask."""
    msg = _message(user.id, sender="Mary <mary@buyer.co>", subject="hi", cls="person", ext="m-lc")
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract today",
        evidence="maybe?",
        due_date=TODAY - timedelta(days=3),  # very overdue
        confidence=0.3,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    assert out.priority in (Priority.noise, Priority.low, Priority.medium)
    assert out.priority != Priority.critical


def test_unknown_sender_class_treats_as_person(db: Session, user: User) -> None:
    """Backwards compatibility: messages from before the shield existed
    (sender_classification = NULL) get the default `person` treatment so we
    don't regress live commitments."""
    msg = _message(user.id, sender="mary@buyer.co", subject="hi", cls="", ext="m-back")
    msg.sender_classification = None  # explicit
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Sign the contract",
        evidence="...",
        due_date=TODAY - timedelta(days=2),
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # Defaults to person → can hit critical.
    assert out.priority == Priority.critical


def test_bonus_stacking_cap(db: Session, user: User) -> None:
    """Even from a `person` sender, the additive bonus stack is hard-capped at
    95 before urgency baseline. Without the cap, every content bonus + every
    relational bonus + LLM-critical bonus stacks into orbital scores."""
    msg = _message(
        user.id,
        sender="Mary <mary@buyer.co>",
        subject="contract",
        snippet="please sign",
        cls="person",
        ext="m-stack",
    )
    db.add(msg)
    db.commit()
    c = _commit(
        user.id,
        source_id=msg.id,
        description="Can you sign the contract and wire payment please?",
        evidence="contract / wire / sign / invoice / payment / NDA / due diligence",
        due_date=TODAY - timedelta(days=2),
        priority_label=Priority.critical,
    )
    db.add(c)
    db.commit()
    ctx = p.build_context(db, user, now=NOW)
    out = p.score_commitment(c, today=TODAY, context=ctx)
    # Score is bounded; can hit critical but not exceed 100.
    assert out.score <= 100
    assert out.priority == Priority.critical


# ---------- mixed-batch end-to-end ranking ----------


def test_real_person_outranks_marketing_even_when_marketing_has_more_keywords(
    db: Session, user: User
) -> None:
    """The grand-daddy test: a Mailchimp newsletter with all the right keywords
    (sign contract / wire payment / today) should rank BELOW a real human's
    quiet "Quick Q on the spec" message. Without the shield this is exactly
    the case where the user got woken up by spam."""
    # Marketing
    msg_marketing = _message(
        user.id,
        sender="hello@brand.us4.mailchimpapp.com",
        subject="ACT NOW — Sign the contract and wire payment today",
        snippet="Free invoice template — contract money signed today",
        cls="automated",
        ext="m-spam",
    )
    db.add(msg_marketing)

    # Real human, quiet ask
    msg_real = _message(
        user.id,
        sender="Mary Smith <mary@buyer.co>",
        subject="Quick Q on the spec",
        snippet="Adam, can you look at section 3?",
        cls="person",
        ext="m-real2",
    )
    db.add(msg_real)
    db.commit()

    c_marketing = _commit(
        user.id,
        source_id=msg_marketing.id,
        description="Sign the contract and wire payment",
        evidence="ACT NOW signed contract wire payment",
        due_date=TODAY,
        priority_label=Priority.critical,
        confidence=0.95,
    )
    c_real = _commit(
        user.id,
        source_id=msg_real.id,
        description="Look at section 3 of the spec",
        evidence="can you look at section 3?",
        due_date=None,
        priority_label=Priority.medium,
        confidence=0.85,
    )
    db.add(c_marketing)
    db.add(c_real)
    db.commit()

    ctx = p.build_context(db, user, now=NOW)
    score_marketing = p.score_commitment(c_marketing, today=TODAY, context=ctx)
    score_real = p.score_commitment(c_real, today=TODAY, context=ctx)
    # Real beats marketing — full stop.
    assert score_real.score > score_marketing.score, (
        f"marketing scored {score_marketing.score}, real scored {score_real.score}"
    )
