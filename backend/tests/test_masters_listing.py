"""Sorting, department filter and summary for the Masters list pages (large hospitals)."""

import pytest

from tests.helpers import V1, sign_in


@pytest.fixture
def admin(api, make_user):
    make_user("ADM001", role="admin")
    return sign_in(api, "ADM001")


def dept(api, admin, name):
    return api.post(f"{V1}/departments", json={"name": name}, headers=admin).json()


def ward(api, admin, name, d, target):
    r = api.post(
        f"{V1}/wards",
        json={"name": name, "department_id": d["id"], "monthly_target": target},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def hospital(api, admin):
    cc, surg, med = (
        dept(api, admin, "Critical Care"),
        dept(api, admin, "Surgery"),
        dept(api, admin, "Medicine"),
    )
    wards = [
        ward(api, admin, "MICU", cc, 65),
        ward(api, admin, "SICU", cc, 65),
        ward(api, admin, "Ward 2", surg, 50),
        ward(api, admin, "Ward 1", med, 50),
        ward(api, admin, "OPD", med, 10),
    ]
    return {"cc": cc, "surg": surg, "med": med, "wards": wards}


def names(r):
    return [i["name"] for i in r.json()["items"]]


# ---------- sorting ----------


def test_wards_sort_by_name_is_default_and_case_insensitive(api, hospital):
    assert names(api.get(f"{V1}/wards")) == ["MICU", "OPD", "SICU", "Ward 1", "Ward 2"]
    assert names(api.get(f"{V1}/wards?order=desc")) == ["Ward 2", "Ward 1", "SICU", "OPD", "MICU"]


def test_wards_sort_by_target_ties_broken_by_name(api, hospital):
    assert names(api.get(f"{V1}/wards?sort=monthly_target&order=desc")) == [
        "MICU",
        "SICU",
        "Ward 1",
        "Ward 2",
        "OPD",
    ]
    assert names(api.get(f"{V1}/wards?sort=monthly_target"))[0] == "OPD"


def test_wards_sort_by_department_and_status(api, admin, hospital):
    assert names(api.get(f"{V1}/wards?sort=department")) == [
        "MICU",  # Critical Care
        "SICU",
        "OPD",  # Medicine
        "Ward 1",
        "Ward 2",  # Surgery
    ]
    opd = next(w for w in hospital["wards"] if w["name"] == "OPD")
    api.post(
        f"{V1}/wards/{opd['id']}/status", json={"status": "Inactive", "reason": "x"}, headers=admin
    )
    assert names(api.get(f"{V1}/wards?sort=status"))[0] == "MICU"  # Active before Inactive
    assert names(api.get(f"{V1}/wards?sort=status&order=desc"))[0] == "OPD"


def test_departments_sort_by_ward_count(api, hospital):
    r = api.get(f"{V1}/departments?sort=ward_count&order=desc")
    assert [(d["name"], d["ward_count"]) for d in r.json()["items"]] == [
        ("Critical Care", 2),
        ("Medicine", 2),
        ("Surgery", 1),
    ]
    assert names(api.get(f"{V1}/departments?sort=ward_count"))[0] == "Surgery"


def test_categories_sort_by_code(api, admin):
    assert [c["code"] for c in api.get(f"{V1}/staff-categories?sort=code").json()["items"]] == [
        "D",
        "H",
        "N",
        "O",
        "S",
        "T",
    ]
    assert api.get(f"{V1}/staff-categories?sort=code&order=desc").json()["items"][0]["code"] == "T"


@pytest.mark.parametrize(
    "path",
    [
        "/wards?sort=bogus",
        "/wards?order=sideways",
        "/wards?sort=ward_count",  # valid for departments only
        "/departments?sort=monthly_target",
        "/staff-categories?sort=department",
    ],
)
def test_unknown_sort_or_order_is_a_validation_error(api, admin, path):
    assert api.get(f"{V1}{path}").status_code == 422


def test_sorting_works_with_paging(api, hospital):
    page1 = names(api.get(f"{V1}/wards?sort=name&page_size=2&page=1"))
    page2 = names(api.get(f"{V1}/wards?sort=name&page_size=2&page=2"))
    assert page1 + page2 == ["MICU", "OPD", "SICU", "Ward 1"]


# ---------- department filter ----------


def test_wards_filter_by_department(api, hospital):
    r = api.get(f"{V1}/wards?department_id={hospital['med']['id']}")
    assert names(r) == ["OPD", "Ward 1"] and r.json()["total"] == 2


def test_department_filter_combines_with_status_search_and_sort(api, admin, hospital):
    med = hospital["med"]["id"]
    opd = next(w for w in hospital["wards"] if w["name"] == "OPD")
    api.post(
        f"{V1}/wards/{opd['id']}/status", json={"status": "Inactive", "reason": "x"}, headers=admin
    )
    assert names(api.get(f"{V1}/wards?department_id={med}&status=Active")) == ["Ward 1"]
    assert names(api.get(f"{V1}/wards?department_id={med}&q=opd")) == ["OPD"]
    assert names(api.get(f"{V1}/wards?department_id={med}&sort=name&order=desc")) == [
        "Ward 1",
        "OPD",
    ]


def test_department_filter_unknown_or_malformed(api, admin, hospital):
    empty = api.get(f"{V1}/wards?department_id=00000000-0000-0000-0000-000000000000").json()
    assert empty["items"] == [] and empty["total"] == 0
    assert api.get(f"{V1}/wards?department_id=nope").status_code == 422


# ---------- summary ----------


def test_summary_requires_login_and_is_open_to_any_signed_in_user(api, make_user):
    assert api.get(f"{V1}/masters/summary").status_code == 401
    make_user("N001", role="link_nurse")
    sign_in(api, "N001")
    assert api.get(f"{V1}/masters/summary").status_code == 200


def test_summary_counts_and_target_total_of_active_wards_only(api, admin, hospital):
    s = api.get(f"{V1}/masters/summary").json()
    assert s["departments"] == {"active": 3, "inactive": 0}
    assert s["wards"] == {"active": 5, "inactive": 0, "monthly_target_total": 240}
    assert s["staff_categories"] == {"active": 6, "inactive": 0}
    assert s["kpi"] == {"green": 90, "amber": 80, "inactive_days": 10}
    micu = hospital["wards"][0]
    api.post(
        f"{V1}/wards/{micu['id']}/status", json={"status": "Inactive", "reason": "x"}, headers=admin
    )
    api.post(
        f"{V1}/departments/{hospital['surg']['id']}/status",
        json={"status": "Inactive", "reason": "x"},
        headers=admin,
    )
    api.put(
        f"{V1}/settings/kpi", json={"green": 95, "amber": 85, "inactive_days": 7}, headers=admin
    )
    s = api.get(f"{V1}/masters/summary").json()
    assert s["wards"] == {"active": 4, "inactive": 1, "monthly_target_total": 175}
    assert s["departments"] == {"active": 2, "inactive": 1}
    assert s["kpi"]["green"] == 95


def test_summary_on_an_empty_hospital(api, admin):
    s = api.get(f"{V1}/masters/summary").json()
    assert s["wards"] == {"active": 0, "inactive": 0, "monthly_target_total": 0}
    assert s["departments"] == {"active": 0, "inactive": 0}


def test_a_large_hospital_lists_page_correctly(api, admin):
    d = dept(api, admin, "General")
    for i in range(130):
        ward(api, admin, f"Ward {i:03d}", d, 8)
    page = api.get(f"{V1}/wards?page_size=50&page=3").json()
    assert page["total"] == 130 and len(page["items"]) == 30
    assert api.get(f"{V1}/masters/summary").json()["wards"]["monthly_target_total"] == 1040
    assert len(api.get(f"{V1}/wards?page_size=500").json()["items"]) == 130
