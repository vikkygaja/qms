"""Slice 2: tenant, users, roles, permissions, sessions, status history, audit log.

Every table except tenant has tenant_id plus forced row-level security.
audit_log is append-only (grants + trigger). See docs/data-model.md.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

APP_ROLE = "qms_app"
TENANT_TABLES = [
    "permission",
    "role",
    "role_permission",
    "app_user",
    "user_role",
    "user_session",
    "status_history",
    "audit_log",
]
UUID = pg.UUID(as_uuid=True)
NOW = sa.text("now()")
NEW_ID = sa.text("gen_random_uuid()")


def tenant_fk():
    return sa.Column("tenant_id", UUID, sa.ForeignKey("tenant.id"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "tenant",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="Active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )

    op.create_table(
        "permission",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        tenant_fk(),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.UniqueConstraint("tenant_id", "code"),
    )
    op.create_table(
        "role",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        tenant_fk(),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_system", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("tenant_id", "key"),
        sa.UniqueConstraint("tenant_id", "name"),
    )
    op.create_table(
        "role_permission",
        tenant_fk(),
        sa.Column("role_id", UUID, sa.ForeignKey("role.id"), primary_key=True),
        sa.Column("permission_id", UUID, sa.ForeignKey("permission.id"), primary_key=True),
    )
    op.create_table(
        "app_user",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        tenant_fk(),
        sa.Column("employee_id", sa.String(20), nullable=False),
        sa.Column("full_name", sa.String(100), nullable=False),
        sa.Column("designation", sa.String(100), nullable=False),
        sa.Column("mobile", sa.String(10), nullable=False),
        sa.Column("email", sa.String(200), nullable=False, server_default=""),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("must_change_password", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(10), nullable=False, server_default="Active"),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("tenant_id", "employee_id"),
        sa.CheckConstraint("status in ('Active','Inactive')", name="ck_app_user_status"),
    )
    op.create_table(
        "user_role",
        tenant_fk(),
        sa.Column("user_id", UUID, sa.ForeignKey("app_user.id"), primary_key=True),
        sa.Column("role_id", UUID, sa.ForeignKey("role.id"), primary_key=True),
    )
    op.create_table(
        "user_session",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        tenant_fk(),
        sa.Column("user_id", UUID, sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("ip", sa.String(64)),
        sa.Column("user_agent", sa.String(300)),
    )
    op.create_table(
        "status_history",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        tenant_fk(),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", UUID, nullable=False),
        sa.Column("old_status", sa.String(10), nullable=False),
        sa.Column("new_status", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("effective_date", sa.Date, nullable=False),
        sa.Column("changed_by", UUID),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        tenant_fk(),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("actor_user_id", UUID),
        sa.Column("entity", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("old_values", pg.JSONB),
        sa.Column("new_values", pg.JSONB),
        sa.Column("ip", sa.String(64)),
    )

    for t in TENANT_TABLES:
        op.create_index(f"ix_{t}_tenant_id", t, ["tenant_id"])
    op.create_index("ix_audit_log_tenant_at", "audit_log", ["tenant_id", sa.text("at DESC")])
    op.create_index("ix_audit_log_entity", "audit_log", ["entity", "entity_id"])
    op.create_index("ix_status_history_entity", "status_history", ["entity_type", "entity_id"])
    op.create_index("ix_user_session_user_id", "user_session", ["user_id"])

    # Row-level security: a row is visible/writable only for the tenant set on the connection.
    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t}"
            " USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
            " WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
        )

    # Append-only audit log: trigger (applies to everyone, even the owner) ...
    op.execute(
        "CREATE FUNCTION audit_log_block_change() RETURNS trigger LANGUAGE plpgsql AS $$"
        " BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$"
    )
    op.execute(
        "CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log"
        " FOR EACH ROW EXECUTE FUNCTION audit_log_block_change()"
    )

    # ... and grants for the non-superuser runtime role (skipped if the role does not exist yet).
    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            GRANT SELECT ON tenant TO {APP_ROLE};
            GRANT SELECT, INSERT, UPDATE, DELETE ON
              permission, role, role_permission, app_user, user_role, user_session,
              status_history TO {APP_ROLE};
            GRANT SELECT, INSERT ON audit_log TO {APP_ROLE};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_block_change()")
    for t in reversed(TENANT_TABLES):
        op.drop_table(t)
    op.drop_table("tenant")
