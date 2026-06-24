"""multi-mailbox: Message.connected_account_id + per-mailbox uniqueness

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-24 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("connected_account_id", sa.String(), nullable=True))
    op.create_index(
        op.f("ix_messages_connected_account_id"),
        "messages",
        ["connected_account_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_messages_connected_account_id",
        "messages",
        "connected_accounts",
        ["connected_account_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Attach existing rows to the user's first Google connected account.
    op.execute(
        """
        UPDATE messages
        SET connected_account_id = (
            SELECT ca.id FROM connected_accounts ca
            WHERE ca.user_id = messages.user_id
              AND ca.provider = 'google'
            ORDER BY ca.created_at ASC
            LIMIT 1
        )
        WHERE connected_account_id IS NULL
        """
    )

    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint("uq_message_user_external", type_="unique")
        batch_op.create_unique_constraint(
            "uq_message_account_external", ["connected_account_id", "external_id"]
        )

    with op.batch_alter_table("connected_accounts") as batch_op:
        batch_op.create_unique_constraint(
            "uq_connected_account_mailbox",
            ["user_id", "provider", "provider_account_email"],
        )


def downgrade() -> None:
    with op.batch_alter_table("connected_accounts") as batch_op:
        batch_op.drop_constraint("uq_connected_account_mailbox", type_="unique")

    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint("uq_message_account_external", type_="unique")
        batch_op.create_unique_constraint(
            "uq_message_user_external", ["user_id", "external_id"]
        )

    op.drop_constraint("fk_messages_connected_account_id", "messages", type_="foreignkey")
    op.drop_index(op.f("ix_messages_connected_account_id"), table_name="messages")
    op.drop_column("messages", "connected_account_id")
