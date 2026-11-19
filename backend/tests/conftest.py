"""Shared fixtures. Tests need a real PostgreSQL (DATABASE_URL), never SQLite."""

import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

DEFAULT_TEST_DB = "postgresql+psycopg://qms:qms_test_pw@db:5432/qms_test"  # dummy, test only


def make_settings(**overrides) -> Settings:
    base = {
        "env": "development",
        "database_url": os.environ.get("DATABASE_URL", DEFAULT_TEST_DB),
        "redis_url": "redis://localhost:6379/0",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def client(settings: Settings):
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
