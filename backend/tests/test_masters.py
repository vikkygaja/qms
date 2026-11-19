import uuid

import pytest
from sqlalchemy import text

from tests.helpers import V1, error_code, sign_in

KINDS = ["departments", "wards", "staff-categories"]
ANY_ID = str(uuid.uuid4())

WRITES = [
    ("POST", "/departments", {}),
    ("PATCH", f"/departments/{ANY_ID}", {}),
    ("POST", f"/departments/{ANY_ID}/status", {}),
    ("POST", "/wards", {}),
    ("PATCH", f"/wards/{ANY_ID}", {}),
    ("POST", f"/wards/{ANY_ID}/status", {}),
    ("POST", "/staff-categories", {}),
    ("PATCH", f"/staff-categories/{ANY_ID}", {}),
    ("POST", f"/staff-categories/{ANY_ID}/status", {}),
    ("PUT", "/settings/kpi", {}),
]
READS = [f"/{k}" for k in KINDS] + ["/settings/kpi"]


def call(c, method, path, body=None, headers=None):
    return c.request(method, f"{V1}{path}", json=body, headers=headers)


@pytest.fixture
def admin(api, make_user):
    make_user("ADM001", role="admin")
    return sign_in(api, "ADM001")


def mk_dept(api, admin, name="Critical Care"):
    r = api.post(f"{V1}/departments", json={"name": name}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def mk_ward(api, admin, name="MICU", dept=None, target=65):
    dept = dept or mk_dept(api, admin)
    r = api.post(
        f"{V1}/wards",
        json={"name": name, "department_id": dept["id"], "monthly_target": target},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- access control ----------


@pytest.mark.parametrize(("method", "path", "body"), WRITES)
def test_writes_need_the_masters_permission(api, make_user, method, path, body):
    for role in ("icn", "qm", "link_nurse"):
        make_user(f"U{role}".upper(), role=role)
        csrf = sign_in(api, f"U{role}".upper())
        r = call(api, method, path, body, csrf)
        assert r.status_code == 403, (role, r.text)
        assert error_code(r) == "forbidden"


@pytest.mark.parametrize(("method", "path", "body"), WRITES)
def test_writes_reject_anonymous_users(api, method, path, body):
    assert call(api, method, path, body).status_code == 401


@pytest.mark.parametrize("path", READS)
def test_reads_need_login_but_not_the_masters_permission(api, make_user, path):
    assert call(api, "GET", path).status_code == 401
    make_user("N001", role="link_nurse")
    sign_in(api, "N001")
    assert call(api, "GET", path).status_code == 200


def test_reads_are_blocked_until_a_temporary_password_is_changed(api, make_user):
    make_user("NEW001", role="icn", must_change=True)
    sign_in(api, "NEW001")
    r = call(api, "GET", "/wards")
    assert r.status_code == 403 and error_code(r) == "password_change_required"


# ---------- defaults ----------


def test_default_staff_categories_are_seeded(api, admin):
    items = api.get(f"{V1}/staff-categories").json()["items"]
    assert {(c["name"], c["code"]) for c in items} == {
        ("Doctor", "D"),
        ("Nurse", "N"),
        ("Technician", "T"),
        ("Housekeeping", "H"),
        ("Student", "S"),
        ("Other HCW", "O"),
    }
    assert all(c["status"] == "Active" for c in items)


def test_default_kpi_thresholds(api, admin):
    assert api.get(f"{V1}/settings/kpi").json() == {"green": 90, "amber": 80, "inactive_days": 10}


# ---------- departments ----------


def test_create_department_and_ward_count(api, admin):
    dept = mk_dept(api, admin)
    assert dept["status"] == "Active" and dept["ward_count"] == 0
    mk_ward(api, admin, "MICU", dept)
    mk_ward(api, admin, "SICU", dept)
    listed = api.get(f"{V1}/departments").json()["items"]
    assert listed[0]["ward_count"] == 2


@pytest.mark.parametrize("kind", KINDS)
def test_names_are_unique_case_insensitively(api, admin, kind):
    if kind == "departments":
        body = {"name": "Medicine"}
    elif kind == "wards":
        body = {"name": "Ward 1", "department_id": mk_dept(api, admin)["id"], "monthly_target": 5}
    else:
        body = {"name": "Porter", "code": "P"}
    assert api.post(f"{V1}/{kind}", json=body, headers=admin).status_code == 201
    dup = api.post(f"{V1}/{kind}", json=body | {"name": body["name"].upper()}, headers=admin)
    assert dup.status_code == 409 and error_code(dup) == "conflict"
    assert dup.json()["error"]["message"] == "That name already exists."


def test_department_validation(api, admin):
    r = api.post(f"{V1}/departments", json={"name": "  "}, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "name"
    r = api.post(f"{V1}/departments", json={"name": "x" * 101}, headers=admin)
    assert r.status_code == 422


def test_rename_department(api, admin):
    dept = mk_dept(api, admin)
    r = api.patch(f"{V1}/departments/{dept['id']}", json={"name": "ICU"}, headers=admin)
    assert r.status_code == 200 and r.json()["name"] == "ICU"
    entry = api.get(f"{V1}/audit-log?entity=department&action=update").json()["items"][0]
    assert entry["old_values"]["name"] == "Critical Care" and entry["new_values"]["name"] == "ICU"


# ---------- wards ----------


def test_create_ward(api, admin):
    ward = mk_ward(api, admin, "MICU", target=65)
    assert ward["monthly_target"] == 65 and ward["status"] == "Active"
    assert ward["department"]["name"] == "Critical Care"
    entry = api.get(f"{V1}/audit-log?entity=ward&action=create").json()["items"][0]
    assert "MICU" in entry["summary"] and entry["actor"]["employee_id"] == "ADM001"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"name": ""}, "name"),
        ({"monthly_target": -1}, "monthly_target"),
        ({"monthly_target": 100001}, "monthly_target"),
        ({"monthly_target": "abc"}, "monthly_target"),
        ({"department_id": "not-a-uuid"}, "department_id"),
    ],
)
def test_ward_validation(api, admin, override, field):
    dept = mk_dept(api, admin)
    body = {"name": "W", "department_id": dept["id"], "monthly_target": 10} | override
    r = api.post(f"{V1}/wards", json=body, headers=admin)
    assert r.status_code == 422
    assert field in [d["field"] for d in r.json()["error"]["details"]]


def test_ward_needs_an_existing_active_department(api, admin):
    body = {"name": "W", "department_id": str(uuid.uuid4()), "monthly_target": 10}
    assert api.post(f"{V1}/wards", json=body, headers=admin).status_code == 422
    dept = mk_dept(api, admin)
    api.post(
        f"{V1}/departments/{dept['id']}/status",
        json={"status": "Inactive", "reason": "Closed"},
        headers=admin,
    )
    body["department_id"] = dept["id"]
    r = api.post(f"{V1}/wards", json=body, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "department_id"


def test_update_ward_records_old_and_new_values(api, admin):
    ward = mk_ward(api, admin)
    other = mk_dept(api, admin, "Surgery")
    r = api.patch(
        f"{V1}/wards/{ward['id']}",
        json={"monthly_target": 80, "department_id": other["id"]},
        headers=admin,
    )
    assert r.status_code == 200
    assert r.json()["monthly_target"] == 80 and r.json()["department"]["name"] == "Surgery"
    entry = api.get(f"{V1}/audit-log?entity=ward&action=update").json()["items"][0]
    assert (
        entry["old_values"]["monthly_target"] == 65 and entry["new_values"]["monthly_target"] == 80
    )


def test_patch_with_no_changes_writes_no_audit(api, admin):
    ward = mk_ward(api, admin)
    api.patch(f"{V1}/wards/{ward['id']}", json={"monthly_target": 65}, headers=admin)
    assert api.get(f"{V1}/audit-log?entity=ward&action=update").json()["total"] == 0


def test_unknown_ids_are_404(api, admin):
    for kind in KINDS:
        assert api.patch(f"{V1}/{kind}/{uuid.uuid4()}", json={}, headers=admin).status_code == 404
        r = api.post(
            f"{V1}/{kind}/{uuid.uuid4()}/status",
            json={"status": "Inactive", "reason": "x"},
            headers=admin,
        )
        assert r.status_code == 404


# ---------- staff categories ----------


def test_category_code_rules(api, admin):
    r = api.post(f"{V1}/staff-categories", json={"name": "Porter", "code": "p"}, headers=admin)
    assert r.status_code == 201 and r.json()["code"] == "P"  # stored upper-case
    for bad in ("", "ABCD", "a!", " "):
        r = api.post(f"{V1}/staff-categories", json={"name": f"X{bad}", "code": bad}, headers=admin)
        assert r.status_code == 422, bad
    dup = api.post(f"{V1}/staff-categories", json={"name": "Other", "code": "d"}, headers=admin)
    assert dup.status_code == 409 and "code" in dup.json()["error"]["message"].lower()


# ---------- status ----------


@pytest.mark.parametrize("kind", KINDS)
def test_status_change_needs_a_reason_and_is_recorded(api, admin, owner_engine, kind):
    if kind == "departments":
        item = mk_dept(api, admin)
    elif kind == "wards":
        item = mk_ward(api, admin)
    else:
        item = api.post(
            f"{V1}/staff-categories", json={"name": "Porter", "code": "P"}, headers=admin
        ).json()
    url = f"{V1}/{kind}/{item['id']}/status"
    r = api.post(url, json={"status": "Inactive", "reason": "  "}, headers=admin)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "reason"
    r = api.post(url, json={"status": "Inactive", "reason": "Merged"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "Inactive"
    assert (
        api.post(url, json={"status": "Inactive", "reason": "again"}, headers=admin).status_code
        == 409
    )
    with owner_engine.connect() as c:
        row = c.execute(
            text("SELECT old_status, new_status, reason FROM status_history WHERE entity_id=:i"),
            {"i": item["id"]},
        ).one()
    assert tuple(row) == ("Active", "Inactive", "Merged")
    entry = api.get(f"{V1}/audit-log?action=status_change").json()["items"][0]
    assert "Merged" in entry["summary"]
    r = api.post(url, json={"status": "Active", "reason": "Reopened"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "Active"


def test_inactive_items_are_hidden_from_active_lists_but_kept(api, admin):
    ward = mk_ward(api, admin)
    api.post(
        f"{V1}/wards/{ward['id']}/status",
        json={"status": "Inactive", "reason": "Closed"},
        headers=admin,
    )
    assert api.get(f"{V1}/wards?status=Active").json()["total"] == 0
    assert api.get(f"{V1}/wards?status=Inactive").json()["total"] == 1
    assert api.get(f"{V1}/wards").json()["total"] == 1  # no filter: everything is kept


def test_list_search_and_pagination(api, admin):
    dept = mk_dept(api, admin)
    for n in ("Ward A", "Ward B", "Ward C", "OPD"):
        mk_ward(api, admin, n, dept)
    assert [w["name"] for w in api.get(f"{V1}/wards?q=ward").json()["items"]] == [
        "Ward A",
        "Ward B",
        "Ward C",
    ]
    page = api.get(f"{V1}/wards?page=2&page_size=3").json()
    assert page["total"] == 4 and [w["name"] for w in page["items"]] == ["Ward C"]
    assert api.get(f"{V1}/wards?page_size=501").status_code == 422


# ---------- KPI thresholds ----------


def test_update_kpi_thresholds_is_audited(api, admin):
    r = api.put(
        f"{V1}/settings/kpi", json={"green": 95, "amber": 85, "inactive_days": 7}, headers=admin
    )
    assert r.status_code == 200 and r.json() == {"green": 95, "amber": 85, "inactive_days": 7}
    assert api.get(f"{V1}/settings/kpi").json()["green"] == 95
    entry = api.get(f"{V1}/audit-log?entity=setting").json()["items"][0]
    assert entry["old_values"]["green"] == 90 and entry["new_values"]["green"] == 95


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"green": 80, "amber": 80, "inactive_days": 10}, "amber"),  # amber must be below green
        ({"green": 70, "amber": 80, "inactive_days": 10}, "amber"),
        ({"green": 101, "amber": 80, "inactive_days": 10}, "green"),
        ({"green": 90, "amber": 0, "inactive_days": 10}, "amber"),
        ({"green": 90, "amber": 80, "inactive_days": 0}, "inactive_days"),
        ({"green": 90, "amber": 80, "inactive_days": 366}, "inactive_days"),
    ],
)
def test_kpi_validation(api, admin, body, field):
    r = api.put(f"{V1}/settings/kpi", json=body, headers=admin)
    assert r.status_code == 422
    assert field in [d["field"] for d in r.json()["error"]["details"]]
    assert api.get(f"{V1}/settings/kpi").json()["green"] == 90  # unchanged
