"""Shared fixtures. Tests need a real PostgreSQL (DATABASE_URL), never SQLite.

DATABASE_URL is the OWNER (superuser) connection used for migrations and test setup.
The API under test connects as the non-superuser role `qms_app`, so row-level security
and the append-only audit grants are really exercised.
"""

import os
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session

from app.cli import run_migrations
from app.core.config import Settings
from app.core.security import hash_password
from app.main import create_app
from app.roles.models import Role
from app.roles.seed import ensure_catalog, ensure_tenant
from app.users.models import User, UserRole

DEFAULT_TEST_DB = "postgresql+psycopg://qms:qms_test_pw@db:5432/qms_test"  # dummy, test only
OWNER_URL = os.environ.get("DATABASE_URL", DEFAULT_TEST_DB)
APP_ROLE_PASSWORD = "app_role_test_pw"  # dummy, test only
TEST_TENANT = "TEST"
PASSWORD = "Passw0rd1"  # dummy password used by all test users


def app_url(owner_url: str = OWNER_URL) -> str:
    return (
        make_url(owner_url)
        .set(username="qms_app", password=APP_ROLE_PASSWORD)
        .render_as_string(hide_password=False)
    )


def make_settings(**overrides) -> Settings:
    base = {
        "env": "development",
        "database_url": OWNER_URL,
        "app_database_url": app_url(),
        "redis_url": "redis://localhost:6379/0",
        "cookie_secure": False,
        "default_tenant_code": TEST_TENANT,
        "argon2_time_cost": 1,  # fast hashing in tests; production defaults are stronger
        "argon2_memory_cost": 8,
        "argon2_parallelism": 1,
    }
    if "database_url" in overrides and "app_database_url" not in overrides:
        base["app_database_url"] = None  # a custom owner URL means "use it for the runtime too"
    base.update(overrides)
    return Settings(_env_file=None, **base)


class Clock:
    """Controllable UTC clock injected into the app."""

    def __init__(self, start: datetime) -> None:
        self.current = start

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kwargs) -> None:
        self.current += timedelta(**kwargs)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture(scope="session")
def owner_engine() -> Iterator[Engine]:
    engine = create_engine(OWNER_URL)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def migrated() -> Settings:
    """Create the qms_app role and migrate the test database to head, once per run."""
    s = make_settings()
    run_migrations(s)
    return s


@pytest.fixture
def client(migrated):
    app = create_app(make_settings())
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def tenant_id(migrated, owner_engine) -> uuid.UUID:
    """Empty the database and seed one tenant with the default permissions and roles."""
    with owner_engine.begin() as conn:
        conn.execute(text("TRUNCATE tenant RESTART IDENTITY CASCADE"))
    with Session(owner_engine) as s:
        tenant = ensure_tenant(s, TEST_TENANT, "Test Hospital")
        ensure_catalog(s, tenant)
        s.commit()
        return tenant.id


@pytest.fixture
def clock() -> Clock:
    return Clock(datetime(2026, 11, 19, 10, 0, tzinfo=UTC))


@pytest.fixture
def app(tenant_id, clock):
    return create_app(make_settings(), clock=clock)


@pytest.fixture
def api(app) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def new_client(app) -> Iterator[Callable[[], TestClient]]:
    """Factory for extra clients with their own cookie jar (several users at once)."""
    made: list[TestClient] = []

    def _make() -> TestClient:
        c = TestClient(app, raise_server_exceptions=False)
        made.append(c)
        return c

    yield _make
    for c in made:
        c.close()


@pytest.fixture
def make_user(owner_engine, tenant_id) -> Callable[..., uuid.UUID]:
    def _make(
        employee_id: str = "U001",
        role: str = "icn",
        password: str = PASSWORD,
        status: str = "Active",
        must_change: bool = False,
        full_name: str | None = None,
        mobile: str = "9840000001",
    ) -> uuid.UUID:
        with Session(owner_engine) as s:
            role_row = s.scalar(select(Role).where(Role.tenant_id == tenant_id, Role.key == role))
            user = User(
                tenant_id=tenant_id,
                employee_id=employee_id.upper(),
                full_name=full_name or f"Test {employee_id}",
                designation="Staff",
                mobile=mobile,
                email="",
                password_hash=hash_password(password, make_settings()),
                must_change_password=must_change,
                status=status,
            )
            s.add(user)
            s.flush()
            s.add(UserRole(tenant_id=tenant_id, user_id=user.id, role_id=role_row.id))
            s.commit()
            return user.id

    return _make
