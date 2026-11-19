"""Database-level guarantees: row-level security and the append-only audit log."""

import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

from app.roles.seed import ensure_catalog, ensure_tenant
from tests.conftest import app_url
from tests.helpers import V1, sign_in


@pytest.fixture
def app_engine(migrated):
    engine = create_engine(app_url())
    yield engine
    engine.dispose()


def set_tenant(conn, tenant):
    conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant)})


def test_runtime_role_is_not_a_superuser(app_engine):
    with app_engine.connect() as c:
        row = c.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).one()
    assert tuple(row) == (False, False)


@pytest.fixture
def two_tenants(owner_engine, tenant_id, make_user):
    make_user("A001", role="admin")
    with Session(owner_engine) as s:
        other = ensure_tenant(s, "OTHER", "Other Hospital")
        ensure_catalog(s, other)
        s.commit()
        other_id = other.id
    with owner_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO app_user (id, tenant_id, employee_id, full_name, designation, mobile,"
                " email, password_hash, must_change_password, failed_attempts, status)"
                " VALUES (:id, :t, 'B001', 'Other Admin', 'x', '9840000000', '', 'x', false, 0,"
                " 'Active')"
            ),
            {"id": uuid.uuid4(), "t": other_id},
        )
    return tenant_id, other_id


def test_no_tenant_context_means_no_rows(app_engine, two_tenants):
    with app_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM app_user")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM role")).scalar() == 0


def test_each_tenant_sees_only_its_own_rows(app_engine, two_tenants):
    a, b = two_tenants
    with app_engine.connect() as c:
        set_tenant(c, a)
        assert c.execute(text("SELECT employee_id FROM app_user")).scalars().all() == ["A001"]
    with app_engine.connect() as c:
        set_tenant(c, b)
        assert c.execute(text("SELECT employee_id FROM app_user")).scalars().all() == ["B001"]


def test_cannot_write_rows_for_another_tenant(app_engine, two_tenants):
    a, b = two_tenants
    with app_engine.connect() as c:
        set_tenant(c, a)
        with pytest.raises((DBAPIError, ProgrammingError)):
            c.execute(
                text(
                    "INSERT INTO role (id, tenant_id, key, name, is_system)"
                    " VALUES (gen_random_uuid(), :t, 'evil', 'Evil', false)"
                ),
                {"t": b},
            )


def test_cannot_update_or_delete_another_tenants_rows(app_engine, two_tenants):
    a, _ = two_tenants
    with app_engine.connect() as c:
        set_tenant(c, a)
        assert (
            c.execute(text("UPDATE app_user SET full_name='X' WHERE employee_id='B001'")).rowcount
            == 0
        )
        assert c.execute(text("DELETE FROM app_user WHERE employee_id='B001'")).rowcount == 0


def test_api_never_returns_another_tenants_users(api, two_tenants, owner_engine):
    csrf = sign_in(api, "A001")
    assert csrf
    items = api.get(f"{V1}/users").json()["items"]
    assert [u["employee_id"] for u in items] == ["A001"]
    with owner_engine.connect() as c:
        other_user = c.execute(text("SELECT id FROM app_user WHERE employee_id='B001'")).scalar()
    assert api.get(f"{V1}/users/{other_user}").status_code == 404


def test_audit_log_cannot_be_changed_by_the_app_role(app_engine, tenant_id):
    with Session(app_engine) as s:
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
        s.execute(
            text(
                "INSERT INTO audit_log (tenant_id, entity, entity_id, action, summary)"
                " VALUES (:t, 'test', 'x', 'create', 'row')"
            ),
            {"t": tenant_id},
        )
        s.commit()
    for sql in (
        "UPDATE audit_log SET summary = 'tampered'",
        "DELETE FROM audit_log",
        "TRUNCATE audit_log",
    ):
        with app_engine.connect() as c:
            set_tenant(c, tenant_id)
            with pytest.raises((DBAPIError, ProgrammingError)):
                c.execute(text(sql))


def test_audit_log_trigger_blocks_even_the_owner(owner_engine, tenant_id):
    with owner_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO audit_log (tenant_id, entity, entity_id, action, summary)"
                " VALUES (:t, 'test', 'x', 'create', 'row')"
            ),
            {"t": tenant_id},
        )
    for sql in ("UPDATE audit_log SET summary = 'tampered'", "DELETE FROM audit_log"):
        with owner_engine.connect() as c:
            with pytest.raises((DBAPIError, ProgrammingError)) as exc:
                c.execute(text(sql))
            assert "append-only" in str(exc.value)
