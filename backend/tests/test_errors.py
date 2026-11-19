from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.main import create_app
from tests.conftest import make_settings


class Payload(BaseModel):
    mobile: str


def build_client() -> TestClient:
    app = create_app(make_settings())

    @app.post("/api/v1/_test/validate")
    def validate(p: Payload):
        return p

    @app.get("/api/v1/_test/boom")
    def boom():
        raise RuntimeError("secret internal detail")

    @app.get("/api/v1/_test/forbidden")
    def forbidden():
        raise HTTPException(status_code=403, detail="Not allowed")

    return TestClient(app, raise_server_exceptions=False)


def test_unknown_route_uses_standard_error_format():
    r = build_client().get("/api/v1/nope")
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "not_found"
    assert isinstance(err["message"], str)


def test_validation_error_uses_standard_format_with_field_details():
    r = build_client().post("/api/v1/_test/validate", json={})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert err["details"][0]["field"] == "mobile"
    assert "message" in err["details"][0]


def test_http_exception_maps_to_code_and_message():
    r = build_client().get("/api/v1/_test/forbidden")
    assert r.status_code == 403
    assert r.json()["error"] == {"code": "forbidden", "message": "Not allowed", "details": []}


def test_unhandled_exception_returns_500_without_leaking_internals():
    r = build_client().get("/api/v1/_test/boom")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal_error"
    assert "secret internal detail" not in r.text
