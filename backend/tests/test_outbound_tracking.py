"""Tests for outbound reply tracking: record-on-send, thread resolution when a
reply arrives, and silence-nudge after N days."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import NotificationType
from app.db.models import Message, Notification, OutboundReply, User
from app.services import outbound_tracking

NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="adam@adam.dev")
    db.add(u)
    db.commit()
    return u


def _msg(
    user_id: str,
    *,
    ext: str,
    sender: str = "mary@buyer.co",
    thread_id: str = "t1",
    sent_at: datetime | None = None,
) -> Message:
    return Message(
        user_id=user_id,
        external_id=ext,
        thread_id=thread_id,
        sender=sender,
        recipients=["adam@adam.dev"],
        subject="Contract terms",
        sent_at=sent_at or NOW - timedelta(days=5),
    )


def test_record_send_creates_row(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src")
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: Contract terms"
    )
    assert row.user_id == user.id
    assert row.thread_id == src.thread_id
    assert row.resolved_at is None
    assert db.query(OutboundReply).count() == 1


def test_record_send_is_idempotent(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src")
    db.add(src)
    db.commit()
    first = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject=None
    )
    second = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject=None
    )
    assert first.id == second.id
    assert db.query(OutboundReply).count() == 1


def test_resolve_marks_responded_threads(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-resp", sent_at=NOW - timedelta(days=4))
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    # The user replied at NOW-4d; mary replied 1 day later.
    row.sent_at = NOW - timedelta(days=4)
    db.add(
        _msg(
            user.id,
            ext="reply",
            thread_id="t-resp",
            sender="mary@buyer.co",
            sent_at=NOW - timedelta(days=3),
        )
    )
    db.commit()
    assert outbound_tracking.resolve_replied_threads(db, user, now=NOW) == 1
    db.refresh(row)
    assert row.resolved_at is not None


def test_resolve_ignores_user_own_messages(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-self", sent_at=NOW - timedelta(days=4))
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    row.sent_at = NOW - timedelta(days=4)
    # Only the user replied again — that's not a response from the counterparty.
    db.add(
        _msg(
            user.id,
            ext="follow",
            thread_id="t-self",
            sender="adam@adam.dev",
            sent_at=NOW - timedelta(days=3),
        )
    )
    db.commit()
    assert outbound_tracking.resolve_replied_threads(db, user, now=NOW) == 0
    db.refresh(row)
    assert row.resolved_at is None


def test_silent_thread_pushes_after_three_days(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-silent", sent_at=NOW - timedelta(days=5))
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    row.sent_at = NOW - timedelta(days=5)
    db.commit()
    assert outbound_tracking.scan_silent_threads(db, user, now=NOW) == 1
    notif = db.query(Notification).one()
    assert notif.type == NotificationType.follow_up_due
    assert "5 days" in notif.body
    assert notif.payload["deep_link"] == "/waiting"
    # follow_up_pushed flips so the next scan doesn't re-push.
    db.refresh(row)
    assert row.follow_up_pushed is True


def test_silent_scan_skips_fresh_sends(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-fresh", sent_at=NOW - timedelta(hours=6))
    db.add(src)
    db.commit()
    outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    assert outbound_tracking.scan_silent_threads(db, user, now=NOW) == 0


def test_silent_scan_skips_resolved(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-resolved", sent_at=NOW - timedelta(days=5))
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    row.sent_at = NOW - timedelta(days=5)
    row.resolved_at = NOW - timedelta(days=1)
    db.commit()
    assert outbound_tracking.scan_silent_threads(db, user, now=NOW) == 0


def test_silent_scan_is_deduped(db: Session, user: User) -> None:
    src = _msg(user.id, ext="src", thread_id="t-dedup", sent_at=NOW - timedelta(days=5))
    db.add(src)
    db.commit()
    row = outbound_tracking.record_send(
        db, user, source_message=src, recipient=src.sender, subject="Re: x"
    )
    row.sent_at = NOW - timedelta(days=5)
    db.commit()
    outbound_tracking.scan_silent_threads(db, user, now=NOW)
    outbound_tracking.scan_silent_threads(db, user, now=NOW + timedelta(days=1))
    assert db.query(Notification).count() == 1
