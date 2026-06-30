from datetime import time

from sqlalchemy import Float, ForeignKey, JSON, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserHabit(Base):
    """Detected recurring calendar block (rules-based v1)."""

    __tablename__ = "user_habits"
    __table_args__ = (
        UniqueConstraint("user_id", "activity_key", name="uq_user_habit_activity"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity: Mapped[str] = mapped_column(Text)
    activity_key: Mapped[str] = mapped_column(String(256), index=True)
    typical_days: Mapped[list[int]] = mapped_column(JSON, default=list)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
