import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PASSWORD
from tests.helpers import V1, error_code, login, sign_in

ANY_ID = str(uuid.uuid4())
GUARDED = [
    ("GET", "/users", None),
    ("POST", "/users", {}),
    ("GET", f"/users/{ANY_ID}", None),
    ("PATCH", f"/users/{ANY_ID}", {}),
    ("POST", f"/users/{ANY_ID}/status", {}),
    ("POST", f"/users/{ANY_ID}/reset-password", None),
    ("GET", "/permissions", None),
    ("GET", "/roles", None),
    ("POST", "/roles", {}),
    ("PUT", f"/roles/{ANY_ID}/permissions", {}),
    ("GET", "/audit-log", None),
]


def call(c, method, path, body=None, headers=None):
    return c.request(method, f"{V1}{path}", json=body, headers=headers)


@pytest.mark.parametrize(("method", "path", "body"), GUARDED)
def test_every_admin_endpoint_rejects_anonymous_users(api, method, path, body):
    assert call(api, method, path, body).status_code == 401


@pytest.mark.parametrize("role", ["icn", "qm", "link_nurse"])
@pytest.mark.parametrize(("method", "path", "body"), GUARDED)
def test_every_admin_endpoint_rejects_roles_without_users_permission(
    api, make_user, role, method, path, body
):
    make_user("X001", role=role)
    csrf = sign_in(api, "X001")
    r = call(api, method, path, body, csrf)
    assert r.status_code == 403, r.text
    assert error_code(r) == "forbidden"


@pytest.fixture
def admin(api, make_user):
    make_user("ADM001", role="admin", full_name="IT Admin")
    return sign_in(api, "ADM001")


def role_id(api, key):
    return next(r["id"] for r in api.get(f"{V1}/roles").json() if r["key"] == key)


def new_user(api, admin, **kw):
    body = {
        "employee_id": "icn002",
        "full_name": "Sr. Test",
        "designation": "Infection Control Nurse",
        "role_id": role_id(api, "icn"),
        "mobile": "9840000002",
        "email": "",
    } | kw
    return api.post(f"{V1}/users", json=body, headers=admin)


def test_create_user_returns_a_one_time_temporary_password(api, admin, owner_engine):
    r = new_user(api, admin)
    assert r.status_code == 201, r.text
    body = r.json()
    user, temp = body["user"], body["temporary_password"]
    assert user["employee_id"] == "ICN002"  # stored upper-case
    assert user["must_change_password"] is True and user["status"] == "Active"
    assert "password" not in str(user).replace("must_change_password", "")
    with owner_engine.connect() as c:
        h = c.execute(text("SELECT password_hash FROM app_user WHERE employee_id='ICN002'"))
        assert h.scalar().startswith("$argon2id$")
    # the new user can sign in with it, and is forced to change it
    r2 = login(api, "ICN002", temp)
    assert r2.status_code == 200 and r2.json()["user"]["must_change_password"] is True
    # it is never returned again
    assert temp not in api.get(f"{V1}/users/{user['id']}").text
    assert temp not in api.get(f"{V1}/users").text


def test_create_user_is_audited_without_secrets(api, admin):
    temp = new_user(api, admin).json()["temporary_password"]
    log = api.get(f"{V1}/audit-log?entity=user&action=create").json()["items"]
    assert len(log) == 1
    assert log[0]["actor"]["employee_id"] == "ADM001"
    assert "ICN002" in log[0]["summary"]
    assert temp not in str(log) and "password_hash" not in str(log)


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"employee_id": "ab"}, "employee_id"),
        ({"employee_id": "bad id!"}, "employee_id"),
        ({"full_name": ""}, "full_name"),
        ({"designation": ""}, "designation"),
        ({"mobile": "12345"}, "mobile"),
        ({"mobile": "98400000ab"}, "mobile"),
        ({"email": "not-an-email"}, "email"),
        ({"role_id": "not-a-uuid"}, "role_id"),
    ],
)
def test_create_user_validation(api, admin, override, field):
    r = new_user(api, admin, **override)
    assert r.status_code == 422
    assert field in [d["field"] for d in r.json()["error"]["details"]]


def test_duplicate_employee_id_is_rejected_case_insensitively(api, admin):
    assert new_user(api, admin, employee_id="DUP001").status_code == 201
    r = new_user(api, admin, employee_id="dup001")
    assert r.status_code == 409 and error_code(r) == "conflict"
    assert "already" in r.json()["error"]["message"]


def test_link_nurse_role_cannot_be_assigned_through_users_api(api, admin):
    r = new_user(api, admin, role_id=role_id(api, "link_nurse"))
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "role_id"


def test_unknown_role_is_rejected(api, admin):
    assert new_user(api, admin, role_id=str(uuid.uuid4())).status_code == 422


def test_list_search_and_filters(api, admin, make_user):
    make_user("QM001", role="qm", full_name="Dr. Arun K.")
    make_user("OLD001", role="icn", status="Inactive", full_name="Old Nurse")
    everyone = api.get(f"{V1}/users").json()
    assert everyone["total"] == 3 and everyone["page"] == 1
    by_name = api.get(f"{V1}/users?q=arun").json()["items"]
    assert [u["employee_id"] for u in by_name] == ["QM001"]
    by_id = api.get(f"{V1}/users?q=old0").json()["items"]
    assert [u["employee_id"] for u in by_id] == ["OLD001"]
    inactive = api.get(f"{V1}/users?status=Inactive").json()["items"]
    assert [u["employee_id"] for u in inactive] == ["OLD001"]
    qm = api.get(f"{V1}/users?role_id={role_id(api, 'qm')}").json()["items"]
    assert [u["employee_id"] for u in qm] == ["QM001"]
    page = api.get(f"{V1}/users?page=2&page_size=2").json()
    assert len(page["items"]) == 1 and page["total"] == 3


def test_update_user_and_audit_old_new_values(api, admin):
    uid = new_user(api, admin).json()["user"]["id"]
    r = api.patch(
        f"{V1}/users/{uid}",
        json={"full_name": "Sr. Renamed", "mobile": "9840000099", "role_id": role_id(api, "qm")},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "Sr. Renamed" and r.json()["role"]["key"] == "qm"
    entry = api.get(f"{V1}/audit-log?entity=user&action=update").json()["items"][0]
    assert entry["old_values"]["full_name"] == "Sr. Test"
    assert entry["new_values"]["full_name"] == "Sr. Renamed"
    assert entry["new_values"]["role"] == "Quality Manager"


def test_employee_id_cannot_be_changed(api, admin):
    uid = new_user(api, admin).json()["user"]["id"]
    r = api.patch(f"{V1}/users/{uid}", json={"employee_id": "HACK01"}, headers=admin)
    assert r.status_code == 422


def test_get_unknown_user_is_404(api, admin):
    assert api.get(f"{V1}/users/{uuid.uuid4()}").status_code == 404


def test_status_change_needs_a_reason_and_records_history(api, admin, owner_engine):
    uid = new_user(api, admin).json()["user"]["id"]
    r = api.post(
        f"{V1}/users/{uid}/status", json={"status": "Inactive", "reason": " "}, headers=admin
    )
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "reason"
    r = api.post(
        f"{V1}/users/{uid}/status",
        json={"status": "Inactive", "reason": "Left the hospital"},
        headers=admin,
    )
    assert r.status_code == 200 and r.json()["status"] == "Inactive"
    with owner_engine.connect() as c:
        row = c.execute(
            text("SELECT old_status, new_status, reason FROM status_history WHERE entity_id=:i"),
            {"i": uid},
        ).one()
    assert tuple(row) == ("Active", "Inactive", "Left the hospital")
    entry = api.get(f"{V1}/audit-log?action=status_change").json()["items"][0]
    assert "Inactive" in entry["summary"] and "Left the hospital" in entry["summary"]
    # and it can come back
    r = api.post(
        f"{V1}/users/{uid}/status", json={"status": "Active", "reason": "Rejoined"}, headers=admin
    )
    assert r.status_code == 200 and r.json()["status"] == "Active"


def test_setting_the_same_status_is_a_conflict(api, admin):
    uid = new_user(api, admin).json()["user"]["id"]
    r = api.post(
        f"{V1}/users/{uid}/status", json={"status": "Active", "reason": "x"}, headers=admin
    )
    assert r.status_code == 409


def test_deactivating_a_user_ends_their_sessions_and_blocks_login(
    api, admin, new_client, make_user
):
    make_user("ICN001")
    victim = new_client()
    sign_in(victim, "ICN001")
    uid = victim.get(f"{V1}/auth/me").json()["user"]["id"]
    api.post(
        f"{V1}/users/{uid}/status", json={"status": "Inactive", "reason": "Moved"}, headers=admin
    )
    assert victim.get(f"{V1}/auth/me").status_code == 401
    assert login(new_client(), "ICN001").status_code == 403


def test_last_active_admin_cannot_be_deactivated(api, admin):
    me = api.get(f"{V1}/auth/me").json()["user"]["id"]
    r = api.post(
        f"{V1}/users/{me}/status", json={"status": "Inactive", "reason": "x"}, headers=admin
    )
    assert r.status_code == 409 and error_code(r) == "conflict"
    assert "admin" in r.json()["error"]["message"].lower()


def test_an_admin_can_be_deactivated_when_another_active_admin_exists(api, admin, make_user):
    other = make_user("ADM002", role="admin")
    r = api.post(
        f"{V1}/users/{other}/status", json={"status": "Inactive", "reason": "Left"}, headers=admin
    )
    assert r.status_code == 200


def test_changing_the_last_admins_role_is_blocked(api, admin):
    me = api.get(f"{V1}/auth/me").json()["user"]["id"]
    r = api.patch(f"{V1}/users/{me}", json={"role_id": role_id(api, "icn")}, headers=admin)
    assert r.status_code == 409


def test_reset_password_issues_new_temp_ends_sessions_and_unlocks(
    api, admin, new_client, make_user, owner_engine
):
    make_user("ICN001")
    victim = new_client()
    sign_in(victim, "ICN001")
    uid = victim.get(f"{V1}/auth/me").json()["user"]["id"]
    for _ in range(5):  # lock the account first
        login(new_client(), "ICN001", "WrongPass1")
    r = api.post(f"{V1}/users/{uid}/reset-password", headers=admin)
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    assert r.json()["user"]["must_change_password"] is True
    assert victim.get(f"{V1}/auth/me").status_code == 401  # old session ended
    assert login(new_client(), "ICN001", PASSWORD).status_code == 401  # old password dead
    again = login(new_client(), "ICN001", temp)  # and the lock was cleared
    assert again.status_code == 200 and again.json()["user"]["must_change_password"] is True
    entry = api.get(f"{V1}/audit-log?action=password_reset").json()["items"][0]
    assert temp not in str(entry)


def test_reset_password_for_an_inactive_user_is_a_conflict(api, admin, make_user):
    uid = make_user("OLD001", status="Inactive")
    assert api.post(f"{V1}/users/{uid}/reset-password", headers=admin).status_code == 409
