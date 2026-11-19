import pytest
from sqlalchemy import text

from app.cli import main
from tests.conftest import OWNER_URL, app_url
from tests.helpers import login


@pytest.fixture
def cli_env(monkeypatch, tenant_id):
    monkeypatch.setenv("DATABASE_URL", OWNER_URL)
    monkeypatch.setenv("APP_DATABASE_URL", app_url())
    monkeypatch.setenv("DEFAULT_TENANT_CODE", "TEST")
    monkeypatch.setenv("ARGON2_TIME_COST", "1")
    monkeypatch.setenv("ARGON2_MEMORY_COST", "8")
    monkeypatch.setenv("ARGON2_PARALLELISM", "1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_create_admin_uses_password_from_environment(cli_env, monkeypatch, api, capsys):
    monkeypatch.setenv("QMS_ADMIN_PASSWORD", "Dummy-Adm1n-Pw")
    code = main(["create-admin", "--employee-id", "Admin", "--name", "IT Admin"])
    assert code == 0
    out = capsys.readouterr().out
    assert "Dummy-Adm1n-Pw" not in out  # a password supplied by the operator is never echoed
    r = login(api, "admin", "Dummy-Adm1n-Pw")
    assert r.status_code == 200
    assert r.json()["user"]["role"]["key"] == "admin"
    assert r.json()["user"]["must_change_password"] is False


def test_create_admin_can_force_a_password_change(cli_env, monkeypatch, api):
    monkeypatch.setenv("QMS_ADMIN_PASSWORD", "Dummy-Adm1n-Pw")
    main(["create-admin", "--employee-id", "ADM9", "--name", "A", "--force-change"])
    assert login(api, "ADM9", "Dummy-Adm1n-Pw").json()["user"]["must_change_password"] is True


def test_create_admin_without_password_generates_and_prints_one_once(
    cli_env, monkeypatch, api, capsys
):
    monkeypatch.delenv("QMS_ADMIN_PASSWORD", raising=False)
    assert main(["create-admin", "--employee-id", "ADM2", "--name", "Second"]) == 0
    printed = capsys.readouterr().out
    temp = next(w for w in printed.split() if w.startswith("TEMP:")).removeprefix("TEMP:")
    r = login(api, "ADM2", temp)
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is True


def test_create_admin_rejects_weak_password_and_duplicates(cli_env, monkeypatch, api, capsys):
    monkeypatch.setenv("QMS_ADMIN_PASSWORD", "weak")
    assert main(["create-admin", "--employee-id", "ADM3", "--name", "X"]) == 1
    monkeypatch.setenv("QMS_ADMIN_PASSWORD", "Passw0rd1")
    assert main(["create-admin", "--employee-id", "ADM3", "--name", "X"]) == 0
    assert main(["create-admin", "--employee-id", "adm3", "--name", "X"]) == 1


def test_create_admin_is_audited_without_the_password(cli_env, monkeypatch, api, owner_engine):
    monkeypatch.setenv("QMS_ADMIN_PASSWORD", "Dummy-Adm1n-Pw")
    main(["create-admin", "--employee-id", "Admin", "--name", "IT Admin"])
    with owner_engine.connect() as c:
        rows = c.execute(text("SELECT summary, new_values::text FROM audit_log")).all()
    assert any("ADMIN" in r[0] for r in rows)
    assert all("Dummy-Adm1n-Pw" not in "".join(r) for r in rows)


def test_init_is_idempotent_and_keeps_custom_changes(cli_env, owner_engine):
    assert main(["init"]) == 0
    with owner_engine.begin() as c:
        c.execute(
            text(
                "DELETE FROM role_permission WHERE role_id = (SELECT id FROM role WHERE key='qm')"
                " AND permission_id = (SELECT id FROM permission WHERE code='reports')"
            )
        )
    assert main(["init"]) == 0
    with owner_engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM permission")).scalar()
        qm = c.execute(
            text(
                "SELECT count(*) FROM role_permission rp JOIN role r ON r.id=rp.role_id"
                " WHERE r.key='qm'"
            )
        ).scalar()
    assert n == 9
    assert qm == 2  # the admin's customisation was not reset by init
