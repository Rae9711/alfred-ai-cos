"""Execution service: risk policy, spend limits, audit, and end-to-end execution."""

import pytest
from sqlalchemy.orm import Session

from app.db.enums import ActionStatus, ActionType, RiskLevel
from app.db.models import ActionProposal, AuditLog, SpendLimit, Task, User
from app.services import execution


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="exec@example.com")
    db.add(u)
    db.commit()
    return u


# --- approval policy (pure) ---


def test_low_risk_needs_no_approval() -> None:
    assert execution.approval_policy(RiskLevel.internal_prep).approval_required is False


def test_external_comm_needs_approval_not_strong() -> None:
    p = execution.approval_policy(RiskLevel.external_comm)
    assert p.approval_required is True
    assert p.strong_confirmation is False


def test_financial_needs_strong_confirmation() -> None:
    p = execution.approval_policy(RiskLevel.financial_legal)
    assert p.approval_required is True
    assert p.strong_confirmation is True
    assert execution.requires_strong_confirmation(RiskLevel.financial_legal) is True
    assert execution.requires_strong_confirmation(RiskLevel.external_comm) is False


# --- spend limits ---


def test_spend_blocked_without_limit(db: Session, user: User) -> None:
    with pytest.raises(execution.ExecutionBlocked, match="No spend limit"):
        execution.check_spend(db, user.id, 1000)


def test_spend_within_cap_ok(db: Session, user: User) -> None:
    db.add(SpendLimit(user_id=user.id, cap_minor=5000, spent_minor=1000))
    db.commit()
    execution.check_spend(db, user.id, 3000)  # 1000 + 3000 <= 5000, no raise


def test_spend_over_cap_blocked(db: Session, user: User) -> None:
    db.add(SpendLimit(user_id=user.id, cap_minor=5000, spent_minor=4000))
    db.commit()
    with pytest.raises(execution.ExecutionBlocked, match="Spend limit exceeded"):
        execution.check_spend(db, user.id, 2000)


# --- end to end: create_task capability through the safety system ---


def _proposal(user_id: str, **kwargs: object) -> ActionProposal:
    defaults: dict[str, object] = {
        "user_id": user_id,
        "action_type": ActionType.create_task,
        "risk_level": RiskLevel.reversible_write.value,
        "target": {"title": "Follow up with Dana"},
        "status": ActionStatus.approved,
    }
    defaults.update(kwargs)
    return ActionProposal(**defaults)


def test_execute_create_task_writes_task_and_audit(db: Session, user: User) -> None:
    proposal = _proposal(user.id)
    db.add(proposal)
    db.commit()

    result = execution.execute_proposal(db, user, proposal)
    assert "Follow up with Dana" in result.detail
    assert proposal.status == ActionStatus.executed
    assert db.query(Task).filter(Task.user_id == user.id).count() == 1
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "success"
    assert audit.action_type == ActionType.create_task


def test_validation_failure_audits_error(db: Session, user: User) -> None:
    proposal = _proposal(user.id, target={})  # missing title
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked):
        execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.failed
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "error"


def test_no_provider_blocks_and_audits(db: Session, user: User) -> None:
    # browser_action is not registered (refused), so execution is blocked.
    proposal = _proposal(
        user.id, action_type=ActionType.browser_action, risk_level=RiskLevel.external_comm.value
    )
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked, match="No capability"):
        execution.execute_proposal(db, user, proposal)
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "blocked"


def test_financial_action_without_provider_is_blocked(db: Session, user: User) -> None:
    # make_payment has no provider until B3 registers Stripe, so it blocks here.
    # The spend gate is verified directly in test_spend_* above; B3 exercises the
    # provider + spend ordering end to end.
    proposal = _proposal(
        user.id,
        action_type=ActionType.make_payment,
        risk_level=RiskLevel.financial_legal.value,
        target={"amount_minor": 5000},
    )
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked):
        execution.execute_proposal(db, user, proposal)
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "blocked"
