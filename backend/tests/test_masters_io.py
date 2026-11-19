import csv
import io

import pytest
from openpyxl import Workbook, load_workbook

from tests.helpers import V1, error_code, sign_in

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.fixture
def admin(api, make_user):
    make_user("ADM001", role="admin")
    return sign_in(api, "ADM001")


def book(**sheets: list[list]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name.replace("_", " "))
        for r in rows:
            ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def csv_bytes(rows: list[list]) -> bytes:
    out = io.StringIO()
    csv.writer(out).writerows(rows)
    return out.getvalue().encode()


def do_import(api, admin, data, name="m.xlsx", kind="all", dry_run=True, ctype=XLSX):
    return api.post(
        f"{V1}/masters/import?kind={kind}&dry_run={'true' if dry_run else 'false'}",
        files={"file": (name, data, ctype)},
        headers=admin,
    )


def names(api, kind):
    return sorted(i["name"] for i in api.get(f"{V1}/{kind}").json()["items"])


FULL = book(
    Departments=[["Name"], ["Critical Care"], ["Surgery"]],
    Staff_categories=[["Name", "Code"], ["Porter", "P"]],
    Wards=[
        ["Name", "Department", "Monthly target"],
        ["MICU", "Critical Care", 65],
        ["Ward 2", "surgery", "50"],
    ],
)


# ---------- access control ----------


@pytest.mark.parametrize("role", ["icn", "qm", "link_nurse"])
def test_import_export_need_masters_permission(api, make_user, role):
    make_user("X001", role=role)
    csrf = sign_in(api, "X001")
    assert api.get(f"{V1}/masters/export?kind=all&format=xlsx").status_code == 403
    assert api.get(f"{V1}/masters/template?kind=wards&format=csv").status_code == 403
    assert do_import(api, csrf, FULL).status_code == 403


def test_import_export_reject_anonymous(api):
    assert api.get(f"{V1}/masters/export?kind=all&format=xlsx").status_code == 401
    assert (
        api.post(f"{V1}/masters/import?kind=all", files={"file": ("a.xlsx", b"x")}).status_code
        == 401
    )


def test_import_needs_csrf_token(api, admin):
    r = api.post(f"{V1}/masters/import?kind=all", files={"file": ("a.xlsx", FULL, XLSX)})
    assert r.status_code == 403


# ---------- export ----------


def test_export_all_xlsx_has_every_sheet_and_the_data(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    r = api.get(f"{V1}/masters/export?kind=all&format=xlsx")
    assert r.status_code == 200 and r.headers["content-type"].startswith(XLSX)
    assert "attachment" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].endswith('.xlsx"')
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Departments", "Staff categories", "Wards", "KPI thresholds"]
    wards = list(wb["Wards"].values)
    assert wards[0] == ("Name", "Department", "Monthly target", "Status")
    assert ("MICU", "Critical Care", 65, "Active") in wards
    kpi = {row[0]: row[1] for row in list(wb["KPI thresholds"].values)[1:]}
    assert kpi == {"Green from (%)": 90, "Amber from (%)": 80, "Inactive after (days)": 10}


def test_export_single_kind_csv(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    r = api.get(f"{V1}/masters/export?kind=wards&format=csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0] == ["Name", "Department", "Monthly target", "Status"]
    assert ["MICU", "Critical Care", "65", "Active"] in rows


def test_export_all_as_csv_is_not_possible(api, admin):
    assert api.get(f"{V1}/masters/export?kind=all&format=csv").status_code == 422


def test_export_unknown_kind_or_format(api, admin):
    assert api.get(f"{V1}/masters/export?kind=nope&format=xlsx").status_code == 422
    assert api.get(f"{V1}/masters/export?kind=wards&format=pdf").status_code == 422


def test_export_neutralises_spreadsheet_formulas(api, admin):
    api.post(f"{V1}/departments", json={"name": '=HYPERLINK("http://evil")'}, headers=admin)
    api.post(f"{V1}/departments", json={"name": "@cmd"}, headers=admin)
    out = api.get(f"{V1}/masters/export?kind=departments&format=csv").content.decode("utf-8-sig")
    assert "'=HYPERLINK" in out and "'@cmd" in out
    wb = load_workbook(
        io.BytesIO(api.get(f"{V1}/masters/export?kind=departments&format=xlsx").content)
    )
    cells = [row[0] for row in list(wb["Departments"].values)[1:]]
    assert all(not str(c).startswith(("=", "@")) for c in cells)


def test_export_includes_inactive_rows_with_their_status(api, admin):
    d = api.post(f"{V1}/departments", json={"name": "Old"}, headers=admin).json()
    api.post(
        f"{V1}/departments/{d['id']}/status",
        json={"status": "Inactive", "reason": "x"},
        headers=admin,
    )
    rows = list(
        csv.reader(
            io.StringIO(
                api.get(f"{V1}/masters/export?kind=departments&format=csv").content.decode(
                    "utf-8-sig"
                )
            )
        )
    )
    assert ["Old", "Inactive"] in rows


def test_template_has_headers_and_an_example(api, admin):
    r = api.get(f"{V1}/masters/template?kind=all&format=xlsx")
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Instructions", "Departments", "Staff categories", "Wards"]
    assert list(wb["Wards"].values)[0][:3] == ("Name", "Department", "Monthly target")
    c = api.get(f"{V1}/masters/template?kind=staff-categories&format=csv").content.decode(
        "utf-8-sig"
    )
    assert c.splitlines()[0].startswith("Name,Code")


# ---------- import: dry run ----------


def test_dry_run_reports_without_changing_anything(api, admin):
    r = do_import(api, admin, FULL, dry_run=True)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["dry_run"] is True and rep["applied"] is False
    assert rep["summary"] == {"created": 5, "updated": 0, "unchanged": 0, "errors": 0}
    assert {x["action"] for x in rep["rows"]} == {"create"}
    assert names(api, "wards") == [] and names(api, "departments") == []


def test_apply_creates_everything_wards_may_use_departments_from_the_same_file(api, admin):
    r = do_import(api, admin, FULL, dry_run=False)
    rep = r.json()
    assert rep["applied"] is True and rep["summary"]["created"] == 5
    assert names(api, "wards") == ["MICU", "Ward 2"]
    ward2 = next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "Ward 2")
    assert ward2["department"]["name"] == "Surgery" and ward2["monthly_target"] == 50
    assert "Porter" in names(api, "staff-categories")


def test_reimport_is_a_no_op_and_updates_are_detected(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    again = do_import(api, admin, FULL, dry_run=False).json()
    assert again["summary"] == {"created": 0, "updated": 0, "unchanged": 5, "errors": 0}
    changed = book(
        Wards=[["Name", "Department", "Monthly target"], ["micu", "Surgery", 70]],
    )
    rep = do_import(api, admin, changed, kind="wards", dry_run=False).json()
    assert rep["summary"] == {"created": 0, "updated": 1, "unchanged": 0, "errors": 0}
    micu = next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "MICU")
    assert micu["monthly_target"] == 70 and micu["department"]["name"] == "Surgery"


def test_import_never_changes_status_and_ignores_the_status_column(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    ward = next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "MICU")
    api.post(
        f"{V1}/wards/{ward['id']}/status", json={"status": "Inactive", "reason": "x"}, headers=admin
    )
    data = book(
        Wards=[
            ["Name", "Department", "Monthly target", "Status"],
            ["MICU", "Critical Care", 65, "Active"],
        ]
    )
    rep = do_import(api, admin, data, kind="wards", dry_run=False).json()
    assert rep["summary"]["errors"] == 0
    after = next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "MICU")
    assert after["status"] == "Inactive"
    new = book(
        Wards=[
            ["Name", "Department", "Monthly target", "Status"],
            ["New", "Surgery", 5, "Inactive"],
        ]
    )
    do_import(api, admin, new, kind="wards", dry_run=False)
    assert (
        next(w for w in api.get(f"{V1}/wards").json()["items"] if w["name"] == "New")["status"]
        == "Active"
    )


def test_import_never_deletes(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    only_one = book(Departments=[["Name"], ["Critical Care"]])
    do_import(api, admin, only_one, kind="departments", dry_run=False)
    assert names(api, "departments") == ["Critical Care", "Surgery"]


def test_headers_are_case_insensitive_and_extra_columns_ignored(api, admin):
    data = book(
        Wards=[["name", "DEPARTMENT", "monthly_target", "Notes"], ["W1", "Surgery", 3, "hi"]]
    )
    do_import(
        api, admin, book(Departments=[["Name"], ["Surgery"]]), kind="departments", dry_run=False
    )
    rep = do_import(api, admin, data, kind="wards", dry_run=False).json()
    assert rep["summary"]["created"] == 1 and rep["summary"]["errors"] == 0


# ---------- import: errors are all-or-nothing ----------


def test_any_error_blocks_the_whole_file(api, admin):
    bad = book(
        Departments=[["Name"], ["Good Dept"]],
        Wards=[
            ["Name", "Department", "Monthly target"],
            ["Fine", "Good Dept", 5],
            ["Broken", "Nowhere", 5],
        ],
    )
    rep = do_import(api, admin, bad, dry_run=False).json()
    assert rep["applied"] is False and rep["summary"]["errors"] == 1
    assert rep["rows"][0]["action"] == "error"  # errors are listed first
    assert rep["rows"][0]["sheet"] == "Wards" and rep["rows"][0]["row"] == 3
    assert "Nowhere" in rep["rows"][0]["message"]
    assert names(api, "wards") == [] and names(api, "departments") == []  # nothing applied


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        (["", "Surgery", 5], "name"),
        (["W", "Surgery", -3], "target"),
        (["W", "Surgery", "abc"], "target"),
        (["W", "Surgery", 1.5], "target"),
        (["W", "Surgery", 100001], "target"),
        (["W", "", 5], "department"),
        (["x" * 101, "Surgery", 5], "name"),
    ],
)
def test_ward_row_errors(api, admin, row, fragment):
    do_import(
        api, admin, book(Departments=[["Name"], ["Surgery"]]), kind="departments", dry_run=False
    )
    data = book(Wards=[["Name", "Department", "Monthly target"], row])
    rep = do_import(api, admin, data, kind="wards").json()
    assert rep["summary"]["errors"] == 1
    assert fragment in rep["rows"][0]["message"].lower()


def test_duplicate_names_inside_the_file_are_errors(api, admin):
    data = book(Departments=[["Name"], ["Same"], ["same"]])
    rep = do_import(api, admin, data, kind="departments").json()
    assert rep["summary"]["errors"] == 1 and "duplicate" in rep["rows"][0]["message"].lower()


def test_category_code_errors(api, admin):
    data = book(
        Staff_categories=[["Name", "Code"], ["A", "ABCD"], ["B", "D"], ["C", "Z"], ["D2", "Z"]]
    )
    rep = do_import(api, admin, data, kind="staff-categories").json()
    msgs = [r["message"].lower() for r in rep["rows"] if r["action"] == "error"]
    assert rep["summary"]["errors"] == 3
    assert sum("code" in m for m in msgs) == 3  # too long, used by Doctor, repeated in the file


def test_wrong_files_are_rejected(api, admin):
    r = do_import(api, admin, b"not a workbook", name="x.xlsx")
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "file"
    r = do_import(api, admin, b"a,b", name="x.pdf", ctype="application/pdf")
    assert r.status_code == 422
    r = do_import(api, admin, book(Other=[["x"]]), kind="all")  # no recognised sheet
    assert r.status_code == 422


def test_file_size_and_row_limits(api, admin):
    r = do_import(api, admin, b"x" * (2 * 1024 * 1024 + 1))
    assert r.status_code == 413 and error_code(r) == "payload_too_large"
    rows = [["Name"]] + [[f"Dept {i}"] for i in range(5001)]
    r = do_import(api, admin, book(Departments=rows), kind="departments")
    assert r.status_code == 422 and "5,000" in r.json()["error"]["message"]


def test_formula_text_in_uploaded_files_is_stored_literally_and_neutralised_on_export(api, admin):
    data = csv_bytes([["Name"], ["=1+1"]])
    rep = do_import(
        api, admin, data, name="d.csv", kind="departments", dry_run=False, ctype="text/csv"
    ).json()
    assert rep["applied"] is True
    assert names(api, "departments") == ["=1+1"]  # never evaluated
    out = api.get(f"{V1}/masters/export?kind=departments&format=csv").content.decode("utf-8-sig")
    assert "'=1+1" in out


# ---------- import: csv ----------


def test_csv_needs_a_single_kind_and_works(api, admin):
    data = csv_bytes([["Name"], ["Surgery"], ["Medicine"]])
    r = do_import(api, admin, data, name="d.csv", kind="all", ctype="text/csv")
    assert r.status_code == 422
    rep = do_import(
        api, admin, data, name="d.csv", kind="departments", dry_run=False, ctype="text/csv"
    ).json()
    assert rep["applied"] is True and names(api, "departments") == ["Medicine", "Surgery"]


def test_csv_with_excel_bom_and_semicolon_free_headers(api, admin):
    raw = "﻿Name,Code\nPorter,P\n".encode()
    rep = do_import(
        api, admin, raw, name="c.csv", kind="staff-categories", dry_run=False, ctype="text/csv"
    ).json()
    assert rep["summary"]["created"] == 1


# ---------- audit ----------


def test_every_created_or_updated_row_is_audited_plus_one_import_entry(api, admin):
    do_import(api, admin, FULL, dry_run=False)
    assert api.get(f"{V1}/audit-log?action=create&entity=ward").json()["total"] == 2
    assert api.get(f"{V1}/audit-log?action=create&entity=department").json()["total"] == 2
    entry = api.get(f"{V1}/audit-log?entity=masters&action=import").json()["items"][0]
    assert "m.xlsx" in entry["summary"] and entry["new_values"]["created"] == 5


def test_dry_runs_are_not_audited(api, admin):
    do_import(api, admin, FULL, dry_run=True)
    assert api.get(f"{V1}/audit-log?entity=masters").json()["total"] == 0
