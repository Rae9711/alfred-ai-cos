"""add compose_drafts for Ask outbound email

Revision ID: f7a8b9c0d1e2
Revises: e1f2a3b4c5d6
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "compose_drafts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("connected_account_id", sa.String(), nullable=False),
        sa.Column("recipient_email", sa.String(length=320), nullable=False),
        sa.Column("recipient_name", sa.String(length=256), nullable=True),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tone", sa.String(length=32), nullable=False),
        sa.Column("gmail_draft_id", sa.String(length=128), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["connected_account_id"], ["connected_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_compose_drafts_user_id", "compose_drafts", ["user_id"])
    op.create_index(
        "ix_compose_drafts_connected_account_id",
        "compose_drafts",
        ["connected_account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_compose_drafts_connected_account_id", table_name="compose_drafts")
    op.drop_index("ix_compose_drafts_user_id", table_name="compose_drafts")
    op.drop_table("compose_drafts")
