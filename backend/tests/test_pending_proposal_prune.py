"""Pending approval queue should not keep orphan / already-read draft sends."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.enums import ActionStatus, ActionType, CommitmentOwner, CommitmentStatus, SourceType
from app.db.models import ActionProposal, Commitment, DraftReply, Message, User
from app.services.actions import list_pending_proposals, reject_proposals_for_message
from app.services.inbox_resolution import filter_actionable_commitments, user_message_ids
from app.services.waiting import build_waiting


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="prune@example.com")
    db.add(u)
    db.commit()
    return u


def _unread_message(user_id: str, external_id: str = "m1") -> Message:
    return Message(
        user_id=user_id,
        external_id=external_id,
        sender="boss@corp.com",
        recipients=["prune@example.com"],
        subject="Need reply",
        snippet="please reply",
        sent_at=datetime.now(UTC),
        gmail_labels=["INBOX", "CATEGORY_PERSONAL", "UNREAD"],
    )


def test_list_pending_rejects_orphan_draft_proposals(db: Session, user: User) -> None:
    proposal = ActionProposal(
        user_id=user.id,
        action_type=ActionType.send_email,
        risk_level=3,
        target={"draft_reply_id": "missing-draft"},
        reason="Follow up with someone",
        approval_required=True,
        status=ActionStatus.proposed,
    )
    db.add(proposal)
    db.commit()

    assert list_pending_proposals(db, user.id) == []
    db.refresh(proposal)
    assert proposal.status == ActionStatus.rejected


def test_list_pending_rejects_handled_source_mail(db: Session, user: User) -> None:
    msg = _unread_message(user.id)
    msg.gmail_labels = ["INBOX", "CATEGORY_PERSONAL"]  # read
    db.add(msg)
    db.flush()
    draft = DraftReply(
        user_id=user.id,
        message_id=msg.id,
        subject="Re: Need reply",
        body="Thanks!",
    )
    db.add(draft)
    db.flush()
    proposal = ActionProposal(
        user_id=user.id,
        action_type=ActionType.send_email,
        risk_level=3,
        target={"draft_reply_id": draft.id},
        reason="Follow up",
        approval_required=True,
        status=ActionStatus.proposed,
    )
    db.add(proposal)
    db.commit()

    assert list_pending_proposals(db, user.id) == []
    db.refresh(proposal)
    assert proposal.status == ActionStatus.rejected


def test_reject_proposals_for_message(db: Session, user: User) -> None:
    msg = _unread_message(user.id)
    db.add(msg)
    db.flush()
    draft = DraftReply(
        user_id=user.id,
        message_id=msg.id,
        subject="Re:",
        body="Hi",
    )
    db.add(draft)
    db.flush()
    proposal = ActionProposal(
        user_id=user.id,
        action_type=ActionType.send_email,
        risk_level=3,
        target={"draft_reply_id": draft.id},
        status=ActionStatus.proposed,
    )
    db.add(proposal)
    db.commit()

    assert reject_proposals_for_message(db, user.id, msg.id) == 1
    db.refresh(proposal)
    assert proposal.status == ActionStatus.rejected


def test_waiting_drops_gmail_commitments_with_missing_source(db: Session, user: User) -> None:
    now = datetime.now(UTC)
    orphan = Commitment(
        user_id=user.id,
        description="Chase missing mail",
        owner=CommitmentOwner.counterparty,
        counterparty="Vendor",
        status=CommitmentStatus.open,
        source_type=SourceType.gmail,
        source_id="deleted-message-id",
        created_at=now - timedelta(days=10),
    )
    db.add(orphan)
    db.commit()

    view = build_waiting(db, user.id)
    assert view.you_are_waiting_on == []

    # Explicit filter contract used by Today / notification scanners.
    kept = filter_actionable_commitments(
        [orphan],
        handled_ids=set(),
        known_message_ids=user_message_ids(db, user.id),
    )
    assert kept == []
