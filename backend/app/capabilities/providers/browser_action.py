"""Refused capability: browser automation. Registered so the boundary is explicit,
but raises with a sourced reason rather than faking success. See docs/integrations/
REFUSED.md."""

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
    "Browser automation is refused: it requires proxying the user's credentials to "
    "third-party sites, which breaks Albert's OAuth-only, no-raw-credentials trust model "
    "(SECURITY.md, PRD risk 5). See docs/integrations/REFUSED.md."
)


class BrowserActionCapability:
    def describe(self) -> CapabilityDescription:
        return CapabilityDescription(
            action_type=ActionType.browser_action,
            risk_level=RiskLevel.external_comm,
            title="Browser action (refused)",
            summary=_REASON,
        )

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:  # noqa: ARG002
        # CapabilityError so the execution service records a clean blocked/error audit
        # row and returns a clear message, rather than a 500 from an unhandled raise.
        raise CapabilityError(_REASON)

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:  # noqa: ARG002
        raise CapabilityError(_REASON)
