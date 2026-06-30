"""add schedule_proposals

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "schedule_proposals",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("source_message_id", sa.String(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("participants", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("calendar_event_id", sa.String(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["calendar_event_id"], ["calendar_events.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_schedule_proposals_source_message_id"),
        "schedule_proposals",
        ["source_message_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_schedule_proposals_start_time"),
        "schedule_proposals",
        ["start_time"],
        unique=False,
    )
    op.create_index(
        op.f("ix_schedule_proposals_status"),
        "schedule_proposals",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_schedule_proposals_user_id"), "schedule_proposals", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_schedule_proposals_user_id"), table_name="schedule_proposals")
    op.drop_index(op.f("ix_schedule_proposals_status"), table_name="schedule_proposals")
    op.drop_index(op.f("ix_schedule_proposals_start_time"), table_name="schedule_proposals")
    op.drop_index(
        op.f("ix_schedule_proposals_source_message_id"), table_name="schedule_proposals"
    )
    op.drop_table("schedule_proposals")
