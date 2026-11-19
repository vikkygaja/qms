import pytest
from sqlalchemy import text

from app.cli import main
from tests.conftest import OWNER_URL, app_url
from tests.helpers import V1, sign_in


@pytest.fixture
def cli_env(monkeypatch, tenant_id):
    monkeypatch.setenv("DATABASE_URL", OWNER_URL)
    monkeypatch.setenv("APP_DATABASE_URL", app_url())
    monkeypatch.setenv("DEFAULT_TENANT_CODE", "TEST")
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield monkeypatch
    get_settings.cache_clear()


def counts(owner_engine):
    with owner_engine.connect() as c:
        return (
            c.execute(text("SELECT count(*) FROM department")).scalar(),
            c.execute(text("SELECT count(*) FROM ward")).scalar(),
            c.execute(text("SELECT coalesce(sum(monthly_target),0) FROM ward")).scalar(),
        )


def test_seed_demo_refuses_to_run_outside_development(cli_env, owner_engine, capsys):
    cli_env.setenv("ENV", "production")
    assert main(["seed-demo"]) == 1
    assert "development" in capsys.readouterr().err
    assert counts(owner_engine)[1] == 0


def test_seed_demo_loads_the_prototype_wards(cli_env, owner_engine):
    cli_env.setenv("ENV", "development")
    assert main(["seed-demo"]) == 0
    depts, wards, total = counts(owner_engine)
    assert wards == 20 and depts == 11 and total == 1000  # hospital total about 1,000


def test_seed_demo_is_idempotent_and_does_not_touch_existing_edits(cli_env, owner_engine):
    cli_env.setenv("ENV", "development")
    main(["seed-demo"])
    with owner_engine.begin() as c:
        c.execute(text("UPDATE ward SET monthly_target = 99 WHERE name = 'MICU'"))
    assert main(["seed-demo"]) == 0
    assert counts(owner_engine)[:2] == (11, 20)
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT monthly_target FROM ward WHERE name='MICU'")).scalar() == 99


def test_seed_demo_force_overrides_the_guard(cli_env, owner_engine):
    cli_env.setenv("ENV", "production")
    assert main(["seed-demo", "--force"]) == 0
    assert counts(owner_engine)[1] == 20


def test_demo_wards_are_visible_through_the_api(cli_env, api, make_user):
    cli_env.setenv("ENV", "development")
    main(["seed-demo"])
    make_user("N001", role="link_nurse")
    sign_in(api, "N001")
    wards = api.get(f"{V1}/wards?status=Active&page_size=100").json()
    assert wards["total"] == 20
    assert {"MICU", "OPD", "Ward 3 – Ortho"} <= {w["name"] for w in wards["items"]}
