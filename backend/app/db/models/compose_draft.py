from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ComposeDraft(Base):
    """An AI-drafted new outbound email (not a thread reply), awaiting user review."""

    __tablename__ = "compose_drafts"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connected_account_id: Mapped[str] = mapped_column(
        ForeignKey("connected_accounts.id", ondelete="CASCADE"), index=True
    )

    recipient_email: Mapped[str] = mapped_column(String(320))
    recipient_name: Mapped[str | None] = mapped_column(String(256))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    tone: Mapped[str] = mapped_column(String(32), default="concise")

    gmail_draft_id: Mapped[str | None] = mapped_column(String(128))
