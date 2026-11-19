import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app
from tests.conftest import make_settings


def test_docs_enabled_in_development():
    with TestClient(create_app(make_settings(env="development"))) as c:
        assert c.get("/api/v1/docs").status_code == 200
        assert c.get("/api/v1/openapi.json").status_code == 200


@pytest.mark.parametrize("env", ["production", "staging", "test"])
def test_docs_disabled_outside_development(env):
    with TestClient(create_app(make_settings(env=env)), raise_server_exceptions=False) as c:
        assert c.get("/api/v1/docs").status_code == 404
        assert c.get("/api/v1/openapi.json").status_code == 404
        assert c.get("/api/v1/redoc").status_code == 404


def test_settings_require_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_default_env_is_production(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://a:b@h/d")
    assert Settings(_env_file=None).env == "production"


def test_settings_repr_hides_secrets():
    s = make_settings(database_url="postgresql+psycopg://u:topsecret@h/d")
    assert "topsecret" not in repr(s)
    assert "topsecret" not in str(s)
