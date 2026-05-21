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


def _spend_limit(db: Session, user_id: str) -> SpendLimit | None:
    return db.scalar(select(SpendLimit).where(SpendLimit.user_id == user_id))


def check_spend(db: Session, user_id: str, amount_minor: int) -> None:
    """Raise ExecutionBlocked if a financial action would exceed the user's cap.
    With no spend limit configured, financial actions are blocked by default (safe)."""
    limit = _spend_limit(db, user_id)
    if limit is None:
        raise ExecutionBlocked("No spend limit set; financial actions are blocked by default.")
    if limit.spent_minor + amount_minor > limit.cap_minor:
        remaining = max(limit.cap_minor - limit.spent_minor, 0)
        raise ExecutionBlocked(
            f"Spend limit exceeded: {amount_minor} requested, {remaining} remaining "
            f"of {limit.cap_minor} {limit.currency}."
        )


def _redact(payload: dict[str, Any]) -> dict[str, Any]:
    """Strip obviously sensitive content before writing the audit payload."""
    redacted = {}
    for k, v in payload.items():
        if k in {"body", "content", "card_number", "token", "message"}:
            redacted[k] = "[redacted]"
        else:
            redacted[k] = v
    return redacted


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
    writing an audit row. Caller is responsible for having recorded approval."""
    provider = get_capability(proposal.action_type)
    if provider is None:
        _audit(db, user_id=user.id, proposal=proposal, result="blocked", detail="no provider")
        db.commit()
        raise ExecutionBlocked(f"No capability registered for {proposal.action_type}")

    # Spend gate for financial actions.
    if proposal.risk_level >= RiskLevel.financial_legal:
        amount = int(proposal.target.get("amount_minor") or 0)
        try:
            check_spend(db, user.id, amount)
        except ExecutionBlocked as blocked:
            _audit(db, user_id=user.id, proposal=proposal, result="blocked", detail=str(blocked))
            db.commit()
            raise

    try:
        provider.validate(db, user, proposal.target)
        result = provider.execute(db, user, proposal.target)
    except CapabilityError as exc:
        proposal.status = ActionStatus.failed
        _audit(db, user_id=user.id, proposal=proposal, result="error", detail=str(exc))
        db.commit()
        raise ExecutionBlocked(str(exc)) from exc

    # On success, debit the spend limit for financial actions.
    if result.amount_minor and proposal.risk_level >= RiskLevel.financial_legal:
        limit = _spend_limit(db, user.id)
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
