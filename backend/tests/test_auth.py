import logging
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PASSWORD
from tests.helpers import V1, error_code, login, sign_in

WRONG = "Employee ID or password is incorrect."


def test_login_sets_secure_session_cookie_and_returns_user(api, make_user):
    make_user("ICN001", role="icn")
    r = login(api, "ICN001")
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["employee_id"] == "ICN001"
    assert body["user"]["role"]["key"] == "icn"
    assert set(body["user"]["permissions"]) == {
        "ln", "record", "review", "targets", "dash", "alerts", "reports",
    }  # fmt: skip
    assert body["user"]["must_change_password"] is False
    assert len(body["csrf_token"]) >= 40
    cookie = r.headers["set-cookie"].lower()
    assert "qms_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "password" not in r.text.lower().replace("must_change_password", "")


def test_session_cookie_is_secure_when_configured(tenant_id, make_user):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from tests.conftest import make_settings

    make_user("ICN001")
    app = create_app(make_settings(cookie_secure=True))
    with TestClient(app, base_url="https://testserver") as c:
        assert "secure" in login(c, "ICN001").headers["set-cookie"].lower()


def test_employee_id_is_case_insensitive(api, make_user):
    make_user("ICN001")
    assert login(api, "icn001").status_code == 200


def test_wrong_password_and_unknown_user_give_the_same_error(api, make_user):
    make_user("ICN001")
    a = login(api, "ICN001", "WrongPass1")
    b = login(api, "NOBODY", "WrongPass1")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()
    assert a.json()["error"]["message"] == WRONG
    assert error_code(a) == "unauthenticated"


def test_lockout_after_five_failures_for_fifteen_minutes(api, make_user, clock):
    make_user("ICN001")
    for _ in range(4):
        assert login(api, "ICN001", "WrongPass1").status_code == 401
    assert login(api, "ICN001", "WrongPass1").status_code == 401  # 5th failure sets the lock
    r = login(api, "ICN001")  # even the right password is refused while locked
    assert r.status_code == 423
    assert error_code(r) == "locked"
    clock.advance(minutes=14)
    assert login(api, "ICN001").status_code == 423
    clock.advance(minutes=2)
    assert login(api, "ICN001").status_code == 200


def test_successful_login_resets_the_failure_counter(api, make_user):
    make_user("ICN001")
    for _ in range(4):
        login(api, "ICN001", "WrongPass1")
    assert login(api, "ICN001").status_code == 200
    for _ in range(4):  # would lock if the counter had not been reset
        login(api, "ICN001", "WrongPass1")
    assert login(api, "ICN001").status_code == 200


def test_inactive_user_gets_inactive_message_only_with_correct_password(api, make_user):
    make_user("ICN001", status="Inactive")
    r = login(api, "ICN001")
    assert r.status_code == 403
    assert error_code(r) == "inactive_account"
    assert r.json()["error"]["message"] == "This account is inactive. Contact the ICN or IT."
    assert login(api, "ICN001", "WrongPass1").status_code == 401


def test_me_requires_login_and_returns_permissions(api, make_user):
    make_user("QM001", role="qm")
    assert api.get(f"{V1}/auth/me").status_code == 401
    sign_in(api, "QM001")
    me = api.get(f"{V1}/auth/me").json()
    assert me["user"]["employee_id"] == "QM001"
    assert set(me["user"]["permissions"]) == {"dash", "alerts", "reports"}
    assert me["csrf_token"]


def test_state_changing_requests_need_the_csrf_token(api, make_user):
    make_user("ICN001")
    csrf = sign_in(api, "ICN001")
    body = {"current_password": PASSWORD, "new_password": "NewPassw0rd2"}
    r = api.post(f"{V1}/auth/change-password", json=body)
    assert r.status_code == 403 and error_code(r) == "forbidden"
    r = api.post(f"{V1}/auth/change-password", json=body, headers={"X-CSRF-Token": "wrong"})
    assert r.status_code == 403
    assert api.post(f"{V1}/auth/change-password", json=body, headers=csrf).status_code == 200


def test_idle_timeout_ends_the_session(api, make_user, clock):
    make_user("ICN001")
    sign_in(api, "ICN001")
    clock.advance(minutes=29)
    assert api.get(f"{V1}/auth/me").status_code == 200  # activity keeps it alive
    clock.advance(minutes=29)
    assert api.get(f"{V1}/auth/me").status_code == 200
    clock.advance(minutes=31)
    r = api.get(f"{V1}/auth/me")
    assert r.status_code == 401 and error_code(r) == "session_expired"


def test_absolute_timeout_applies_even_with_activity(api, make_user, clock):
    make_user("ICN001")
    sign_in(api, "ICN001")
    for _ in range(24):  # 24 x 29 min = 11h36
        clock.advance(minutes=29)
        assert api.get(f"{V1}/auth/me").status_code == 200
    clock.advance(minutes=29)  # passes 12 hours
    assert api.get(f"{V1}/auth/me").status_code == 401


def test_logout_invalidates_the_session(api, make_user):
    make_user("ICN001")
    csrf = sign_in(api, "ICN001")
    stolen = api.cookies.get("qms_session")
    assert api.post(f"{V1}/auth/logout", headers=csrf).status_code == 204
    assert api.get(f"{V1}/auth/me").status_code == 401
    api.cookies.set("qms_session", stolen)  # replaying the old cookie must not work
    assert api.get(f"{V1}/auth/me").status_code == 401


def test_tampered_or_garbage_cookie_is_rejected(api, make_user):
    make_user("ICN001")
    for value in ["garbage", f"{uuid.uuid4()}.abc", "..", ""]:
        api.cookies.set("qms_session", value)
        assert api.get(f"{V1}/auth/me").status_code == 401


def test_session_token_is_stored_hashed(api, make_user, owner_engine):
    make_user("ICN001")
    sign_in(api, "ICN001")
    token = api.cookies.get("qms_session").split(".", 1)[1]
    with owner_engine.connect() as c:
        rows = c.execute(text("SELECT token_hash FROM user_session")).scalars().all()
    assert len(rows) == 1 and rows[0] != token and token not in rows[0]


def test_temporary_password_forces_a_change(api, make_user):
    make_user("NEW001", password="Temp0rary9", must_change=True)
    csrf = sign_in(api, "NEW001", "Temp0rary9")
    me = api.get(f"{V1}/auth/me").json()["user"]
    assert me["must_change_password"] is True
    r = api.get(f"{V1}/users")  # blocked until the password is changed
    assert r.status_code == 403 and error_code(r) == "password_change_required"
    r = api.post(
        f"{V1}/auth/change-password",
        json={"current_password": "Temp0rary9", "new_password": "BrandNew123"},
        headers=csrf,
    )
    assert r.status_code == 200
    assert r.json()["user"]["must_change_password"] is False
    assert api.get(f"{V1}/auth/me").json()["user"]["must_change_password"] is False


@pytest.mark.parametrize(
    ("current", "new", "field"),
    [
        (PASSWORD, "short1", "new_password"),
        (PASSWORD, "onlyletters", "new_password"),
        (PASSWORD, "12345678", "new_password"),
        (PASSWORD, PASSWORD, "new_password"),  # must differ from the current one
        ("WrongPass1", "BrandNew123", "current_password"),
    ],
)
def test_change_password_validation(api, make_user, current, new, field):
    make_user("ICN001")
    csrf = sign_in(api, "ICN001")
    r = api.post(
        f"{V1}/auth/change-password",
        json={"current_password": current, "new_password": new},
        headers=csrf,
    )
    assert r.status_code == 422
    assert error_code(r) == "validation_error"
    assert r.json()["error"]["details"][0]["field"] == field


def test_change_password_ends_other_sessions_and_old_password_stops_working(
    api, new_client, make_user
):
    make_user("ICN001")
    other = new_client()
    sign_in(other, "ICN001")
    csrf = sign_in(api, "ICN001")
    r = api.post(
        f"{V1}/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "BrandNew123"},
        headers=csrf,
    )
    assert r.status_code == 200
    assert other.get(f"{V1}/auth/me").status_code == 401  # other device signed out
    assert api.get(f"{V1}/auth/me").status_code == 200  # this one stays
    assert login(new_client(), "ICN001", PASSWORD).status_code == 401
    assert login(new_client(), "ICN001", "BrandNew123").status_code == 200


def test_passwords_and_tokens_never_appear_in_logs(api, make_user, caplog):
    make_user("ICN001")
    with caplog.at_level(logging.DEBUG):
        login(api, "ICN001", "WrongPass1")
        sign_in(api, "ICN001")
    token = api.cookies.get("qms_session").split(".", 1)[1]
    assert "WrongPass1" not in caplog.text
    assert PASSWORD not in caplog.text
    assert token not in caplog.text


def test_lockout_is_audited(api, make_user, owner_engine):
    make_user("ICN001")
    for _ in range(5):
        login(api, "ICN001", "WrongPass1")
    with owner_engine.connect() as c:
        actions = c.execute(text("SELECT action FROM audit_log")).scalars().all()
    assert "account_locked" in actions
