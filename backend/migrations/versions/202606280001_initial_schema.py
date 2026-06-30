"""initial schema

Revision ID: 202606280001
Revises: 
Create Date: 2026-06-28 00:01:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202606280001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=True, unique=True),
        sa.Column("phone", sa.String(length=20), nullable=True, unique=True),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("whatsapp_phone_id", sa.String(length=100), nullable=True),
        sa.Column("whatsapp_waba_id", sa.String(length=100), nullable=True),
        sa.Column("whatsapp_token", sa.Text(), nullable=True),
        sa.Column("whatsapp_cloud_connected", sa.Boolean(), nullable=True),
    )

    op.create_table(
        "otps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "contact_lists",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("total_contacts", sa.Integer(), nullable=True),
        sa.Column("valid_contacts", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("list_id", sa.Integer(), sa.ForeignKey("contact_lists.id"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("is_valid", sa.Boolean(), nullable=True),
        sa.Column("validation_error", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "broadcast_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("contact_list_id", sa.Integer(), sa.ForeignKey("contact_lists.id"), nullable=True),
        sa.Column("list_name", sa.String(length=200), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("total", sa.Integer(), nullable=True),
        sa.Column("sent", sa.Integer(), nullable=True),
        sa.Column("failed", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "broadcast_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("broadcast_jobs.id"), nullable=False),
        sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=True),
        sa.Column("contact_phone", sa.String(length=20), nullable=False),
        sa.Column("contact_name", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("twilio_sid", sa.String(length=50), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table("broadcast_logs")
    op.drop_table("broadcast_jobs")
    op.drop_table("contacts")
    op.drop_table("contact_lists")
    op.drop_table("otps")
    op.drop_table("users")