from fastapi.testclient import TestClient

from tests.conftest import PASSWORD

V1 = "/api/v1"


def login(c: TestClient, employee_id: str, password: str = PASSWORD):
    return c.post(f"{V1}/auth/login", json={"employee_id": employee_id, "password": password})


def sign_in(c: TestClient, employee_id: str, password: str = PASSWORD) -> dict[str, str]:
    """Log in and return the CSRF header for state-changing calls."""
    r = login(c, employee_id, password)
    assert r.status_code == 200, r.text
    return {"X-CSRF-Token": r.json()["csrf_token"]}


def error_code(r) -> str:
    return r.json()["error"]["code"]
