import uuid

from tests.helpers import V1, error_code, sign_in

DEFAULTS = {
    "admin": {"masters", "users", "ln", "targets", "dash", "reports"},
    "icn": {"ln", "record", "review", "targets", "dash", "alerts", "reports"},
    "qm": {"dash", "alerts", "reports"},
    "link_nurse": {"record", "dash"},
}


def admin_client(api, make_user):
    make_user("ADM001", role="admin")
    return sign_in(api, "ADM001")


def roles_by_key(api):
    return {r["key"]: r for r in api.get(f"{V1}/roles").json()}


def test_permissions_listed_in_matrix_order(api, make_user):
    admin_client(api, make_user)
    codes = [p["code"] for p in api.get(f"{V1}/permissions").json()]
    assert codes == [
        "masters", "users", "ln", "record", "review", "targets", "dash", "alerts", "reports",
    ]  # fmt: skip


def test_default_roles_match_the_brief_matrix(api, make_user):
    admin_client(api, make_user)
    roles = roles_by_key(api)
    assert set(roles) == set(DEFAULTS)
    for key, perms in DEFAULTS.items():
        assert set(roles[key]["permissions"]) == perms, key
        assert roles[key]["is_system"] is True


def test_active_user_counts(api, make_user):
    admin_client(api, make_user)
    make_user("N1", role="link_nurse")
    make_user("N2", role="link_nurse")
    make_user("N3", role="link_nurse", status="Inactive")
    roles = roles_by_key(api)
    assert roles["link_nurse"]["active_user_count"] == 2
    assert roles["admin"]["active_user_count"] == 1


def test_create_role_starts_with_dashboard_only(api, make_user):
    csrf = admin_client(api, make_user)
    r = api.post(f"{V1}/roles", json={"name": "Nursing Superintendent"}, headers=csrf)
    assert r.status_code == 201, r.text
    assert r.json()["permissions"] == ["dash"] and r.json()["is_system"] is False
    dup = api.post(f"{V1}/roles", json={"name": "nursing superintendent"}, headers=csrf)
    assert dup.status_code == 409 and error_code(dup) == "conflict"
    blank = api.post(f"{V1}/roles", json={"name": "  "}, headers=csrf)
    assert blank.status_code == 422
    entry = api.get(f"{V1}/audit-log?action=role_create").json()["items"][0]
    assert "Nursing Superintendent" in entry["summary"]


def test_set_permissions_replaces_the_set_and_is_audited(api, make_user):
    csrf = admin_client(api, make_user)
    qm = roles_by_key(api)["qm"]
    r = api.put(
        f"{V1}/roles/{qm['id']}/permissions",
        json={"permissions": ["dash", "reports", "targets"]},
        headers=csrf,
    )
    assert r.status_code == 200, r.text
    assert set(r.json()["permissions"]) == {"dash", "reports", "targets"}
    entry = api.get(f"{V1}/audit-log?action=permission_change").json()["items"][0]
    assert set(entry["old_values"]["permissions"]) == DEFAULTS["qm"]
    assert set(entry["new_values"]["permissions"]) == {"dash", "reports", "targets"}


def test_permission_changes_apply_immediately_to_signed_in_users(api, new_client, make_user):
    csrf = admin_client(api, make_user)
    make_user("QM001", role="qm")
    qm_client = new_client()
    sign_in(qm_client, "QM001")
    assert "targets" not in qm_client.get(f"{V1}/auth/me").json()["user"]["permissions"]
    api.put(
        f"{V1}/roles/{roles_by_key(api)['qm']['id']}/permissions",
        json={"permissions": ["dash", "targets"]},
        headers=csrf,
    )
    assert "targets" in qm_client.get(f"{V1}/auth/me").json()["user"]["permissions"]


def test_admin_role_always_keeps_users_permission(api, make_user):
    csrf = admin_client(api, make_user)
    admin_role = roles_by_key(api)["admin"]
    r = api.put(
        f"{V1}/roles/{admin_role['id']}/permissions",
        json={"permissions": ["dash", "masters"]},
        headers=csrf,
    )
    assert r.status_code == 409 and error_code(r) == "conflict"
    assert "users" in roles_by_key(api)["admin"]["permissions"]


def test_unknown_permission_code_and_unknown_role(api, make_user):
    csrf = admin_client(api, make_user)
    qm = roles_by_key(api)["qm"]
    bad = api.put(
        f"{V1}/roles/{qm['id']}/permissions", json={"permissions": ["nope"]}, headers=csrf
    )
    assert bad.status_code == 422
    missing = api.put(
        f"{V1}/roles/{uuid.uuid4()}/permissions", json={"permissions": ["dash"]}, headers=csrf
    )
    assert missing.status_code == 404


def test_audit_log_filters_pagination_and_order(api, make_user):
    csrf = admin_client(api, make_user)
    for n in ("Role A", "Role B", "Role C"):
        api.post(f"{V1}/roles", json={"name": n}, headers=csrf)
    page = api.get(f"{V1}/audit-log?action=role_create&page_size=2").json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert "Role C" in page["items"][0]["summary"]  # newest first
    assert api.get(f"{V1}/audit-log?q=role%20b").json()["total"] == 1
    assert api.get(f"{V1}/audit-log?entity=user").json()["total"] == 0
    assert api.get(f"{V1}/audit-log?date_from=2999-01-01").json()["total"] == 0
    me = api.get(f"{V1}/auth/me").json()["user"]["id"]
    assert api.get(f"{V1}/audit-log?actor_id={me}&action=role_create").json()["total"] == 3
