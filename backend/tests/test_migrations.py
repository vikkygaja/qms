"""Migrations run against their own throwaway database so they cannot disturb other tests."""

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.cli import alembic_config, run_migrations
from tests.conftest import OWNER_URL, app_url, make_settings

DB_NAME = "qms_migrations_test"


@pytest.fixture
def scratch_settings(owner_engine):
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME} WITH (FORCE)"))
        c.execute(text(f"CREATE DATABASE {DB_NAME}"))
    url = make_url(OWNER_URL).set(database=DB_NAME).render_as_string(hide_password=False)
    yield make_settings(database_url=url, app_database_url=app_url(url))
    with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME} WITH (FORCE)"))


def test_single_migration_head(scratch_settings):
    assert len(ScriptDirectory.from_config(alembic_config(scratch_settings)).get_heads()) == 1


def test_upgrade_downgrade_upgrade_on_real_postgres(scratch_settings):
    run_migrations(scratch_settings)
    cfg = alembic_config(scratch_settings)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


def test_every_table_except_tenant_has_tenant_id_and_forced_rls(scratch_settings):
    run_migrations(scratch_settings)
    engine = create_engine(scratch_settings.database_url.get_secret_value())
    with engine.connect() as c:
        tables = c.execute(
            text(
                "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,"
                " EXISTS (SELECT 1 FROM information_schema.columns k"
                "         WHERE k.table_name = c.relname AND k.column_name = 'tenant_id')"
                " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
                " WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'alembic_version'"
            )
        ).all()
    engine.dispose()
    assert len(tables) >= 9
    for name, rls, forced, has_tenant_id in tables:
        if name == "tenant":
            continue
        assert has_tenant_id, f"{name} has no tenant_id"
        assert rls and forced, f"{name} is missing forced row-level security"
