from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OutboundReply(Base):
    """A reply Alfred sent on the user's behalf, tracked so we can nudge if the
    counterparty goes silent. Closes the loop on the USER'S commitments, not
    just other people's.

    Resolution happens when ingestion sees a new message on the same thread
    from someone other than the user; `resolved_at` is set and the row stops
    triggering follow-ups.
    """

    __tablename__ = "outbound_replies"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # The Message the user replied TO (so we can deep-link the user back).
    source_message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    # The Gmail thread we're watching for a response.
    thread_id: Mapped[str | None] = mapped_column(String(128), index=True)
    # The recipient(s) we sent to — kept here so the follow-up text reads naturally
    # without joining back to the source message.
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str | None] = mapped_column(Text)

    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # True once we've pushed the follow-up nudge, so dedup is cheap.
    follow_up_pushed: Mapped[bool] = mapped_column(Boolean, default=False)
