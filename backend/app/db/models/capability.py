from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.enums import ActionType


class SpendLimit(Base):
    """A per-user spending cap for financial actions (PRD 17.2, 26 risk 6).

    Simple per-period cap, not a ledger: enough to gate test-mode payments and make
    the limit visible. `spent_minor` and `cap_minor` are in the currency's minor unit
    (cents) to avoid float drift. `period` is informational ("monthly"); resets are a
    later refinement."""

    __tablename__ = "spend_limits"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    period: Mapped[str] = mapped_column(String(16), default="monthly")
    cap_minor: Mapped[int] = mapped_column(default=0)
    spent_minor: Mapped[int] = mapped_column(default=0)


class AuditLog(Base):
    """Append-only audit record for every capability execution attempt (PRD 12.10,
    13.2, 17). Generalizes ExecutionLog across all capability providers, with the
    payload redacted of sensitive content before storage."""

    __tablename__ = "audit_logs"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action_proposal_id: Mapped[str | None] = mapped_column(String(64), index=True)
    action_type: Mapped[ActionType] = mapped_column(String(32))
    risk_level: Mapped[int] = mapped_column(default=0)

    result: Mapped[str] = mapped_column(String(16))  # success | error | blocked
    detail: Mapped[str | None] = mapped_column(Text)
    payload_redacted: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    amount_minor: Mapped[int | None] = mapped_column()
    currency: Mapped[str | None] = mapped_column(String(3))
    reversible: Mapped[bool] = mapped_column(Boolean, default=False)

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Free-form numeric annotation slot (e.g. provider confidence). Float to match
    # other models; nullable since most actions do not carry one.
    score: Mapped[float | None] = mapped_column(Float)
