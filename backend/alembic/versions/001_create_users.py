"""create users table

Revision ID: 001
Revises:
Create Date: 2026-03-31

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="employee"),
        sa.Column("user_type", sa.String(), nullable=False, server_default="human"),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("api_token", sa.String(), nullable=True),
    )

    # Unique indexes (also enforce uniqueness constraints)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_api_token", "users", ["api_token"], unique=True)

    # Non-unique index for FK lookups
    op.create_index("ix_users_parent_id", "users", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_users_parent_id", table_name="users")
    op.drop_index("ix_users_api_token", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
