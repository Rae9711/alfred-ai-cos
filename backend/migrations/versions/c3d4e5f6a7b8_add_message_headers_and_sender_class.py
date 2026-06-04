"""add Message.headers (JSON) and Message.sender_classification

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-04 19:00:00.000000

Stores the spam-relevant subset of RFC822 headers (List-Unsubscribe,
Precedence, Auto-Submitted, Reply-To, CC, BCC, X-Mailer, etc.) so the
ranker can deterministically detect bulk/automated mail without re-fetching
Gmail. Also stores the precomputed sender classification so per-message
scoring stays O(1).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("headers", sa.JSON(), nullable=True))
    op.add_column(
        "messages",
        sa.Column("sender_classification", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "sender_classification")
    op.drop_column("messages", "headers")
