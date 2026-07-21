"""add conversation source type support and task.evidence

Revision ID: a2b3c4d5e6f7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("evidence", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "evidence")
