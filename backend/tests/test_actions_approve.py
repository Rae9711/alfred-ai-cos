"""Approval-endpoint hardening: a duplicate approve is a clean 409, not a 500, and it
never executes the action twice; and a deliberate HTTPException from the execution path
propagates unchanged instead of being re-wrapped into a 502 by the generic handler."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.v1 import actions as actions_mod
from app.db.enums import ActionStatus, ActionType
from app.db.models import Task, User
from app.services import execution
from app.services.actions import propose_action_internal


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="approve@example.com")
    db.add(u)
    db.commit()
    return u


def test_double_approve_returns_409_and_executes_once(db: Session, user: User) -> None:
    proposal = propose_action_internal(
        db, user, action_type=ActionType.create_task, target={"title": "Follow up"}
    )

    first = actions_mod.approve_action(proposal.id, user=user, db=db)
    assert first.status == ActionStatus.executed

    # Second (duplicate) approve must be a clean 409, not a 500.
    with pytest.raises(HTTPException) as exc:
        actions_mod.approve_action(proposal.id, user=user, db=db)
    assert exc.value.status_code == 409
    assert "already" in str(exc.value.detail).lower()

    # And the action must have executed exactly once (no double side effect).
    assert db.query(Task).filter(Task.user_id == user.id).count() == 1


def test_httpexception_from_execution_is_not_rewrapped(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A legitimate HTTPException raised inside execution must propagate with its own
    # status code, not be caught by the generic handler and turned into a 502/500.
    proposal = propose_action_internal(
        db, user, action_type=ActionType.create_task, target={"title": "x"}
    )

    def raise_conflict(*_a: object, **_k: object) -> None:
        raise HTTPException(status_code=409, detail="conflict from execution")

    monkeypatch.setattr(execution, "execute_proposal", raise_conflict)
    with pytest.raises(HTTPException) as exc:
        actions_mod.approve_action(proposal.id, user=user, db=db)
    assert exc.value.status_code == 409
    assert exc.value.detail == "conflict from execution"


def test_genuine_execution_error_surfaces_as_502(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A real upstream failure (network/provider) is still surfaced as an audited 502,
    # so genuine errors are not silently swallowed.
    proposal = propose_action_internal(
        db, user, action_type=ActionType.create_task, target={"title": "x"}
    )

    def boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("gmail down")

    monkeypatch.setattr(execution, "execute_proposal", boom)
    with pytest.raises(HTTPException) as exc:
        actions_mod.approve_action(proposal.id, user=user, db=db)
    assert exc.value.status_code == 502
