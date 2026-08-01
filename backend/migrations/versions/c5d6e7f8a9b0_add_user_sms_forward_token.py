"""add users.sms_forward_token for indexed SMS webhook auth

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-08-01 15:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d6e7f8a9b0"
down_revision: str | None = "b4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("sms_forward_token", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_users_sms_forward_token",
        "users",
        ["sms_forward_token"],
        unique=True,
    )
    # Promote existing tokens out of preferences JSON so webhooks stop scanning.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, preferences FROM users")).mappings().all()
    for row in rows:
        prefs = row["preferences"] or {}
        if isinstance(prefs, str):
            import json

            try:
                prefs = json.loads(prefs)
            except json.JSONDecodeError:
                continue
        if not isinstance(prefs, dict):
            continue
        token = prefs.get("sms_forward_token")
        if isinstance(token, str) and len(token) >= 16:
            conn.execute(
                sa.text(
                    "UPDATE users SET sms_forward_token = :token WHERE id = :id"
                ),
                {"token": token, "id": row["id"]},
            )


def downgrade() -> None:
    op.drop_index("ix_users_sms_forward_token", table_name="users")
    op.drop_column("users", "sms_forward_token")
