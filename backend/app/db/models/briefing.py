from datetime import date as date_type
from typing import Any

from sqlalchemy import JSON, Date, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DailyBriefing(Base):
    """A generated morning briefing (PRD 12.7, 15.1). One per user per day.

    The summary is the LLM-written prose. snapshot holds the structured Today
    payload it was generated from, so the briefing is explainable after the fact.
    user_feedback records whether the user found it useful (trust metric, PRD 20.1).
    """

    __tablename__ = "daily_briefings"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_briefing_user_date"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    date: Mapped[date_type] = mapped_column(Date, index=True)

    summary: Mapped[str] = mapped_column(Text)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # "useful" | "not_useful" | None
    user_feedback: Mapped[str | None] = mapped_column(String(16))
