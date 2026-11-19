"""Masters upload/download: Excel + CSV export, blank templates, and a validated import.

Import rules (docs/decisions.md item 46): rows match by name (case-insensitive); new names are
created, existing ones updated, identical ones left alone. Status is never changed and nothing is
ever deleted. A dry run reports every row; applying is all-or-nothing (any error blocks the file).
"""

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.deps import AuthContext
from app.core.errors import ApiError
from app.masters import service
from app.masters.models import Department, StaffCategory, Ward
from app.masters.schemas import CODE_RE
from app.users.models import ACTIVE

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
MAX_REPORT_ROWS = 500

KIND_ORDER = ["departments", "staff-categories", "wards"]  # wards may use new departments
SHEET_NAMES = {
    "departments": "Departments",
    "staff-categories": "Staff categories",
    "wards": "Wards",
}
EXPORT_HEADERS = {
    "departments": ["Name", "Status"],
    "staff-categories": ["Name", "Code", "Status"],
    "wards": ["Name", "Department", "Monthly target", "Status"],
}
IMPORT_HEADERS = {
    "departments": ["Name"],
    "staff-categories": ["Name", "Code"],
    "wards": ["Name", "Department", "Monthly target"],
}
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def file_error(message: str) -> ApiError:
    return ApiError(422, "validation_error", message, [{"field": "file", "message": message}])


def safe_cell(value: Any) -> Any:
    """Stop spreadsheet apps from treating exported text as a formula."""
    if isinstance(value, str) and value.startswith(FORMULA_STARTS):
        return "'" + value
    return value


# ---------------------------------------------------------------- export


def export_rows(db: Session, kind: str) -> list[list[Any]]:
    if kind == "departments":
        items = db.scalars(select(Department)).all()
        rows = [[d.name, d.status] for d in items]
    elif kind == "staff-categories":
        items = db.scalars(select(StaffCategory)).all()
        rows = [[c.name, c.code, c.status] for c in items]
    else:
        pairs = db.execute(select(Ward, Department).join(Department)).all()
        rows = [[w.name, d.name, w.monthly_target, w.status] for w, d in pairs]
    return sorted(rows, key=lambda r: str(r[0]).lower())


def _kinds(kind: str) -> list[str]:
    return KIND_ORDER if kind == "all" else [kind]


def _widths(ws) -> None:
    for col in ws.columns:
        longest = max((len(str(c.value)) for c in col if c.value is not None), default=8)
        ws.column_dimensions[col[0].column_letter].width = min(max(longest + 2, 12), 50)


def export_xlsx(db: Session, kind: str) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for k in _kinds(kind):
        ws = wb.create_sheet(SHEET_NAMES[k])
        ws.append(EXPORT_HEADERS[k])
        for row in export_rows(db, k):
            ws.append([safe_cell(v) for v in row])
        _widths(ws)
    if kind == "all":
        kpi = service.get_kpi(db)
        ws = wb.create_sheet("KPI thresholds")
        ws.append(["Setting", "Value"])
        ws.append(["Green from (%)", kpi["green"]])
        ws.append(["Amber from (%)", kpi["amber"]])
        ws.append(["Inactive after (days)", kpi["inactive_days"]])
        _widths(ws)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _csv(header: list[str], rows: list[list[Any]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows([[safe_cell(v) for v in r] for r in rows])
    return ("﻿" + out.getvalue()).encode("utf-8")  # BOM so Excel reads UTF-8


def export_csv(db: Session, kind: str) -> bytes:
    return _csv(EXPORT_HEADERS[kind], export_rows(db, kind))


INSTRUCTIONS = [
    ["QMS masters import: how to fill this workbook"],
    [""],
    ["Fill one row per item on the Departments, Staff categories and Wards sheets."],
    ["Keep the header row. Delete nothing you want to keep: import never deletes anything."],
    ["Items are matched by Name (upper/lower case does not matter): new names are created,"],
    ["existing names are updated, identical rows are left alone."],
    ["Status (Active/Inactive) is NOT imported. Change status on the Masters page, with a reason."],
    ["Wards: Department must already exist or be listed on the Departments sheet."],
    ["Staff categories: Code is 1-3 letters or numbers and must be unique."],
    ["Monthly target is a whole number from 0 to 100000."],
    ["Example ward row: MICU | Critical Care | 65"],
]


def template_xlsx(kind: str) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    if kind == "all":
        ws = wb.create_sheet("Instructions")
        for row in INSTRUCTIONS:
            ws.append(row)
        ws.column_dimensions["A"].width = 90
    for k in _kinds(kind):
        ws = wb.create_sheet(SHEET_NAMES[k])
        ws.append(IMPORT_HEADERS[k])
        _widths(ws)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def template_csv(kind: str) -> bytes:
    return _csv(IMPORT_HEADERS[kind], [])


# ---------------------------------------------------------------- parsing


@dataclass
class ParsedSheet:
    kind: str
    title: str
    rows: list[tuple[int, dict[str, Any]]] = field(default_factory=list)


def _norm(header: Any) -> str:
    return re.sub(r"[\s_]+", " ", str(header or "").strip().lower())


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _read_table(kind: str, title: str, rows_iter) -> ParsedSheet:
    sheet = ParsedSheet(kind, title)
    header: list[str] | None = None
    for number, raw in enumerate(rows_iter, start=1):
        if header is None:
            if all(_blank(c) for c in raw):
                continue
            header = [_norm(h) for h in raw]
            missing = [h for h in IMPORT_HEADERS[kind] if _norm(h) not in header]
            if missing:
                raise file_error(f"The {title} sheet is missing the column: {', '.join(missing)}.")
            continue
        if all(_blank(c) for c in raw):
            continue
        sheet.rows.append((number, {header[i]: raw[i] for i in range(min(len(header), len(raw)))}))
        if len(sheet.rows) > MAX_ROWS:
            raise file_error(f"Too many rows. The limit is {MAX_ROWS:,} per file.")
    if header is None:
        raise file_error(f"The {title} sheet is empty.")
    return sheet


def parse_upload(filename: str, data: bytes, kind: str) -> list[ParsedSheet]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        if kind == "all":
            raise file_error(
                "Choose which master the CSV file holds (wards, departments or staff categories)."
            )
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise file_error("The CSV file must be UTF-8 text.") from None
        rows = [list(r) for r in csv.reader(io.StringIO(text))]
        return [_read_table(kind, SHEET_NAMES[kind], iter(rows))]
    if not lower.endswith(".xlsx"):
        raise file_error("Upload an .xlsx or .csv file.")

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 - any parse failure is "not a valid workbook"
        raise file_error("That file is not a valid Excel (.xlsx) workbook.") from None
    try:
        by_name = {_norm(ws.title): ws for ws in wb.worksheets}
        sheets: list[ParsedSheet] = []
        for k in _kinds(kind):
            ws = by_name.get(_norm(SHEET_NAMES[k]))
            if ws is None and kind != "all" and len(wb.worksheets) == 1:
                ws = wb.worksheets[0]
            if ws is not None:
                sheets.append(_read_table(k, SHEET_NAMES[k], ws.iter_rows(values_only=True)))
        if not sheets:
            names = ", ".join(SHEET_NAMES[k] for k in _kinds(kind))
            raise file_error(f"No sheet named {names} was found.")
        return sheets
    finally:
        wb.close()


# ---------------------------------------------------------------- import


@dataclass
class RowResult:
    sheet: str
    row: int
    name: str
    action: str
    message: str = ""


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _target(value: Any) -> tuple[int | None, str]:
    msg = "Monthly target must be a whole number from 0 to 100000."
    if isinstance(value, bool):
        return None, msg
    if isinstance(value, float):
        if not value.is_integer():
            return None, msg
        value = int(value)
    if isinstance(value, str):
        value = value.strip()
        if not re.fullmatch(r"-?\d+", value):
            return None, msg
        value = int(value)
    if not isinstance(value, int) or not 0 <= value <= 100000:
        return None, msg
    return value, ""


def run_import(
    db: Session,
    ctx: AuthContext,
    sheets: list[ParsedSheet],
    *,
    apply: bool,
    filename: str,
    now: datetime,
) -> dict:
    depts = {d.name.lower(): d for d in db.scalars(select(Department))}
    cats = {c.name.lower(): c for c in db.scalars(select(StaffCategory))}
    codes = {c.code: c for c in cats.values()}
    wards = {w.name.lower(): w for w in db.scalars(select(Ward))}
    new_depts: dict[str, str] = {}  # lower name -> name, created by this file
    planned_codes: dict[str, str] = {}  # code -> category name, from this file
    results: list[RowResult] = []
    ops: list[tuple] = []  # ("dept"|"cat"|"ward", "create"|"update", payload)

    for sheet in sorted(sheets, key=lambda s: KIND_ORDER.index(s.kind)):
        seen_names: dict[str, int] = {}
        seen_codes: dict[str, int] = {}
        for number, row in sheet.rows:
            name = _text(row.get("name"))
            res = RowResult(sheet.title, number, name, "unchanged")
            results.append(res)

            def fail(message: str, res: RowResult = res) -> None:
                res.action, res.message = "error", message

            if not name:
                fail("Name is required (Enter a name).")
                continue
            if len(name) > 100:
                fail("Name must be at most 100 characters.")
                continue
            key = name.lower()
            if key in seen_names:
                fail(f"Duplicate name in this file (also on row {seen_names[key]}).")
                continue
            seen_names[key] = number

            if sheet.kind == "departments":
                if key in depts or key in new_depts:
                    continue
                new_depts[key] = name
                res.action = "create"
                ops.append(("dept", "create", {"name": name}))

            elif sheet.kind == "staff-categories":
                code = _text(row.get("code")).upper()
                if not CODE_RE.match(code):
                    fail("Code must be 1-3 letters or numbers.")
                    continue
                if code in seen_codes:
                    fail(f"Duplicate code in this file (also on row {seen_codes[code]}).")
                    continue
                existing = cats.get(key)
                holder = codes.get(code)
                if holder is not None and holder is not existing:
                    fail(f"Code {code} is already used by {holder.name}.")
                    continue
                seen_codes[code] = number
                if existing is None:
                    res.action = "create"
                    planned_codes[code] = name
                    ops.append(("cat", "create", {"name": name, "code": code}))
                elif existing.code != code:
                    res.action = "update"
                    ops.append(("cat", "update", {"obj": existing, "code": code}))

            else:  # wards
                dept_name = _text(row.get("department"))
                if not dept_name:
                    fail("Department is required.")
                    continue
                target, problem = _target(row.get("monthly target"))
                if target is None:
                    fail(problem)
                    continue
                dkey = dept_name.lower()
                dept = depts.get(dkey)
                if dept is None and dkey not in new_depts:
                    fail(f"Department '{dept_name}' does not exist.")
                    continue
                if dept is not None and dept.status != ACTIVE:
                    fail(f"Department '{dept_name}' is inactive.")
                    continue
                existing = wards.get(key)
                if existing is None:
                    res.action = "create"
                    ops.append(
                        ("ward", "create", {"name": name, "dept_key": dkey, "target": target})
                    )
                else:
                    changed = (
                        target != existing.monthly_target
                        or (dept is not None and dept.id != existing.department_id)
                        or (dept is None)
                    )
                    if changed:
                        res.action = "update"
                        ops.append(
                            (
                                "ward",
                                "update",
                                {"obj": existing, "dept_key": dkey, "target": target},
                            )
                        )

    summary = {
        "created": sum(r.action == "create" for r in results),
        "updated": sum(r.action == "update" for r in results),
        "unchanged": sum(r.action == "unchanged" for r in results),
        "errors": sum(r.action == "error" for r in results),
    }
    applied = apply and summary["errors"] == 0
    if applied:
        _apply(db, ctx, ops, depts)
        audit.record(
            db,
            tenant_id=ctx.tenant_id,
            actor=ctx.user,
            entity="masters",
            entity_id="import",
            action="import",
            summary=(
                f"Imported masters from {filename}: {summary['created']} created, "
                f"{summary['updated']} updated"
            ),
            new={**summary, "file": filename},
            ip=ctx.ip,
        )
        db.commit()

    ordered = [r for r in results if r.action == "error"] + [
        r for r in results if r.action != "error"
    ]
    return {
        "dry_run": not apply,
        "applied": applied,
        "summary": summary,
        "rows": [r.__dict__ for r in ordered[:MAX_REPORT_ROWS]],
        "truncated": len(ordered) > MAX_REPORT_ROWS,
    }


def _apply(db: Session, ctx: AuthContext, ops: list[tuple], depts: dict[str, Department]) -> None:
    for what, how, p in ops:
        if what == "dept":
            dept = Department(tenant_id=ctx.tenant_id, name=p["name"], status=ACTIVE)
            db.add(dept)
            db.flush()
            depts[dept.name.lower()] = dept
            service.audit_create(db, ctx, "department", "department", dept, {"name": dept.name})
        elif what == "cat" and how == "create":
            cat = StaffCategory(
                tenant_id=ctx.tenant_id, name=p["name"], code=p["code"], status=ACTIVE
            )
            db.add(cat)
            db.flush()
            service.audit_create(
                db,
                ctx,
                "staff_category",
                "staff category",
                cat,
                {"name": cat.name, "code": cat.code},
            )
        elif what == "cat":
            cat = p["obj"]
            old, cat.code = {"code": cat.code}, p["code"]
            service.audit_update(
                db, ctx, "staff_category", "staff category", cat, old, {"code": cat.code}
            )
        elif what == "ward" and how == "create":
            dept = depts[p["dept_key"]]
            ward = Ward(
                tenant_id=ctx.tenant_id,
                name=p["name"],
                department_id=dept.id,
                monthly_target=p["target"],
                status=ACTIVE,
            )
            db.add(ward)
            db.flush()
            service.audit_create(
                db,
                ctx,
                "ward",
                "ward",
                ward,
                {"name": ward.name, "department": dept.name, "monthly_target": ward.monthly_target},
            )
        else:
            ward, dept = p["obj"], depts[p["dept_key"]]
            old: dict = {}
            new: dict = {}
            if ward.monthly_target != p["target"]:
                old["monthly_target"], new["monthly_target"] = ward.monthly_target, p["target"]
                ward.monthly_target = p["target"]
            if ward.department_id != dept.id:
                old["department"] = db.get(Department, ward.department_id).name
                new["department"] = dept.name
                ward.department_id = dept.id
            service.audit_update(db, ctx, "ward", "ward", ward, old, new)
    db.flush()
