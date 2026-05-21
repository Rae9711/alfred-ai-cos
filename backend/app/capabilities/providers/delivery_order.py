"""Refused capability: food-delivery ordering (Deliveroo / Uber Eats). Registered so
the boundary is explicit, but raises with a sourced reason rather than faking an order.
See docs/integrations/REFUSED.md."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.capabilities.base import (
    CapabilityDescription,
    CapabilityError,
    ExecutionResult,
)
from app.db.enums import ActionType, RiskLevel
from app.db.models import User

_REASON = (
    "Food-delivery ordering is refused: there is no public partner ordering API for "
    "Deliveroo or Uber Eats. This is a Phase 4 business-development integration, not "
    "engineering. A real provider can implement the same Protocol once a partnership "
    "exists. See docs/integrations/REFUSED.md."
)


class DeliveryOrderCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.place_order,
            risk_level=RiskLevel.financial_legal,
            title="Place a delivery order (refused)",
            summary=_REASON,
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:  # noqa: ARG002
        # CapabilityError so the execution service records a clean blocked/error audit
        # row and returns a clear message, rather than a 500 from an unhandled raise.
        raise CapabilityError(_REASON)

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:  # noqa: ARG002
        raise CapabilityError(_REASON)
