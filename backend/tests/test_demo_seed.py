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


def test_seed_demo_loads_the_link_nurses_and_demo_users(cli_env, owner_engine):
    cli_env.setenv("ENV", "development")
    assert main(["seed-demo"]) == 0
    with owner_engine.connect() as c:
        q = lambda sql: c.execute(text(sql)).scalar()  # noqa: E731
        nurses = (
            "FROM app_user u JOIN user_role ur ON ur.user_id=u.id JOIN role r ON r.id=ur.role_id"
            " WHERE r.key='link_nurse'"
        )
        assert q(f"SELECT count(*) {nurses}") == 30
        assert q(f"SELECT count(*) {nurses} AND u.status='Inactive'") == 1
        assert q("SELECT count(*) FROM ward_assignment") == 32
        assert q("SELECT count(*) FROM ward_assignment WHERE to_date IS NULL") == 30
        # Priya R.: moved to MICU in June, added SICU in September (prototype story)
        priya = c.execute(
            text(
                "SELECT w.name, a.from_date, a.to_date FROM ward_assignment a"
                " JOIN ward w ON w.id=a.ward_id JOIN app_user u ON u.id=a.user_id"
                " WHERE u.employee_id='SN1001' ORDER BY a.from_date"
            )
        ).all()
        assert [(r[0], str(r[1]), str(r[2])) for r in priya] == [
            ("Ward 2 – Surgery", "2026-01-05", "2026-05-31"),
            ("MICU", "2026-06-01", "None"),
            ("SICU", "2026-09-01", "None"),
        ]
        reason = q("SELECT reason FROM status_history WHERE entity_type='link_nurse'")
        assert reason == "Moved to OT as scrub nurse"
        # every ward has at least one current link nurse
        assert (
            q(
                "SELECT count(*) FROM ward w WHERE NOT EXISTS (SELECT 1 FROM ward_assignment a"
                " WHERE a.ward_id=w.id AND a.to_date IS NULL)"
            )
            == 0
        )
        assert q("SELECT count(*) FROM app_user WHERE employee_id IN ('ICN001','QM001')") == 2


def test_demo_users_can_sign_in_and_the_second_run_adds_nothing(cli_env, api, owner_engine):
    from tests.helpers import login

    cli_env.setenv("ENV", "development")
    main(["seed-demo"])
    for emp, role in (("SN1001", "link_nurse"), ("ICN001", "icn"), ("QM001", "qm")):
        r = login(api, emp, "Demo-1234")
        assert r.status_code == 200, (emp, r.text)
        assert r.json()["user"]["role"]["key"] == role
        assert r.json()["user"]["must_change_password"] is False
    assert login(api, "SN1030", "Demo-1234").status_code == 403  # the inactive nurse
    main(["seed-demo"])
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ward_assignment")).scalar() == 32
        assert c.execute(text("SELECT count(*) FROM app_user")).scalar() == 32


def test_demo_wards_are_visible_through_the_api(cli_env, api, make_user):
    cli_env.setenv("ENV", "development")
    main(["seed-demo"])
    make_user("N001", role="link_nurse")
    sign_in(api, "N001")
    wards = api.get(f"{V1}/wards?status=Active&page_size=100").json()
    assert wards["total"] == 20
    assert {"MICU", "OPD", "Ward 3 – Ortho"} <= {w["name"] for w in wards["items"]}
