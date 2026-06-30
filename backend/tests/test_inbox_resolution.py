"""Inbox resolution: handled mail should not surface in Today / Ask / planning."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.api.v1 import messages as messages_mod
from app.capabilities.providers.send_email import SendEmailCapability
from app.db.enums import (
    CommitmentOwner,
    CommitmentStatus,
    MessageClassification,
    Priority,
    SourceType,
    TaskStatus,
)
from app.db.models import Commitment, Message, OutboundReply, Task, User
from app.services.assistant import build_assistant_context
from app.services.inbox_resolution import (
    handled_message_ids,
    resolve_derivatives_for_message,
)
from app.services.inbox_view import mark_message_user_decided
from app.services.today import build_today
from app.services.waiting import build_waiting

TODAY = date(2026, 6, 29)
NOW = datetime(2026, 6, 29, 12, 0, tzinfo=UTC)


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="resolve@example.com", timezone="America/New_York")
    db.add(u)
    db.commit()
    return u


def _message(user_id: str, **kwargs) -> Message:
    defaults = dict(
        user_id=user_id,
        source="gmail",
        external_id="msg-ext",
        sender="boss@corp.com",
        recipients=[],
        subject="Action needed",
        classification=MessageClassification.needs_reply,
        action_required=True,
        priority=Priority.high,
        sent_at=NOW - timedelta(hours=2),
        gmail_labels=["INBOX", "CATEGORY_PERSONAL"],
        sender_classification="person",
    )
    defaults.update(kwargs)
    return Message(**defaults)


def _commitment(user_id: str, message_id: str, **kwargs) -> Commitment:
    defaults = dict(
        user_id=user_id,
        description="Reply to boss about deadline",
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


def test_handled_message_ids_includes_decided_and_replied(db: Session, user: User) -> None:
    decided = _message(user.id, external_id="decided-1")
    replied = _message(user.id, external_id="replied-1")
    open_msg = _message(user.id, external_id="open-1")
    db.add_all([decided, replied, open_msg])
    db.flush()
    mark_message_user_decided(decided)
    db.add(
        OutboundReply(
            user_id=user.id,
            source_message_id=replied.id,
            thread_id="t1",
            recipient="x@example.com",
            subject="Re:",
            sent_at=NOW,
        )
    )
    db.commit()

    handled = handled_message_ids(db, user.id)
    assert decided.id in handled
    assert replied.id in handled
    assert open_msg.id not in handled


def test_resolve_derivatives_marks_commitment_and_task_done(db: Session, user: User) -> None:
    msg = _message(user.id, external_id="resolve-1")
    db.add(msg)
    db.flush()
    db.add_all(
        [
            _commitment(user.id, msg.id),
            Task(
                user_id=user.id,
                title="Follow up email",
                status=TaskStatus.open,
                source_type=SourceType.gmail,
                source_id=msg.id,
            ),
        ]
    )
    db.commit()

    changed = resolve_derivatives_for_message(db, user.id, msg.id)
    assert changed == 2
    commitment = db.query(Commitment).one()
    task = db.query(Task).one()
    assert commitment.status == CommitmentStatus.done
    assert task.status == TaskStatus.done


def test_mark_decided_closes_derivatives(db: Session, user: User) -> None:
    msg = _message(user.id, external_id="mark-decided-1")
    db.add(msg)
    db.flush()
    db.add(_commitment(user.id, msg.id))
    db.commit()

    messages_mod.mark_decided(msg.id, user=user, db=db)

    commitment = db.query(Commitment).one()
    assert commitment.status == CommitmentStatus.done


def test_build_today_excludes_handled_source_commitments(db: Session, user: User) -> None:
    handled = _message(user.id, external_id="handled-today")
    open_msg = _message(user.id, external_id="open-today")
    db.add_all([handled, open_msg])
    db.flush()
    mark_message_user_decided(handled)
    db.add_all(
        [
            _commitment(user.id, handled.id, description="Already handled overdue"),
            _commitment(user.id, open_msg.id, description="Still open overdue"),
        ]
    )
    db.commit()

    dashboard = build_today(db, user.id, today=TODAY)
    titles = {p.title for p in dashboard.top_priorities}
    assert "Already handled overdue" not in titles
    assert "Still open overdue" in titles
    assert dashboard.summary.startswith("You have 1 open loop")


def test_build_waiting_excludes_handled_commitments(db: Session, user: User) -> None:
    msg = _message(user.id, external_id="handled-waiting")
    db.add(msg)
    db.flush()
    mark_message_user_decided(msg)
    db.add(_commitment(user.id, msg.id))
    db.commit()

    view = build_waiting(db, user.id)
    assert view.waiting_on_you == []


def test_build_assistant_context_excludes_handled_inbox_and_priorities(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.fakes import FakeLLM

    monkeypatch.setattr("app.services.assistant.get_llm", lambda: FakeLLM())

    handled = _message(
        user.id,
        external_id="handled-ask",
        subject="Overdue invoice",
    )
    open_msg = _message(
        user.id,
        external_id="open-ask",
        subject="Need your RSVP",
    )
    db.add_all([handled, open_msg])
    db.flush()
    mark_message_user_decided(handled)
    db.add_all(
        [
            _commitment(user.id, handled.id, description="Pay overdue invoice"),
            _commitment(user.id, open_msg.id, description="Confirm RSVP"),
        ]
    )
    db.commit()

    ctx = build_assistant_context(db, user, tz="America/New_York")
    assert "Pay overdue invoice" not in ctx
    assert "Confirm RSVP" in ctx
    assert "Overdue invoice" not in ctx
    assert "Need your RSVP" in ctx


def test_send_email_resolves_derivatives(db: Session) -> None:
    from sqlalchemy import select

    from app.db.enums import Provider
    from app.db.models import ConnectedAccount, DraftReply
    from app.services.crypto import encrypt_token

    user = User(email="sender@example.com")
    db.add(user)
    db.flush()
    account = ConnectedAccount(
        user_id=user.id,
        provider=Provider.google,
        provider_account_email=user.email,
        scopes=["seed"],
        token_ciphertext=encrypt_token({"token": "x"}),
    )
    db.add(account)
    db.flush()
    msg = _message(user.id, external_id="send-resolve", connected_account_id=account.id)
    db.add(msg)
    db.flush()
    db.add(_commitment(user.id, msg.id))
    draft = DraftReply(user_id=user.id, message_id=msg.id, subject="Re:", body="Done")
    db.add(draft)
    db.commit()

    SendEmailCapability().execute(db, user, {"draft_reply_id": draft.id})

    commitment = db.query(Commitment).one()
    assert commitment.status == CommitmentStatus.done
