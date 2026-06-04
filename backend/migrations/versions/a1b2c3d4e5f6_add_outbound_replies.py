"""add outbound_replies for reply-tracking + outbound silence nudges

Revision ID: a1b2c3d4e5f6
Revises: ceed65a3499b
Create Date: 2026-06-04 17:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "ceed65a3499b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "outbound_replies",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_message_id",
            sa.String(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("thread_id", sa.String(length=128), nullable=True),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "follow_up_pushed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_outbound_replies_user_id", "outbound_replies", ["user_id"])
    op.create_index(
        "ix_outbound_replies_source_message_id",
        "outbound_replies",
        ["source_message_id"],
    )
    op.create_index("ix_outbound_replies_thread_id", "outbound_replies", ["thread_id"])


def downgrade() -> None:
    op.drop_index("ix_outbound_replies_thread_id", table_name="outbound_replies")
    op.drop_index("ix_outbound_replies_source_message_id", table_name="outbound_replies")
    op.drop_index("ix_outbound_replies_user_id", table_name="outbound_replies")
    op.drop_table("outbound_replies")
