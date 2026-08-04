"""Per-user monthly LLM spend tracking (USD cents)."""

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LlmUsagePeriod(Base):
    """One calendar-month AI budget row per user.

    ``spend_minor`` is estimated USD cents from published Anthropic token rates
    (not a Stripe invoice). Resets by creating a new ``period`` key (YYYY-MM).
    """

    __tablename__ = "llm_usage_periods"
    __table_args__ = (
        UniqueConstraint("user_id", "period", name="uq_llm_usage_user_period"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    spend_minor: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
