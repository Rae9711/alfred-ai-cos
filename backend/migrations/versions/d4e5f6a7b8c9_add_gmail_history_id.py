"""add ConnectedAccount.gmail_history_id for incremental Gmail sync

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-22 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "connected_accounts",
        sa.Column("gmail_history_id", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("connected_accounts", "gmail_history_id")
