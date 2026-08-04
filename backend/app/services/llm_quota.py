"""Per-user monthly LLM spend quota (external-beta cost guardrail).

Caps are in USD cents so heavy Sonnet users and light Haiku users share one
break-even budget. Default ``LLM_MONTHLY_CAP_USD`` ≈ half of $17 ARPU after
Stripe so external testers cannot run Anthropic unbounded; raise toward ~15 for
a hard break-even ceiling.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models.llm_usage import LlmUsagePeriod

# Approximate Anthropic list prices (USD per million tokens) for metering.
# Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing
_MODEL_RATES_PER_MTOK: dict[str, tuple[float, float]] = {
    # (input $/MTok, output $/MTok)
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-sonnet-4-5": (3.0, 15.0),
    "claude-opus-4": (15.0, 75.0),
}
_DEFAULT_RATES = (3.0, 15.0)  # assume Sonnet-class if unknown

_llm_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "llm_quota_user_id", default=None
)
_llm_db: contextvars.ContextVar[Session | None] = contextvars.ContextVar(
    "llm_quota_db", default=None
)


class LlmQuotaExceeded(Exception):
    """Raised when the user has exhausted their monthly AI budget."""

    def __init__(self, *, used_minor: int, cap_minor: int) -> None:
        self.used_minor = used_minor
        self.cap_minor = cap_minor
        super().__init__(
            f"LLM monthly quota exceeded ({used_minor}/{cap_minor} cents)"
        )


def bind_llm_user(user_id: str | None) -> contextvars.Token[str | None]:
    """Bind the billing user for subsequent Anthropic calls in this context."""
    return _llm_user_id.set(user_id)


def reset_llm_user(token: contextvars.Token[str | None]) -> None:
    _llm_user_id.reset(token)


def bind_llm_db(db: Session | None) -> contextvars.Token[Session | None]:
    """Prefer the request/worker session so charges land in the same transaction."""
    return _llm_db.set(db)


def reset_llm_db(token: contextvars.Token[Session | None]) -> None:
    _llm_db.reset(token)


def current_llm_user_id() -> str | None:
    return _llm_user_id.get()


@contextmanager
def llm_user_scope(
    user_id: str | None, *, db: Session | None = None
) -> Iterator[None]:
    """Bind ``user_id`` (and optionally ``db``) for LLM metering for this block."""
    user_token = bind_llm_user(user_id)
    db_token = bind_llm_db(db) if db is not None else None
    try:
        yield
    finally:
        reset_llm_user(user_token)
        if db_token is not None:
            reset_llm_db(db_token)


def _resolve_db() -> tuple[Session, bool]:
    """Return (session, owned). Owned sessions must be committed and closed."""
    existing = _llm_db.get()
    if existing is not None:
        return existing, False
    from app.db.base import SessionLocal

    return SessionLocal(), True


def _period_ym(now: datetime | None = None) -> str:
    stamp = now or datetime.now(UTC)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def _rates_for(model: str) -> tuple[float, float]:
    if model in _MODEL_RATES_PER_MTOK:
        return _MODEL_RATES_PER_MTOK[model]
    for key, rates in _MODEL_RATES_PER_MTOK.items():
        if key in model or model in key:
            return rates
    return _DEFAULT_RATES


def estimate_cost_minor(
    *, model: str, input_tokens: int, output_tokens: int
) -> int:
    """USD cents for a call (rounded up to whole cents, min 0)."""
    in_rate, out_rate = _rates_for(model)
    dollars = (input_tokens / 1_000_000) * in_rate + (output_tokens / 1_000_000) * out_rate
    cents = int(dollars * 100 + 0.9999) if dollars > 0 else 0
    return max(0, cents)


def monthly_cap_minor() -> int:
    settings = get_settings()
    return max(0, int(round(settings.llm_monthly_cap_usd * 100)))


@dataclass(frozen=True)
class LlmQuotaStatus:
    period: str
    cap_minor: int
    used_minor: int
    remaining_minor: int
    input_tokens: int
    output_tokens: int
    capped: bool

    @property
    def cap_usd(self) -> float:
        return self.cap_minor / 100

    @property
    def used_usd(self) -> float:
        return self.used_minor / 100

    @property
    def remaining_usd(self) -> float:
        return self.remaining_minor / 100

    @property
    def used_pct(self) -> float:
        if self.cap_minor <= 0:
            return 100.0
        return min(100.0, round(100 * self.used_minor / self.cap_minor, 1))


def _get_or_create_period(
    db: Session, user_id: str, *, period: str, lock: bool = False
) -> LlmUsagePeriod:
    stmt = select(LlmUsagePeriod).where(
        LlmUsagePeriod.user_id == user_id, LlmUsagePeriod.period == period
    )
    if lock:
        stmt = stmt.with_for_update()
    row = db.scalars(stmt).first()
    if row is not None:
        return row
    row = LlmUsagePeriod(
        user_id=user_id,
        period=period,
        spend_minor=0,
        input_tokens=0,
        output_tokens=0,
    )
    db.add(row)
    db.flush()
    if lock:
        # Re-select locked after insert for consistency under concurrency.
        row = db.scalars(
            select(LlmUsagePeriod)
            .where(
                LlmUsagePeriod.user_id == user_id, LlmUsagePeriod.period == period
            )
            .with_for_update()
        ).one()
    return row


def get_quota_status(db: Session, user_id: str) -> LlmQuotaStatus:
    period = _period_ym()
    cap = monthly_cap_minor()
    row = db.scalars(
        select(LlmUsagePeriod).where(
            LlmUsagePeriod.user_id == user_id, LlmUsagePeriod.period == period
        )
    ).first()
    used = row.spend_minor if row else 0
    return LlmQuotaStatus(
        period=period,
        cap_minor=cap,
        used_minor=used,
        remaining_minor=max(0, cap - used),
        input_tokens=row.input_tokens if row else 0,
        output_tokens=row.output_tokens if row else 0,
        capped=cap > 0 and used >= cap,
    )


def assert_quota_available(db: Session, user_id: str) -> LlmQuotaStatus:
    status = get_quota_status(db, user_id)
    if status.cap_minor > 0 and status.used_minor >= status.cap_minor:
        raise LlmQuotaExceeded(used_minor=status.used_minor, cap_minor=status.cap_minor)
    return status


def record_usage_from_sdk(
    db: Session,
    user_id: str,
    *,
    model: str,
    usage: Any,
) -> LlmQuotaStatus:
    """Add one Anthropic ``usage`` object to the user's monthly period."""
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    return record_usage(
        db,
        user_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def record_usage(
    db: Session,
    user_id: str,
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> LlmQuotaStatus:
    period = _period_ym()
    cost = estimate_cost_minor(
        model=model, input_tokens=input_tokens, output_tokens=output_tokens
    )
    row = _get_or_create_period(db, user_id, period=period, lock=True)
    row.spend_minor = int(row.spend_minor or 0) + cost
    row.input_tokens = int(row.input_tokens or 0) + max(0, input_tokens)
    row.output_tokens = int(row.output_tokens or 0) + max(0, output_tokens)
    db.add(row)
    db.flush()
    cap = monthly_cap_minor()
    return LlmQuotaStatus(
        period=period,
        cap_minor=cap,
        used_minor=row.spend_minor,
        remaining_minor=max(0, cap - row.spend_minor),
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        capped=cap > 0 and row.spend_minor >= cap,
    )


def assert_bound_user_quota() -> None:
    """Pre-flight check. No-op if unbound or uncapped (cap USD = 0)."""
    user_id = current_llm_user_id()
    cap = monthly_cap_minor()
    if not user_id or cap <= 0:
        return
    db, owned = _resolve_db()
    try:
        assert_quota_available(db, user_id)
    finally:
        if owned:
            db.close()


def charge_bound_user_usage(*, model: str, usage: Any) -> None:
    """Debit the bound user's monthly period for one Anthropic ``usage`` object."""
    user_id = current_llm_user_id()
    if not user_id or usage is None:
        return
    db, owned = _resolve_db()
    try:
        record_usage_from_sdk(db, user_id, model=model, usage=usage)
        if owned:
            db.commit()
    finally:
        if owned:
            db.close()
