from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from tests.conftest import make_settings


def alembic_config() -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", make_settings().database_url.get_secret_value())
    return cfg


def test_single_migration_head():
    heads = ScriptDirectory.from_config(alembic_config()).get_heads()
    assert len(heads) == 1


def test_upgrade_and_downgrade_baseline_runs_on_real_postgres():
    cfg = alembic_config()
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
