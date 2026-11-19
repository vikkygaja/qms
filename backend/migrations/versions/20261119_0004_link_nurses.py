"""Slice 4: link nurse profile columns and ward assignment history.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

APP_ROLE = "qms_app"
UUID = pg.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("app_user", sa.Column("department_id", UUID, sa.ForeignKey("department.id")))
    op.add_column("app_user", sa.Column("link_nurse_from", sa.Date))
    op.add_column("app_user", sa.Column("who5_training_date", sa.Date))

    op.create_table(
        "ward_assignment",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("ward_id", UUID, sa.ForeignKey("ward.id"), nullable=False),
        sa.Column("from_date", sa.Date, nullable=False),
        sa.Column("to_date", sa.Date),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", UUID),
        sa.Column("ended_by", UUID),
        sa.CheckConstraint(
            "to_date IS NULL OR to_date >= from_date", name="ck_ward_assignment_dates"
        ),
    )
    op.create_index("ix_ward_assignment_tenant_id", "ward_assignment", ["tenant_id"])
    op.create_index("ix_ward_assignment_user_id", "ward_assignment", ["user_id"])
    op.create_index("ix_ward_assignment_ward_id", "ward_assignment", ["ward_id"])
    # a nurse has at most one CURRENT row per ward
    op.execute(
        "CREATE UNIQUE INDEX uq_ward_assignment_current ON ward_assignment (user_id, ward_id)"
        " WHERE to_date IS NULL"
    )
    op.execute("ALTER TABLE ward_assignment ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ward_assignment FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON ward_assignment"
        " USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
        " WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
    )
    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ward_assignment TO {APP_ROLE};
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_table("ward_assignment")
    op.drop_column("app_user", "who5_training_date")
    op.drop_column("app_user", "link_nurse_from")
    op.drop_column("app_user", "department_id")
