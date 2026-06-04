"""add smart snooze (snooze_until, snooze_until_reply) to commitments

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-04 17:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("commitments", sa.Column("snooze_until", sa.Date(), nullable=True))
    op.add_column(
        "commitments",
        sa.Column(
            "snooze_until_reply",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("commitments", "snooze_until_reply", server_default=None)


def downgrade() -> None:
    op.drop_column("commitments", "snooze_until_reply")
    op.drop_column("commitments", "snooze_until")
