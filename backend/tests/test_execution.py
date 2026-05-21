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


def test_refused_capability_blocks_with_reason(db: Session, user: User) -> None:
    # browser_action is registered but refused: it raises a sourced CapabilityError,
    # which the execution service turns into a clean error + audit row (not a 500).
    proposal = _proposal(
        user.id, action_type=ActionType.browser_action, risk_level=RiskLevel.external_comm.value
    )
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked, match="refused"):
        execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.failed
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "error"


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


# --- hardening: audit on every path, no zombie state, authoritative amount ---


def test_unexpected_exception_audits_and_fails(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A non-CapabilityError (e.g. a network error) must still write an audit row and
    # flip the proposal to failed, never leave it stuck in approved (SERIOUS-2, SERIOUS-1).
    from app.capabilities.providers.create_task import CreateTaskCapability

    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("network down")

    monkeypatch.setattr(CreateTaskCapability, "execute", boom)
    proposal = _proposal(user.id)
    db.add(proposal)
    db.commit()
    with pytest.raises(RuntimeError, match="network down"):
        execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.failed
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "error"
    assert "RuntimeError" in (audit.detail or "")


def test_blocked_action_is_not_left_approved(db: Session, user: User) -> None:
    # A block (here: no provider for make_payment) must flip the proposal to failed,
    # not leave a zombie 'approved'. (SERIOUS-1)
    proposal = _proposal(
        user.id,
        action_type=ActionType.make_payment,
        risk_level=RiskLevel.financial_legal.value,
        target={"amount_minor": 5000},
        status=ActionStatus.approved,
    )
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked):
        execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.failed


def test_spend_block_flips_to_failed_and_audits(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Register a fake financial provider so the spend gate (after provider lookup) is
    # reached, then confirm an over-cap charge is blocked, failed, and audited.
    from app.capabilities.base import CapabilityDescription, ExecutionResult
    from app.db.enums import ActionType as AT

    class _FakePay:
        def describe(self) -> CapabilityDescription:
            return CapabilityDescription(
                action_type=AT.make_payment,
                risk_level=RiskLevel.financial_legal,
                title="fake pay",
                summary="",
            )

        def validate(self, db: Session, user: User, payload: dict) -> None:  # noqa: ARG002
            return None

        def execute(self, db: Session, user: User, payload: dict) -> ExecutionResult:  # noqa: ARG002
            return ExecutionResult(detail="charged", amount_minor=5000, currency="EUR")

    monkeypatch.setattr(execution, "get_capability", lambda at: _FakePay())

    db.add(SpendLimit(user_id=user.id, cap_minor=1000, spent_minor=0))
    proposal = _proposal(
        user.id,
        action_type=ActionType.make_payment,
        risk_level=RiskLevel.financial_legal.value,
        target={"amount_minor": 5000},
    )
    db.add(proposal)
    db.commit()
    with pytest.raises(execution.ExecutionBlocked, match="Spend limit"):
        execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.failed
    audit = db.query(AuditLog).filter(AuditLog.user_id == user.id).one()
    assert audit.result == "blocked"


def test_spend_debited_on_success(db: Session, user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.capabilities.base import CapabilityDescription, ExecutionResult
    from app.db.enums import ActionType as AT

    class _FakePay:
        def describe(self) -> CapabilityDescription:
            return CapabilityDescription(
                action_type=AT.make_payment,
                risk_level=RiskLevel.financial_legal,
                title="fake pay",
                summary="",
            )

        def validate(self, db: Session, user: User, payload: dict) -> None:  # noqa: ARG002
            return None

        def execute(self, db: Session, user: User, payload: dict) -> ExecutionResult:  # noqa: ARG002
            return ExecutionResult(detail="charged", amount_minor=300, currency="EUR")

    monkeypatch.setattr(execution, "get_capability", lambda at: _FakePay())

    limit = SpendLimit(user_id=user.id, cap_minor=1000, spent_minor=100)
    db.add(limit)
    proposal = _proposal(
        user.id,
        action_type=ActionType.make_payment,
        risk_level=RiskLevel.financial_legal.value,
        target={"amount_minor": 300},
    )
    db.add(proposal)
    db.commit()
    execution.execute_proposal(db, user, proposal)
    assert proposal.status == ActionStatus.executed
    assert limit.spent_minor == 400  # 100 + 300 debited


def test_proposal_amount_ignores_bool_and_non_int() -> None:
    # bool is an int subclass; a True must not read as amount 1 (BLOCKER-2 hardening).
    assert execution._proposal_amount(_proposal("u", target={"amount_minor": True})) == 0
    assert execution._proposal_amount(_proposal("u", target={"amount_minor": "50"})) == 0
    assert execution._proposal_amount(_proposal("u", target={"amount_minor": 250})) == 250


def test_redact_recurses_and_covers_recipient_fields() -> None:
    redacted = execution._redact(
        {"to": "15551234567", "payment_method": "pm_x", "nested": {"body": "secret"}, "ok": "v"}
    )
    assert redacted["to"] == "[redacted]"
    assert redacted["payment_method"] == "[redacted]"
    assert redacted["nested"]["body"] == "[redacted]"
    assert redacted["ok"] == "v"
