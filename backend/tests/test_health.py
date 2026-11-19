from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


def test_health_ok_when_database_up(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body == {"status": "ok", "version": "0.1.0", "db": "up"}


def test_health_503_when_database_down():
    # Nothing listens on port 1, so the DB ping must fail fast.
    s = make_settings(database_url="postgresql+psycopg://x:y@127.0.0.1:1/none")
    with TestClient(create_app(s), raise_server_exceptions=False) as c:
        r = c.get("/api/v1/health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["db"] == "down"


def test_health_needs_no_authentication(client):
    assert client.get("/api/v1/health").status_code == 200


def test_health_does_not_leak_connection_details():
    s = make_settings(database_url="postgresql+psycopg://secretuser:secretpw@127.0.0.1:1/none")
    with TestClient(create_app(s), raise_server_exceptions=False) as c:
        text = c.get("/api/v1/health").text
    assert "secretpw" not in text
    assert "secretuser" not in text
