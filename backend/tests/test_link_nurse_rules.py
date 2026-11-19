"""Rules that tie link nurses to wards and the Users API."""

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.masters.models import Department, Ward
from tests.helpers import V1, error_code, sign_in


@pytest.fixture
def setup(api, make_user, owner_engine, tenant_id):
    with Session(owner_engine) as s:
        dept = Department(tenant_id=tenant_id, name="Critical Care")
        s.add(dept)
        s.flush()
        micu = Ward(tenant_id=tenant_id, name="MICU", department_id=dept.id, monthly_target=65)
        sicu = Ward(tenant_id=tenant_id, name="SICU", department_id=dept.id, monthly_target=65)
        s.add_all([micu, sicu])
        s.commit()
        ids = {"dept": str(dept.id), "MICU": str(micu.id), "SICU": str(sicu.id)}
    make_user("ADM001", role="admin")
    make_user("ICN001", role="icn")
    admin = sign_in(api, "ADM001")
    return ids, admin


def nurse_via_icn(new_client, ids, employee_id="SN1001", wards=("MICU",)):
    c = new_client()
    icn = sign_in(c, "ICN001")
    r = c.post(
        f"{V1}/link-nurses",
        json={
            "employee_id": employee_id,
            "full_name": "Priya R.",
            "designation": "Sister",
            "department_id": ids["dept"],
            "mobile": "9840010000",
            "link_nurse_from": "2026-01-05",
            "ward_ids": [ids[w] for w in wards],
        },
        headers=icn,
    )
    assert r.status_code == 201, r.text
    return c, icn, r.json()["link_nurse"]


def test_ward_counts_appear_on_wards(api, setup, new_client):
    ids, admin = setup
    nurse_via_icn(new_client, ids, "SN1001", ("MICU", "SICU"))
    nurse_via_icn(new_client, ids, "SN1002", ("MICU",))
    wards = {w["name"]: w for w in api.get(f"{V1}/wards").json()["items"]}
    assert wards["MICU"]["link_nurse_count"] == 2 and wards["SICU"]["link_nurse_count"] == 1


def test_a_ward_with_link_nurses_cannot_be_made_inactive(api, setup, new_client):
    ids, admin = setup
    nurse_via_icn(new_client, ids, "SN1001", ("MICU",))
    nurse_via_icn(new_client, ids, "SN1002", ("MICU",))
    r = api.post(
        f"{V1}/wards/{ids['MICU']}/status",
        json={"status": "Inactive", "reason": "Closed"},
        headers=admin,
    )
    assert r.status_code == 409 and error_code(r) == "conflict"
    assert r.json()["error"]["message"] == "Move this ward's link nurses first (2 assigned)."
    assert (
        next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "MICU")["status"]
        == "Active"
    )


def test_ward_can_be_made_inactive_after_its_nurses_move_or_leave(api, setup, new_client):
    ids, admin = setup
    c, icn, nurse = nurse_via_icn(new_client, ids, "SN1001", ("MICU",))
    c.put(f"{V1}/link-nurses/{nurse['id']}/wards", json={"ward_ids": [ids["SICU"]]}, headers=icn)
    r = api.post(
        f"{V1}/wards/{ids['MICU']}/status",
        json={"status": "Inactive", "reason": "Closed"},
        headers=admin,
    )
    assert r.status_code == 200 and r.json()["link_nurse_count"] == 0
    # inactive nurses no longer count either
    c.post(
        f"{V1}/link-nurses/{nurse['id']}/status",
        json={"status": "Inactive", "reason": "Left"},
        headers=icn,
    )
    assert (
        api.post(
            f"{V1}/wards/{ids['SICU']}/status",
            json={"status": "Inactive", "reason": "Closed"},
            headers=admin,
        ).status_code
        == 200
    )


def test_ward_endpoints_report_link_nurse_count(api, setup, new_client):
    ids, admin = setup
    nurse_via_icn(new_client, ids, "SN1001", ("SICU",))
    created = api.post(
        f"{V1}/wards",
        json={"name": "New", "department_id": ids["dept"], "monthly_target": 5},
        headers=admin,
    ).json()
    assert created["link_nurse_count"] == 0
    patched = api.patch(f"{V1}/wards/{ids['SICU']}", json={"monthly_target": 70}, headers=admin)
    assert patched.json()["link_nurse_count"] == 1


def test_users_api_refuses_status_and_password_reset_for_link_nurses(api, setup, new_client):
    ids, admin = setup
    _, _, nurse = nurse_via_icn(new_client, ids)
    for path, payload in [
        (f"/users/{nurse['id']}/status", {"status": "Inactive", "reason": "x"}),
        (f"/users/{nurse['id']}/reset-password", None),
    ]:
        r = api.post(f"{V1}{path}", json=payload, headers=admin)
        assert r.status_code == 409 and error_code(r) == "conflict"
        assert "Link nurses page" in r.json()["error"]["message"]
    got = api.get(f"{V1}/users/{nurse['id']}").json()  # still listed, read-only
    assert got["role"]["key"] == "link_nurse" and got["status"] == "Active"


def test_current_assignment_index_blocks_duplicates_at_the_database(setup, owner_engine, tenant_id):
    ids, _ = setup
    with owner_engine.begin() as c:
        uid = c.execute(text("SELECT id FROM app_user WHERE employee_id='ICN001'")).scalar()
        row = {"t": tenant_id, "u": uid, "w": ids["MICU"]}
        sql = (
            "INSERT INTO ward_assignment (tenant_id, user_id, ward_id, from_date)"
            " VALUES (:t, :u, :w, '2026-01-01')"
        )
        c.execute(text(sql), row)
    with pytest.raises(Exception) as exc:  # noqa: PT011
        with owner_engine.begin() as c:
            c.execute(text(sql), row)  # a second CURRENT row for the same nurse and ward
    assert "unique" in str(exc.value).lower()
    with pytest.raises(Exception):  # noqa: B017, PT011
        with owner_engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO ward_assignment (tenant_id, user_id, ward_id, from_date, to_date)"
                    " VALUES (:t, :u, :w, '2026-02-01', '2026-01-01')"
                ),
                {"t": tenant_id, "u": uid, "w": ids["SICU"]},
            )
