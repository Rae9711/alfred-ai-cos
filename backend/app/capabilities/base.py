"""Capability framework (PRD 12.10, 14.1 agents 8-9, 17).

A CapabilityProvider is one thing Albert can do in the outside world: push a Gmail
draft, send a message, make a payment. Each declares its risk level and action type,
validates its payload, and executes. The execution service (app/services/execution.py)
wraps every provider with the safety system: approval-by-risk, spend limits, and an
audit row on every attempt. Providers never bypass that wrapper.

To add a capability: implement this Protocol in app/capabilities/providers/, register
it in app/capabilities/__init__.py. Real external SDK code stays inside the provider."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from sqlalchemy.orm import Session

from app.db.enums import ActionType, RiskLevel
from app.db.models import User


@dataclass
class ExecutionResult:
    """What a provider returns after acting. `detail` is shown to the user; `reversible`
    feeds the approval card and audit log; `amount_minor`/`currency` record spend."""

    detail: str
    reversible: bool = False
    amount_minor: int | None = None
    currency: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class CapabilityDescription:
    """Static metadata about a capability, used to build the approval card (PRD 17.3)."""

    action_type: ActionType
    risk_level: RiskLevel
    title: str
    summary: str


class CapabilityError(Exception):
    """Raised by a provider when validation or execution fails with a user-facing reason."""


@runtime_checkable
class CapabilityProvider(Protocol):
    def describe(self) -> CapabilityDescription:
        """Static metadata: action type, risk level, human-readable title/summary."""
        ...

    def validate(self, db: Session, user: User, payload: dict[str, Any]) -> None:
        """Raise CapabilityError if the payload is invalid or the action cannot proceed."""
        ...

    def execute(self, db: Session, user: User, payload: dict[str, Any]) -> ExecutionResult:
        """Perform the action. Only called after approval (for level >= 3) and spend checks."""
        ...
