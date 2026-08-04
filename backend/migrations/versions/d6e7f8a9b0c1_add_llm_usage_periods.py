"""add llm_usage_periods for monthly AI spend caps

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-04 14:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6e7f8a9b0c1"
down_revision: str | None = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_usage_periods",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("spend_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "period", name="uq_llm_usage_user_period"),
    )
    op.create_index(
        "ix_llm_usage_periods_user_id", "llm_usage_periods", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_llm_usage_periods_user_id", table_name="llm_usage_periods")
    op.drop_table("llm_usage_periods")
