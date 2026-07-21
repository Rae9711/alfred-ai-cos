"""Gmail read/old => handled rule.

A Gmail message that is already read (no UNREAD label) or older than the age cutoff
(default 30 days) is treated as already handled: it is not surfaced as needs-action and
generates no reminders, and any commitment sourced solely from it drops out of the
priority/reminder surfaces. SMS/WhatsApp are unaffected (their read semantics differ).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import (
    CommitmentOwner,
    CommitmentStatus,
    MessageClassification,
    Priority,
    SourceType,
    TaskStatus,
)
from app.db.models import Commitment, Message, Task, User
from app.services import extraction
from app.services import notifications as n
from app.services.inbox_resolution import handled_message_ids
from app.services.inbox_view import (
    gmail_read_or_stale,
    message_is_handled,
    needs_action_message_ids,
)
from app.services.today import build_today
from tests.fakes import FakeLLM, fake_commitment

NOW = datetime.now(UTC)
RECENT = NOW - timedelta(hours=2)
OLD = NOW - timedelta(days=60)
TODAY = date.today()

UNREAD = ["INBOX", "CATEGORY_PERSONAL", "UNREAD"]
READ = ["INBOX", "CATEGORY_PERSONAL"]


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="me@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def _msg(user_id: str, **kwargs) -> Message:
    defaults = dict(
        user_id=user_id,
        source="gmail",
        external_id="ext",
        sender="boss@corp.com",
        recipients=[],
        subject="Action needed",
        snippet="please reply",
        classification=MessageClassification.needs_reply,
        action_required=True,
        priority=Priority.high,
        sent_at=RECENT,
        gmail_labels=UNREAD,
        sender_classification="person",
    )
    defaults.update(kwargs)
    return Message(**defaults)


def _commitment(user_id: str, message_id: str, **kwargs) -> Commitment:
    defaults = dict(
        user_id=user_id,
        description="Reply to boss",
        owner=CommitmentOwner.user,
        counterparty="Boss",
        due_date=TODAY - timedelta(days=2),
        priority=Priority.critical,
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id=message_id,
        confidence=0.9,
    )
    defaults.update(kwargs)
    return Commitment(**defaults)


# --- gmail_read_or_stale unit ---


def test_read_gmail_is_handled(user: User) -> None:
    assert gmail_read_or_stale(_msg(user.id, gmail_labels=READ, sent_at=RECENT)) is True


def test_stale_gmail_is_handled_even_when_unread(user: User) -> None:
    assert gmail_read_or_stale(_msg(user.id, gmail_labels=UNREAD, sent_at=OLD)) is True


def test_unread_recent_gmail_is_not_handled(user: User) -> None:
    assert gmail_read_or_stale(_msg(user.id, gmail_labels=UNREAD, sent_at=RECENT)) is False


def test_unknown_labels_recent_is_not_handled(user: User) -> None:
    # None labels count as unread, so only the age cutoff can apply.
    assert gmail_read_or_stale(_msg(user.id, gmail_labels=None, sent_at=RECENT)) is False


def test_sms_read_is_not_gmail_handled(user: User) -> None:
    # SMS read semantics differ; the Gmail rule must never apply to SMS.
    sms = _msg(user.id, source="sms", gmail_labels=None, sent_at=RECENT)
    assert gmail_read_or_stale(sms) is False


def test_message_is_handled_combines_decided(user: User) -> None:
    from app.services.inbox_view import mark_message_user_decided

    m = _msg(user.id, gmail_labels=UNREAD, sent_at=RECENT)
    assert message_is_handled(m) is False
    mark_message_user_decided(m)
    assert message_is_handled(m) is True


# --- handled_message_ids central chokepoint ---


def test_handled_message_ids_includes_read_and_stale(db: Session, user: User) -> None:
    read = _msg(user.id, external_id="read", gmail_labels=READ, sent_at=RECENT)
    stale = _msg(user.id, external_id="stale", gmail_labels=UNREAD, sent_at=OLD)
    fresh = _msg(user.id, external_id="fresh", gmail_labels=UNREAD, sent_at=RECENT)
    db.add_all([read, stale, fresh])
    db.commit()

    handled = handled_message_ids(db, user.id)
    assert read.id in handled
    assert stale.id in handled
    assert fresh.id not in handled


# --- extraction short-circuit ---


def test_read_email_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        extraction, "get_llm", lambda: FakeLLM(commitments=[fake_commitment()])
    )
    msg = _msg(user.id, gmail_labels=READ, sent_at=RECENT)
    db.add(msg)
    db.commit()
    assert extraction.process_message(db, msg, body="please reply") == []
    assert db.query(Commitment).count() == 0


def test_old_email_extracts_nothing(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        extraction, "get_llm", lambda: FakeLLM(commitments=[fake_commitment()])
    )
    msg = _msg(user.id, gmail_labels=UNREAD, sent_at=OLD)
    db.add(msg)
    db.commit()
    assert extraction.process_message(db, msg, body="please reply") == []


def test_unread_recent_email_still_extracts(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        extraction, "get_llm", lambda: FakeLLM(commitments=[fake_commitment()])
    )
    msg = _msg(user.id, gmail_labels=UNREAD, sent_at=RECENT)
    db.add(msg)
    db.commit()
    assert len(extraction.process_message(db, msg, body="please reply")) == 1


# --- needs-action tab ---


def test_needs_action_excludes_read_and_old(db: Session, user: User) -> None:
    read = _msg(user.id, external_id="na-read", gmail_labels=READ, sent_at=RECENT)
    stale = _msg(user.id, external_id="na-stale", gmail_labels=UNREAD, sent_at=OLD)
    fresh = _msg(user.id, external_id="na-fresh", gmail_labels=UNREAD, sent_at=RECENT)
    db.add_all([read, stale, fresh])
    db.commit()

    ids = needs_action_message_ids(db, user.id)
    assert fresh.id in ids
    assert read.id not in ids
    assert stale.id not in ids


# --- Today priorities ---


def test_build_today_excludes_read_source_commitment(db: Session, user: User) -> None:
    read = _msg(user.id, external_id="t-read", gmail_labels=READ, sent_at=RECENT)
    fresh = _msg(user.id, external_id="t-fresh", gmail_labels=UNREAD, sent_at=RECENT)
    db.add_all([read, fresh])
    db.flush()
    db.add_all(
        [
            _commitment(user.id, read.id, description="From a read email"),
            _commitment(user.id, fresh.id, description="From an unread email"),
        ]
    )
    db.commit()

    titles = {p.title for p in build_today(db, user.id, today=TODAY).top_priorities}
    assert "From a read email" not in titles
    assert "From an unread email" in titles


# --- reminder scans ---


def test_top_priority_push_skips_read_source(db: Session, user: User) -> None:
    read = _msg(user.id, external_id="p-read", gmail_labels=READ, sent_at=RECENT)
    db.add(read)
    db.flush()
    db.add(_commitment(user.id, read.id, description="Sign the contract"))
    db.commit()
    # Would be critical (overdue, user-owed) but the source email is read => filtered.
    assert n.scan_top_priorities(db, user, today=TODAY) == 0


def test_top_priority_push_fires_for_unread_source(db: Session, user: User) -> None:
    fresh = _msg(user.id, external_id="p-fresh", gmail_labels=UNREAD, sent_at=RECENT)
    db.add(fresh)
    db.flush()
    db.add(_commitment(user.id, fresh.id, description="Sign the contract"))
    db.commit()
    assert n.scan_top_priorities(db, user, today=TODAY) == 1


def test_task_reminder_skips_read_source(db: Session, user: User) -> None:
    read = _msg(user.id, external_id="tr-read", gmail_labels=READ, sent_at=RECENT)
    db.add(read)
    db.flush()
    now = datetime.now(UTC)
    db.add(
        Task(
            user_id=user.id,
            title="Follow up",
            status=TaskStatus.open,
            source_type=SourceType.gmail,
            source_id=read.id,
            remind_at=now + timedelta(minutes=10),
        )
    )
    db.commit()
    assert n.scan_task_reminders(db, user.id, now=now) == 0


# --- SMS unaffected ---


def test_sms_commitment_still_surfaces_when_read(db: Session, user: User) -> None:
    # An SMS marked read in its own model must NOT be swept up by the Gmail rule.
    sms = _msg(
        user.id,
        source="sms",
        external_id="sms-1",
        gmail_labels=None,
        sent_at=RECENT,
    )
    db.add(sms)
    db.flush()
    db.add(_commitment(user.id, sms.id, description="Text back Mom", counterparty="Mom"))
    db.commit()

    assert sms.id not in handled_message_ids(db, user.id)
    titles = {p.title for p in build_today(db, user.id, today=TODAY).top_priorities}
    assert "Text back Mom" in titles


# --- backfill script ---


def test_backfill_dry_run_counts_but_does_not_change(db: Session, user: User) -> None:
    from app.scripts.backfill_read_handled import run_backfill
    from app.services.inbox_view import message_user_decided

    read = _msg(user.id, external_id="bf-read", gmail_labels=READ, sent_at=RECENT)
    stale = _msg(user.id, external_id="bf-stale", gmail_labels=UNREAD, sent_at=OLD)
    fresh = _msg(user.id, external_id="bf-fresh", gmail_labels=UNREAD, sent_at=RECENT)
    sms = _msg(user.id, source="sms", external_id="bf-sms", gmail_labels=None, sent_at=OLD)
    db.add_all([read, stale, fresh, sms])
    db.flush()
    db.add(_commitment(user.id, read.id, description="Read-derived"))
    db.commit()

    counts = run_backfill(db, apply=False)
    assert len(counts.qualifying_message_ids) == 2  # read + stale (not fresh, not sms)
    assert counts.messages_read == 1
    assert counts.messages_stale_only == 1
    assert counts.commitments_closed == 1
    # Dry run: nothing persisted.
    assert message_user_decided(read) is False
    assert db.query(Commitment).one().status == CommitmentStatus.open


def test_backfill_apply_marks_handled_and_closes_and_is_idempotent(
    db: Session, user: User
) -> None:
    from app.scripts.backfill_read_handled import run_backfill
    from app.services.inbox_view import message_user_decided

    read = _msg(user.id, external_id="bfa-read", gmail_labels=READ, sent_at=RECENT)
    fresh = _msg(user.id, external_id="bfa-fresh", gmail_labels=UNREAD, sent_at=RECENT)
    db.add_all([read, fresh])
    db.flush()
    db.add(_commitment(user.id, read.id, description="Read-derived"))
    db.add(_commitment(user.id, fresh.id, description="Fresh-derived"))
    db.commit()

    counts = run_backfill(db, apply=True)
    assert counts.messages_marked_decided == 1
    assert counts.commitments_closed == 1

    assert message_user_decided(read) is True
    assert message_user_decided(fresh) is False
    statuses = {c.description: c.status for c in db.query(Commitment)}
    assert statuses["Read-derived"] == CommitmentStatus.done
    assert statuses["Fresh-derived"] == CommitmentStatus.open

    # Idempotent: a second apply changes nothing further.
    again = run_backfill(db, apply=True)
    assert again.messages_marked_decided == 0
    assert again.commitments_closed == 0
