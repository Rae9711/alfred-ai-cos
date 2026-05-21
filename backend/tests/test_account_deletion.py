"""Account deletion leaves no orphan rows across every user-scoped table."""

import pytest
from sqlalchemy.orm import Session

from app.api.v1.me import _USER_SCOPED, delete_account, disconnect_account
from app.db.enums import (
    ActionStatus,
    ActionType,
    CommitmentOwner,
    NotificationType,
    Provider,
    SourceType,
)
from app.db.models import (
    ActionProposal,
    CalendarEvent,
    Commitment,
    ConnectedAccount,
    DailyBriefing,
    Device,
    DraftReply,
    Message,
    Notification,
    Task,
    User,
)
from app.services.crypto import encrypt_token


@pytest.fixture
def populated_user(db: Session) -> User:
    """A user with at least one row in every user-scoped table."""
    u = User(email="delete@example.com")
    db.add(u)
    db.flush()
    db.add(
        ConnectedAccount(
            user_id=u.id,
            provider=Provider.google,
            scopes=["seed"],
            token_ciphertext=encrypt_token({"seed": True}),
        )
    )
    msg = Message(user_id=u.id, external_id="m1", sender="a@b.com", recipients=[])
    db.add(msg)
    db.add(CalendarEvent(user_id=u.id, external_id="e1"))
    db.add(
        Commitment(
            user_id=u.id,
            description="d",
            owner=CommitmentOwner.user,
            source_type=SourceType.gmail,
            confidence=0.5,
        )
    )
    db.add(Task(user_id=u.id, title="t"))
    db.flush()
    draft = DraftReply(user_id=u.id, message_id=msg.id, body="b")
    db.add(draft)
    db.add(
        ActionProposal(
            user_id=u.id, action_type=ActionType.create_draft, status=ActionStatus.proposed
        )
    )
    db.add(DailyBriefing(user_id=u.id, date=__import__("datetime").date(2026, 5, 21), summary="s"))
    db.add(Device(user_id=u.id, push_token="tok"))
    db.add(
        Notification(user_id=u.id, type=NotificationType.reminder, title="t", body="b")
    )
    db.commit()
    return u


def test_delete_account_removes_everything(db: Session, populated_user: User) -> None:
    user_id = populated_user.id
    delete_account(user=populated_user, db=db)
    for model in _USER_SCOPED:
        remaining = db.query(model).filter(model.user_id == user_id).count()
        assert remaining == 0, f"{model.__name__} still has rows"
    assert db.get(User, user_id) is None


def test_disconnect_account_removes_only_that_account(db: Session, populated_user: User) -> None:
    disconnect_account(provider=Provider.google, user=populated_user, db=db)
    assert (
        db.query(ConnectedAccount).filter(ConnectedAccount.user_id == populated_user.id).count()
        == 0
    )
    # The user and other data remain.
    assert db.get(User, populated_user.id) is not None
    assert db.query(Task).filter(Task.user_id == populated_user.id).count() == 1
