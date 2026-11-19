import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.masters.models import Department, Ward
from tests.helpers import V1, error_code, login, sign_in

ANY_ID = str(uuid.uuid4())
GUARDED = [
    ("GET", "/link-nurses", None),
    ("POST", "/link-nurses", {}),
    ("GET", f"/link-nurses/{ANY_ID}", None),
    ("PATCH", f"/link-nurses/{ANY_ID}", {}),
    ("PUT", f"/link-nurses/{ANY_ID}/wards", {}),
    ("POST", f"/link-nurses/{ANY_ID}/status", {}),
    ("POST", f"/link-nurses/{ANY_ID}/reset-password", None),
    ("GET", "/link-nurses/recent-changes", None),
]


def call(c, method, path, body=None, headers=None):
    return c.request(method, f"{V1}{path}", json=body, headers=headers)


@pytest.fixture
def hospital(owner_engine, tenant_id):
    """Two departments and four wards, inserted directly (dummy data)."""
    with Session(owner_engine) as s:
        cc = Department(tenant_id=tenant_id, name="Critical Care")
        surg = Department(tenant_id=tenant_id, name="Surgery")
        s.add_all([cc, surg])
        s.flush()
        wards = {
            n: Ward(tenant_id=tenant_id, name=n, department_id=d.id, monthly_target=50)
            for n, d in [("MICU", cc), ("SICU", cc), ("Ward 2", surg), ("OPD", surg)]
        }
        s.add_all(wards.values())
        s.commit()
        return {
            "cc": str(cc.id),
            "surg": str(surg.id),
            **{n: str(w.id) for n, w in wards.items()},
        }


@pytest.fixture
def icn(api, make_user):
    make_user("ICN001", role="icn", full_name="Sr. Mary J.")
    return sign_in(api, "ICN001")


def body(h, **kw):
    return {
        "employee_id": "sn1001",
        "full_name": "Priya R.",
        "designation": "Sister",
        "department_id": h["cc"],
        "mobile": "9840010000",
        "email": "",
        "link_nurse_from": "2026-01-05",
        "who5_training_date": "2026-01-10",
        "ward_ids": [h["MICU"], h["SICU"]],
    } | kw


def create(api, icn, h, **kw):
    r = api.post(f"{V1}/link-nurses", json=body(h, **kw), headers=icn)
    assert r.status_code == 201, r.text
    return r.json()


def ward_names(nurse):
    return sorted(w["name"] for w in nurse["wards"])


# ---------- access control ----------


@pytest.mark.parametrize(("method", "path", "payload"), GUARDED)
def test_anonymous_requests_are_rejected(api, method, path, payload):
    assert call(api, method, path, payload).status_code == 401


@pytest.mark.parametrize("role", ["qm", "link_nurse"])
@pytest.mark.parametrize(("method", "path", "payload"), GUARDED)
def test_roles_without_ln_permission_are_rejected(api, make_user, role, method, path, payload):
    make_user("X001", role=role)
    csrf = sign_in(api, "X001")
    r = call(api, method, path, payload, csrf)
    assert r.status_code == 403, r.text
    assert error_code(r) == "forbidden"


@pytest.mark.parametrize("role", ["admin", "icn"])
def test_admin_and_icn_hold_the_ln_permission_by_default(api, make_user, role):
    make_user("X001", role=role)
    sign_in(api, "X001")
    assert api.get(f"{V1}/link-nurses").status_code == 200


def test_permission_follows_the_role_matrix_not_a_hard_coded_role(api, make_user, new_client):
    """Taking `ln` away from the ICN role immediately blocks the ICN."""
    make_user("ADM001", role="admin")
    make_user("ICN001", role="icn")
    admin = sign_in(api, "ADM001")
    icn_client = new_client()
    sign_in(icn_client, "ICN001")
    assert icn_client.get(f"{V1}/link-nurses").status_code == 200
    roles = {r["key"]: r for r in api.get(f"{V1}/roles").json()}
    keep = [p for p in roles["icn"]["permissions"] if p != "ln"]
    api.put(
        f"{V1}/roles/{roles['icn']['id']}/permissions", json={"permissions": keep}, headers=admin
    )
    assert icn_client.get(f"{V1}/link-nurses").status_code == 403


# ---------- create ----------


def test_create_makes_the_user_login_and_assignments_in_one_step(api, icn, hospital):
    out = create(api, icn, hospital)
    nurse, temp = out["link_nurse"], out["temporary_password"]
    assert nurse["employee_id"] == "SN1001" and nurse["status"] == "Active"
    assert nurse["designation"] == "Sister" and nurse["department"]["name"] == "Critical Care"
    assert nurse["link_nurse_from"] == "2026-01-05" and nurse["who5_training_date"] == "2026-01-10"
    assert ward_names(nurse) == ["MICU", "SICU"]
    assert nurse["must_change_password"] is True
    assert {a["from_date"] for a in nurse["assignments"]} == {"2026-01-05"}
    assert all(a["to_date"] is None for a in nurse["assignments"])
    assert nurse["sessions_this_month"] == 0 and nurse["last_entry_date"] is None
    assert nurse["no_entry_flag"] is False
    assert len(temp) >= 8


def test_new_link_nurse_can_sign_in_with_the_temporary_password(icn, api, hospital, new_client):
    out = create(api, icn, hospital)
    nurse_client = new_client()
    r = login(nurse_client, "sn1001", out["temporary_password"])
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["role"]["key"] == "link_nurse" and user["must_change_password"] is True
    assert set(user["permissions"]) == {"record", "dash"}
    assert out["temporary_password"] not in api.get(f"{V1}/link-nurses").text


def test_create_is_audited_without_the_password(api, icn, hospital):
    out = create(api, icn, hospital)
    entries = api.get(f"{V1}/link-nurses/recent-changes").json()
    actions = {e["action"] for e in entries}
    assert {"create", "ward_change"} <= actions
    assert out["temporary_password"] not in str(entries)
    assert all(e["entity"] == "link_nurse" for e in entries)
    assert any("MICU" in e["summary"] for e in entries)


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"employee_id": "ab"}, "employee_id"),
        ({"employee_id": "bad id"}, "employee_id"),
        ({"full_name": ""}, "full_name"),
        ({"designation": " "}, "designation"),
        ({"mobile": "123"}, "mobile"),
        ({"email": "nope"}, "email"),
        ({"link_nurse_from": "05-01-2026"}, "link_nurse_from"),
        ({"link_nurse_from": ""}, "link_nurse_from"),
        ({"who5_training_date": "x"}, "who5_training_date"),
        ({"department_id": "x"}, "department_id"),
        ({"ward_ids": []}, "ward_ids"),
        ({"ward_ids": ["x"]}, "ward_ids"),
    ],
)
def test_create_validation(api, icn, hospital, override, field):
    r = api.post(f"{V1}/link-nurses", json=body(hospital, **override), headers=icn)
    assert r.status_code == 422, r.text
    assert field in [d["field"] for d in r.json()["error"]["details"]]


def test_create_needs_active_department_and_active_existing_wards(api, icn, hospital, owner_engine):
    r = api.post(
        f"{V1}/link-nurses",
        json=body(hospital, department_id=str(uuid.uuid4())),
        headers=icn,
    )
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "department_id"
    r = api.post(
        f"{V1}/link-nurses", json=body(hospital, ward_ids=[str(uuid.uuid4())]), headers=icn
    )
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "ward_ids"
    with owner_engine.begin() as c:
        c.execute(text("UPDATE ward SET status='Inactive' WHERE name='OPD'"))
    r = api.post(f"{V1}/link-nurses", json=body(hospital, ward_ids=[hospital["OPD"]]), headers=icn)
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "ward_ids"
    assert api.get(f"{V1}/link-nurses").json()["total"] == 0  # nothing half-created


def test_duplicate_employee_id_across_all_users(api, icn, hospital):
    create(api, icn, hospital)
    r = api.post(f"{V1}/link-nurses", json=body(hospital, employee_id="SN1001"), headers=icn)
    assert r.status_code == 409 and "already" in r.json()["error"]["message"]
    r = api.post(f"{V1}/link-nurses", json=body(hospital, employee_id="icn001"), headers=icn)
    assert r.status_code == 409  # collides with the ICN's own login


# ---------- list and detail ----------


def test_list_filters_search_sort_and_paging(api, icn, hospital):
    create(api, icn, hospital)
    create(
        api,
        icn,
        hospital,
        employee_id="SN1002",
        full_name="Kavitha S.",
        mobile="9840010001",
        ward_ids=[hospital["Ward 2"]],
        department_id=hospital["surg"],
    )
    create(
        api,
        icn,
        hospital,
        employee_id="SN1003",
        full_name="Anitha M.",
        mobile="9840010002",
        ward_ids=[hospital["MICU"]],
    )
    assert api.get(f"{V1}/link-nurses").json()["total"] == 3
    names = lambda r: [n["full_name"] for n in r.json()["items"]]  # noqa: E731
    assert names(api.get(f"{V1}/link-nurses?sort=name")) == ["Anitha M.", "Kavitha S.", "Priya R."]
    assert names(api.get(f"{V1}/link-nurses?sort=name&order=desc"))[0] == "Priya R."
    assert names(api.get(f"{V1}/link-nurses?sort=employee_id")) == [
        "Priya R.",
        "Kavitha S.",
        "Anitha M.",
    ]
    assert names(api.get(f"{V1}/link-nurses?q=kav")) == ["Kavitha S."]
    assert names(api.get(f"{V1}/link-nurses?q=sn1003")) == ["Anitha M."]
    assert names(api.get(f"{V1}/link-nurses?ward_id={hospital['MICU']}")) == [
        "Anitha M.",
        "Priya R.",
    ]
    assert names(api.get(f"{V1}/link-nurses?ward_id={hospital['Ward 2']}")) == ["Kavitha S."]
    page = api.get(f"{V1}/link-nurses?page=2&page_size=2").json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert api.get(f"{V1}/link-nurses?sort=bogus").status_code == 422
    assert api.get(f"{V1}/link-nurses?page_size=201").status_code == 422


def test_list_does_not_include_other_kinds_of_users(api, icn, hospital):
    create(api, icn, hospital)
    assert [n["employee_id"] for n in api.get(f"{V1}/link-nurses").json()["items"]] == ["SN1001"]


def test_detail_and_404_for_users_who_are_not_link_nurses(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    assert api.get(f"{V1}/link-nurses/{nurse['id']}").json()["employee_id"] == "SN1001"
    me = api.get(f"{V1}/auth/me").json()["user"]["id"]  # the ICN is a user but not a link nurse
    assert api.get(f"{V1}/link-nurses/{me}").status_code == 404
    assert api.get(f"{V1}/link-nurses/{uuid.uuid4()}").status_code == 404


# ---------- edit details ----------


def test_update_details_with_audit_and_immutable_employee_id(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    r = api.patch(
        f"{V1}/link-nurses/{nurse['id']}",
        json={
            "full_name": "Priya Raman",
            "designation": "Ward In-charge",
            "department_id": hospital["surg"],
            "mobile": "9840099999",
            "who5_training_date": None,
        },
        headers=icn,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["full_name"] == "Priya Raman" and out["department"]["name"] == "Surgery"
    assert out["who5_training_date"] is None
    entry = next(
        e for e in api.get(f"{V1}/link-nurses/recent-changes").json() if e["action"] == "update"
    )
    assert entry["old_values"]["full_name"] == "Priya R."
    assert entry["new_values"]["designation"] == "Ward In-charge"
    bad = api.patch(f"{V1}/link-nurses/{nurse['id']}", json={"employee_id": "HACK"}, headers=icn)
    assert bad.status_code == 422
    bad = api.patch(f"{V1}/link-nurses/{nurse['id']}", json={"mobile": "1"}, headers=icn)
    assert bad.status_code == 422


def test_update_with_no_changes_is_not_audited(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    api.patch(f"{V1}/link-nurses/{nurse['id']}", json={"full_name": "Priya R."}, headers=icn)
    updates = [
        e for e in api.get(f"{V1}/link-nurses/recent-changes").json() if e["action"] == "update"
    ]
    assert updates == []


# ---------- ward assignment history ----------


def put_wards(api, icn, nurse_id, ids):
    return api.put(f"{V1}/link-nurses/{nurse_id}/wards", json={"ward_ids": ids}, headers=icn)


def test_adding_and_removing_wards_keeps_history(api, icn, hospital, clock):
    nurse = create(api, icn, hospital)["link_nurse"]  # MICU + SICU from 2026-01-05
    r = put_wards(api, icn, nurse["id"], [hospital["MICU"], hospital["Ward 2"]])
    assert r.status_code == 200, r.text
    out = r.json()
    assert ward_names(out) == ["MICU", "Ward 2"]
    by_ward = {a["ward"]["name"]: a for a in out["assignments"]}
    assert by_ward["SICU"]["to_date"] == "2026-11-19"  # removed today
    assert by_ward["Ward 2"]["from_date"] == "2026-11-19" and by_ward["Ward 2"]["to_date"] is None
    assert by_ward["MICU"]["from_date"] == "2026-01-05"  # untouched
    assert len(out["assignments"]) == 3
    # re-adding a removed ward starts a NEW row (history is never rewritten)
    out = put_wards(
        api, icn, nurse["id"], [hospital["MICU"], hospital["Ward 2"], hospital["SICU"]]
    ).json()
    sicu = [a for a in out["assignments"] if a["ward"]["name"] == "SICU"]
    assert len(sicu) == 2 and sorted(a["to_date"] is None for a in sicu) == [False, True]


def test_today_means_the_kolkata_calendar_date(api, icn, hospital, clock):
    nurse = create(api, icn, hospital)["link_nurse"]
    clock.advance(hours=10)  # 20:00 UTC on 19 Nov is already 20 Nov in India
    icn = sign_in(api, "ICN001")  # the 10-hour jump ended the idle session
    out = put_wards(api, icn, nurse["id"], [hospital["MICU"]]).json()
    sicu = next(a for a in out["assignments"] if a["ward"]["name"] == "SICU")
    assert sicu["to_date"] == "2026-11-20"


def test_ward_change_is_audited_and_unchanged_set_is_not(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    before = len(api.get(f"{V1}/link-nurses/recent-changes?limit=50").json())
    assert put_wards(api, icn, nurse["id"], [hospital["MICU"], hospital["SICU"]]).status_code == 200
    assert len(api.get(f"{V1}/link-nurses/recent-changes?limit=50").json()) == before  # no change
    put_wards(api, icn, nurse["id"], [hospital["MICU"], hospital["OPD"]])
    top = api.get(f"{V1}/link-nurses/recent-changes").json()[0]
    assert top["action"] == "ward_change"
    assert "OPD" in top["summary"] and "SICU" in top["summary"] and "SN1001" in top["summary"]


def test_a_nurse_must_keep_at_least_one_ward(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    r = put_wards(api, icn, nurse["id"], [])
    assert r.status_code == 422
    assert "inactive" in r.json()["error"]["details"][0]["message"].lower()
    assert ward_names(api.get(f"{V1}/link-nurses/{nurse['id']}").json()) == ["MICU", "SICU"]


def test_only_active_existing_wards_can_be_assigned(api, icn, hospital, owner_engine):
    nurse = create(api, icn, hospital)["link_nurse"]
    assert put_wards(api, icn, nurse["id"], [str(uuid.uuid4())]).status_code == 422
    with owner_engine.begin() as c:
        c.execute(text("UPDATE ward SET status='Inactive' WHERE name='OPD'"))
    assert put_wards(api, icn, nurse["id"], [hospital["OPD"]]).status_code == 422
    # a ward that went inactive keeps its current nurses until they are moved (not an error here)
    assert put_wards(api, icn, nurse["id"], [hospital["MICU"]]).status_code == 200


def test_cannot_change_wards_of_an_inactive_nurse(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    api.post(
        f"{V1}/link-nurses/{nurse['id']}/status",
        json={"status": "Inactive", "reason": "Left"},
        headers=icn,
    )
    r = put_wards(api, icn, nurse["id"], [hospital["MICU"]])
    assert r.status_code == 409 and "active" in r.json()["error"]["message"].lower()


# ---------- status ----------


def set_status(api, icn, nurse_id, status, reason="Moved to OT", **kw):
    return api.post(
        f"{V1}/link-nurses/{nurse_id}/status",
        json={"status": status, "reason": reason, **kw},
        headers=icn,
    )


def test_inactivating_needs_a_reason_and_a_valid_date(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    r = set_status(api, icn, nurse["id"], "Inactive", reason=" ")
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "reason"
    r = set_status(api, icn, nurse["id"], "Inactive", effective_date="2999-01-01")
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "effective_date"
    r = set_status(api, icn, nurse["id"], "Inactive", effective_date="soon")
    assert r.status_code == 422
    assert api.get(f"{V1}/link-nurses/{nurse['id']}").json()["status"] == "Active"


def test_inactivating_ends_assignments_sessions_and_blocks_login(api, icn, hospital, new_client):
    out = create(api, icn, hospital)
    nurse, temp = out["link_nurse"], out["temporary_password"]
    nurse_client = new_client()
    assert login(nurse_client, "SN1001", temp).status_code == 200
    r = set_status(api, icn, nurse["id"], "Inactive", effective_date="2026-11-10")
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "Inactive" and done["wards"] == []
    assert {a["to_date"] for a in done["assignments"]} == {"2026-11-10"}
    hist = done["status_history"][0]
    assert (hist["old_status"], hist["new_status"]) == ("Active", "Inactive")
    assert hist["reason"] == "Moved to OT" and hist["effective_date"] == "2026-11-10"
    assert hist["changed_by"]["full_name"] == "Sr. Mary J."
    assert nurse_client.get(f"{V1}/auth/me").status_code == 401  # session ended
    blocked = login(new_client(), "SN1001", temp)
    assert blocked.status_code == 403 and error_code(blocked) == "inactive_account"
    entry = api.get(f"{V1}/link-nurses/recent-changes").json()[0]
    assert entry["action"] == "status_change" and "Moved to OT" in entry["summary"]


def test_effective_date_before_an_assignment_started_is_clamped(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]  # assignments start 2026-01-05
    out = set_status(api, icn, nurse["id"], "Inactive", effective_date="2025-12-01").json()
    assert {a["to_date"] for a in out["assignments"]} == {"2026-01-05"}  # never before from_date


def test_reactivating_does_not_restore_wards(api, icn, hospital, clock):
    nurse = create(api, icn, hospital)["link_nurse"]
    set_status(api, icn, nurse["id"], "Inactive")
    clock.advance(minutes=5)
    out = set_status(api, icn, nurse["id"], "Active", reason="Back from leave").json()
    assert out["status"] == "Active" and out["wards"] == []
    assert len(out["status_history"]) == 2 and out["status_history"][0]["new_status"] == "Active"
    # wards can now be assigned again
    assert put_wards(api, icn, nurse["id"], [hospital["Ward 2"]]).status_code == 200


def test_setting_the_same_status_is_a_conflict(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    assert set_status(api, icn, nurse["id"], "Active").status_code == 409


# ---------- reset password ----------


def test_reset_password_gives_a_new_temporary_password(api, icn, hospital, new_client):
    out = create(api, icn, hospital)
    nurse = out["link_nurse"]
    nc = new_client()
    first = login(nc, "SN1001", out["temporary_password"])
    assert first.status_code == 200
    for _ in range(5):  # lock the account
        login(new_client(), "SN1001", "WrongPass1")
    r = api.post(f"{V1}/link-nurses/{nurse['id']}/reset-password", headers=icn)
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    assert r.json()["link_nurse"]["must_change_password"] is True
    assert nc.get(f"{V1}/auth/me").status_code == 401
    assert login(new_client(), "SN1001", out["temporary_password"]).status_code == 401
    assert login(new_client(), "SN1001", temp).status_code == 200
    entry = next(
        e
        for e in api.get(f"{V1}/link-nurses/recent-changes").json()
        if e["action"] == "password_reset"
    )
    assert temp not in str(entry)


def test_reset_password_for_an_inactive_nurse_is_a_conflict(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    set_status(api, icn, nurse["id"], "Inactive")
    assert (
        api.post(f"{V1}/link-nurses/{nurse['id']}/reset-password", headers=icn).status_code == 409
    )


# ---------- recent changes ----------


def test_recent_changes_are_newest_first_limited_and_only_about_link_nurses(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    put_wards(api, icn, nurse["id"], [hospital["MICU"]])
    set_status(api, icn, nurse["id"], "Inactive")
    recent = api.get(f"{V1}/link-nurses/recent-changes").json()
    assert [e["action"] for e in recent][:2] == ["status_change", "ward_change"]
    assert len(api.get(f"{V1}/link-nurses/recent-changes?limit=2").json()) == 2
    assert api.get(f"{V1}/link-nurses/recent-changes?limit=0").status_code == 422
    assert api.get(f"{V1}/link-nurses/recent-changes?limit=51").status_code == 422


def test_assignment_dates_are_real_dates(api, icn, hospital):
    nurse = create(api, icn, hospital)["link_nurse"]
    assert date.fromisoformat(nurse["assignments"][0]["from_date"]) == date(2026, 1, 5)
