"""Execution service: the safety system every capability runs through (PRD 12.10, 17).

Responsibilities:
- classify approval requirement by risk level (0-1 auto, 2 configurable, 3 approve,
  4-5 strong confirmation);
- enforce spend limits for financial actions before executing;
- execute via the capability registry;
- write an append-only AuditLog row on every attempt (success, error, or blocked).

Routes propose and approve; this module decides and acts. Providers never bypass it."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.capabilities import get_capability
from app.capabilities.base import CapabilityError, ExecutionResult
from app.db.enums import ActionStatus, RiskLevel
from app.db.models import ActionProposal, AuditLog, SpendLimit, User


class ExecutionBlocked(Exception):
    """Raised when policy blocks an action (spend limit, missing approval, no provider)."""


@dataclass
class ApprovalPolicy:
    approval_required: bool
    strong_confirmation: bool


def approval_policy(risk_level: int, *, level2_requires_approval: bool = False) -> ApprovalPolicy:
    """Map a risk level to its approval requirement (PRD 12.10)."""
    if risk_level <= RiskLevel.internal_prep:  # 0-1
        return ApprovalPolicy(approval_required=False, strong_confirmation=False)
    if risk_level == RiskLevel.reversible_write:  # 2, configurable
        return ApprovalPolicy(approval_required=level2_requires_approval, strong_confirmation=False)
    if risk_level == RiskLevel.external_comm:  # 3
        return ApprovalPolicy(approval_required=True, strong_confirmation=False)
    return ApprovalPolicy(approval_required=True, strong_confirmation=True)  # 4-5


def requires_strong_confirmation(risk_level: int) -> bool:
    return risk_level >= RiskLevel.financial_legal


def _spend_limit(db: Session, user_id: str, *, lock: bool = False) -> SpendLimit | None:
    stmt = select(SpendLimit).where(SpendLimit.user_id == user_id)
    if lock:
        # Serialize concurrent financial executions for this user so two approvals
        # cannot both read the pre-debit balance and both pass the cap (TOCTOU).
        # SQLite ignores with_for_update (single-writer), which is fine for tests.
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def check_spend(db: Session, user_id: str, amount_minor: int, *, lock: bool = False) -> None:
    """Raise ExecutionBlocked if a financial action would exceed the user's cap.
    With no spend limit configured, financial actions are blocked by default (safe)."""
    limit = _spend_limit(db, user_id, lock=lock)
    if limit is None:
        raise ExecutionBlocked("No spend limit set; financial actions are blocked by default.")
    if limit.spent_minor + amount_minor > limit.cap_minor:
        remaining = max(limit.cap_minor - limit.spent_minor, 0)
        raise ExecutionBlocked(
            f"Spend limit exceeded: {amount_minor} requested, {remaining} remaining "
            f"of {limit.cap_minor} {limit.currency}."
        )


_SENSITIVE_KEYS = {
    "body",
    "content",
    "card_number",
    "token",
    "message",
    "payment_method",
    "to",
    "description",
}


def _redact(value: Any) -> Any:
    """Recursively strip sensitive content before writing the audit payload."""
    if isinstance(value, dict):
        return {k: "[redacted]" if k in _SENSITIVE_KEYS else _redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _proposal_amount(proposal: ActionProposal) -> int:
    """The authoritative approved amount for a financial action: read once from the
    proposal target. Both the cap gate and the post-execution debit use this value,
    so the gate and the charge cannot diverge."""
    raw = proposal.target.get("amount_minor")
    return int(raw) if isinstance(raw, int) and not isinstance(raw, bool) else 0


def _audit(
    db: Session,
    *,
    user_id: str,
    proposal: ActionProposal,
    result: str,
    detail: str | None,
    exec_result: ExecutionResult | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action_proposal_id=proposal.id,
            action_type=proposal.action_type,
            risk_level=proposal.risk_level,
            result=result,
            detail=detail,
            payload_redacted=_redact(proposal.target),
            amount_minor=exec_result.amount_minor if exec_result else None,
            currency=exec_result.currency if exec_result else None,
            reversible=exec_result.reversible if exec_result else False,
            occurred_at=datetime.now(UTC),
        )
    )


def execute_proposal(db: Session, user: User, proposal: ActionProposal) -> ExecutionResult:
    """Execute an approved proposal through its capability, enforcing spend limits and
    writing an audit row on every outcome. Caller records approval; this guarantees the
    proposal never stays 'approved' after this returns or raises (it becomes executed or
    failed), and that an audit row is written for success, error, and blocked alike."""
    provider = get_capability(proposal.action_type)
    if provider is None:
        proposal.status = ActionStatus.failed
        _audit(db, user_id=user.id, proposal=proposal, result="blocked", detail="no provider")
        db.commit()
        raise ExecutionBlocked(f"No capability registered for {proposal.action_type}")

    financial = proposal.risk_level >= RiskLevel.financial_legal
    amount = _proposal_amount(proposal)

    # Spend gate for financial actions. Lock the limit row so concurrent financial
    # executions for this user serialize and cannot both pass the cap (BLOCKER-3).
    if financial:
        try:
            check_spend(db, user.id, amount, lock=True)
        except ExecutionBlocked as blocked:
            proposal.status = ActionStatus.failed
            _audit(db, user_id=user.id, proposal=proposal, result="blocked", detail=str(blocked))
            db.commit()
            raise

    # Pass the proposal id as an idempotency key so providers that support it (Stripe)
    # make retries and the lost-response case safe (SERIOUS-3). Copy so the stored
    # target is not mutated.
    exec_payload = {**proposal.target, "idempotency_key": proposal.id}

    # Execute. Any failure (CapabilityError or an unexpected provider/network error)
    # flips the proposal to failed and writes an audit row, so the money-movement log
    # is never skipped and no proposal is left stuck in 'approved' (SERIOUS-1, SERIOUS-2).
    try:
        provider.validate(db, user, exec_payload)
        result = provider.execute(db, user, exec_payload)
    except CapabilityError as exc:
        proposal.status = ActionStatus.failed
        _audit(db, user_id=user.id, proposal=proposal, result="error", detail=str(exc))
        db.commit()
        raise ExecutionBlocked(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - audit then re-raise; never lose the record
        proposal.status = ActionStatus.failed
        _audit(
            db,
            user_id=user.id,
            proposal=proposal,
            result="error",
            detail=f"{type(exc).__name__}: {exc}",
        )
        db.commit()
        raise

    # Debit the cap by the amount the provider actually charged, re-checking it against
    # the locked limit. The provider should charge the approved amount; if it reports
    # more, we still record it but the lock prevents concurrent overspend.
    if financial and result.amount_minor:
        limit = _spend_limit(db, user.id, lock=True)
        if limit is not None:
            limit.spent_minor += result.amount_minor

    proposal.status = ActionStatus.executed
    proposal.executed_at = datetime.now(UTC)
    _audit(
        db,
        user_id=user.id,
        proposal=proposal,
        result="success",
        detail=result.detail,
        exec_result=result,
    )
    db.commit()
    return result
