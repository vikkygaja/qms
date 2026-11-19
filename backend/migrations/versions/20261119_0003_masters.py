"""Slice 3: departments, wards, staff categories, settings.

Same conventions as 0002: tenant_id on every table, forced row-level security, explicit grants
to the non-superuser runtime role. Names are unique per tenant, case-insensitively.
See docs/data-model.md.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

APP_ROLE = "qms_app"
TABLES = ["department", "ward", "staff_category", "setting"]
UUID = pg.UUID(as_uuid=True)
NOW = sa.text("now()")
NEW_ID = sa.text("gen_random_uuid()")


def _tenant():
    return sa.Column("tenant_id", UUID, sa.ForeignKey("tenant.id"), nullable=False)


def _stamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    ]


def _status():
    return sa.Column("status", sa.String(10), nullable=False, server_default="Active")


def upgrade() -> None:
    op.create_table(
        "department",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        _tenant(),
        sa.Column("name", sa.String(100), nullable=False),
        _status(),
        *_stamps(),
        sa.CheckConstraint("status in ('Active','Inactive')", name="ck_department_status"),
    )
    op.create_table(
        "ward",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        _tenant(),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("department_id", UUID, sa.ForeignKey("department.id"), nullable=False),
        sa.Column("monthly_target", sa.Integer, nullable=False, server_default="0"),
        _status(),
        *_stamps(),
        sa.CheckConstraint("status in ('Active','Inactive')", name="ck_ward_status"),
        sa.CheckConstraint("monthly_target >= 0", name="ck_ward_target"),
    )
    op.create_table(
        "staff_category",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        _tenant(),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("code", sa.String(3), nullable=False),
        _status(),
        *_stamps(),
        sa.CheckConstraint("status in ('Active','Inactive')", name="ck_staff_category_status"),
        sa.UniqueConstraint("tenant_id", "code", name="uq_staff_category_code"),
    )
    op.create_table(
        "setting",
        sa.Column("id", UUID, primary_key=True, server_default=NEW_ID),
        _tenant(),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("value", pg.JSONB, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("tenant_id", "key", name="uq_setting_key"),
    )

    for t in TABLES:
        op.create_index(f"ix_{t}_tenant_id", t, ["tenant_id"])
    op.create_index("ix_ward_department_id", "ward", ["department_id"])
    for t in ("department", "ward", "staff_category"):
        op.execute(f"CREATE UNIQUE INDEX uq_{t}_name ON {t} (tenant_id, lower(name))")

    for t in TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t}"
            " USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
            " WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
        )

    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON department, ward, staff_category, setting
              TO {APP_ROLE};
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    for t in reversed(TABLES):
        op.drop_table(t)
