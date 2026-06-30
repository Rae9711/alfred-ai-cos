"""add user_habits

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-06-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_habits",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("activity", sa.Text(), nullable=False),
        sa.Column("activity_key", sa.String(length=256), nullable=False),
        sa.Column("typical_days", sa.JSON(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "activity_key", name="uq_user_habit_activity"),
    )
    op.create_index(op.f("ix_user_habits_activity_key"), "user_habits", ["activity_key"], unique=False)
    op.create_index(op.f("ix_user_habits_user_id"), "user_habits", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_habits_user_id"), table_name="user_habits")
    op.drop_index(op.f("ix_user_habits_activity_key"), table_name="user_habits")
    op.drop_table("user_habits")
