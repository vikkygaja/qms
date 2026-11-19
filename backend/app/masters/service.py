import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.deps import AuthContext
from app.core.errors import ApiError, field_error
from app.core.pagination import PageParams
from app.core.timeutil import today_ist
from app.linknurses.models import WardAssignment
from app.masters.models import Department, Setting, StaffCategory, Ward
from app.users.models import ACTIVE, INACTIVE, StatusHistory
from app.users.schemas import StatusChange

KPI_KEY = "kpi"
KPI_DEFAULTS = {"green": 90, "amber": 80, "inactive_days": 10}

DUPLICATE_NAME = "That name already exists."
DUPLICATE_CODE = "That code is already used by another category."


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


# ---------- shaping ----------


def department_out(d: Department, ward_count: int) -> dict:
    return {"id": d.id, "name": d.name, "status": d.status, "ward_count": ward_count}


def link_nurse_counts(db: Session) -> dict[uuid.UUID, int]:
    """Link nurses currently assigned to each ward."""
    return dict(
        db.execute(
            select(WardAssignment.ward_id, func.count())
            .where(WardAssignment.to_date.is_(None))
            .group_by(WardAssignment.ward_id)
        ).all()
    )


def nurse_count(db: Session, ward_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                WardAssignment.ward_id == ward_id, WardAssignment.to_date.is_(None)
            )
        )
        or 0
    )


def ward_out(w: Ward, dept: Department, nurses: int = 0) -> dict:
    return {
        "link_nurse_count": nurses,
        "id": w.id,
        "name": w.name,
        "department": {"id": dept.id, "name": dept.name},
        "monthly_target": w.monthly_target,
        "status": w.status,
    }


def category_out(c: StaffCategory) -> dict:
    return {"id": c.id, "name": c.name, "code": c.code, "status": c.status}


# ---------- shared helpers ----------


def name_taken(db: Session, model: Any, name: str, except_id: uuid.UUID | None = None) -> bool:
    stmt = select(model.id).where(func.lower(model.name) == name.lower())
    if except_id:
        stmt = stmt.where(model.id != except_id)
    return db.scalar(stmt) is not None


def code_taken(db: Session, code: str, except_id: uuid.UUID | None = None) -> bool:
    stmt = select(StaffCategory.id).where(StaffCategory.code == code)
    if except_id:
        stmt = stmt.where(StaffCategory.id != except_id)
    return db.scalar(stmt) is not None


def active_department(db: Session, department_id: uuid.UUID) -> Department:
    dept = db.get(Department, department_id)
    if dept is None or dept.status != ACTIVE:
        raise field_error("department_id", "Choose an active department.")
    return dept


def _filtered(stmt, model, status: str | None, q: str | None):
    if status:
        stmt = stmt.where(model.status == status)
    if q:
        stmt = stmt.where(model.name.ilike(f"%{q.strip()}%"))
    return stmt


def _page(db: Session, stmt, page: PageParams, *order_by):
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(*order_by).offset(page.offset).limit(page.page_size)).all()
    return rows, total


def _ordered(column, order: str, name_column):
    """Sort by `column`, ties broken by name so paging is stable."""
    primary = column.desc() if order == "desc" else column.asc()
    return (primary, func.lower(name_column).asc())


def _apply_status(
    db: Session,
    ctx: AuthContext,
    obj: Any,
    entity: str,
    label: str,
    data: StatusChange,
    now: datetime,
) -> None:
    if obj.status == data.status:
        raise ApiError(409, "conflict", f"This {label} is already {data.status}.")
    old = obj.status
    obj.status = data.status
    db.add(
        StatusHistory(
            tenant_id=ctx.tenant_id,
            entity_type=entity,
            entity_id=obj.id,
            old_status=old,
            new_status=data.status,
            reason=data.reason,
            effective_date=today_ist(now),
            changed_by=ctx.user.id,
            changed_at=now,
        )
    )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=entity,
        entity_id=obj.id,
        action="status_change",
        summary=f"Set {label} {obj.name} {data.status}: {data.reason}",
        old={"status": old},
        new={"status": data.status, "reason": data.reason},
        ip=ctx.ip,
    )
    db.commit()


def audit_update(
    db: Session, ctx: AuthContext, entity: str, label: str, obj: Any, old: dict, new: dict
) -> None:
    if not new:
        return
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=entity,
        entity_id=obj.id,
        action="update",
        summary=f"Updated {label} {obj.name}: {', '.join(sorted(new))}",
        old=old,
        new=new,
        ip=ctx.ip,
    )


def audit_create(
    db: Session, ctx: AuthContext, entity: str, label: str, obj: Any, new: dict
) -> None:
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=entity,
        entity_id=obj.id,
        action="create",
        summary=f"Created {label} {obj.name}",
        new=new,
        ip=ctx.ip,
    )


# ---------- departments ----------


def _ward_counts(db: Session) -> dict[uuid.UUID, int]:
    return dict(
        db.execute(select(Ward.department_id, func.count()).group_by(Ward.department_id)).all()
    )


def list_departments(
    db: Session, page: PageParams, status, q, sort: str = "name", order: str = "asc"
) -> tuple[list[dict], int]:
    counts = (
        select(Ward.department_id.label("department_id"), func.count().label("n"))
        .group_by(Ward.department_id)
        .subquery()
    )
    ward_count = func.coalesce(counts.c.n, 0)
    stmt = _filtered(
        select(Department, ward_count.label("ward_count")).outerjoin(
            counts, counts.c.department_id == Department.id
        ),
        Department,
        status,
        q,
    )
    column = {
        "name": func.lower(Department.name),
        "ward_count": ward_count,
        "status": Department.status,
    }[sort]
    rows, total = _page(db, stmt, page, *_ordered(column, order, Department.name))
    return [department_out(d, n) for d, n in rows], total


def create_department(db: Session, ctx: AuthContext, name: str) -> dict:
    if name_taken(db, Department, name):
        raise ApiError(409, "conflict", DUPLICATE_NAME)
    dept = Department(tenant_id=ctx.tenant_id, name=name, status=ACTIVE)
    db.add(dept)
    db.flush()
    audit_create(db, ctx, "department", "department", dept, {"name": name})
    db.commit()
    return department_out(dept, 0)


def get_department(db: Session, department_id: uuid.UUID) -> Department:
    dept = db.get(Department, department_id)
    if dept is None:
        raise not_found("Department")
    return dept


def update_department(db: Session, ctx: AuthContext, department_id: uuid.UUID, name) -> dict:
    dept = get_department(db, department_id)
    old: dict = {}
    new: dict = {}
    if name is not None and name != dept.name:
        if name_taken(db, Department, name, dept.id):
            raise ApiError(409, "conflict", DUPLICATE_NAME)
        old["name"], new["name"] = dept.name, name
        dept.name = name
    audit_update(db, ctx, "department", "department", dept, old, new)
    db.commit()
    return department_out(dept, _ward_counts(db).get(dept.id, 0))


def set_department_status(
    db: Session, ctx: AuthContext, department_id: uuid.UUID, data: StatusChange, now: datetime
) -> dict:
    dept = get_department(db, department_id)
    _apply_status(db, ctx, dept, "department", "department", data, now)
    return department_out(dept, _ward_counts(db).get(dept.id, 0))


# ---------- wards ----------


def list_wards(
    db: Session,
    page: PageParams,
    status,
    q,
    department_id: uuid.UUID | None = None,
    sort: str = "name",
    order: str = "asc",
) -> tuple[list[dict], int]:
    stmt = _filtered(select(Ward, Department).join(Department), Ward, status, q)
    if department_id:
        stmt = stmt.where(Ward.department_id == department_id)
    column = {
        "name": func.lower(Ward.name),
        "department": func.lower(Department.name),
        "monthly_target": Ward.monthly_target,
        "status": Ward.status,
    }[sort]
    rows, total = _page(db, stmt, page, *_ordered(column, order, Ward.name))
    counts = link_nurse_counts(db)
    return [ward_out(w, d, counts.get(w.id, 0)) for w, d in rows], total


def create_ward(db: Session, ctx: AuthContext, data) -> dict:
    dept = active_department(db, data.department_id)
    if name_taken(db, Ward, data.name):
        raise ApiError(409, "conflict", DUPLICATE_NAME)
    ward = Ward(
        tenant_id=ctx.tenant_id,
        name=data.name,
        department_id=dept.id,
        monthly_target=data.monthly_target,
        status=ACTIVE,
    )
    db.add(ward)
    db.flush()
    audit_create(
        db,
        ctx,
        "ward",
        "ward",
        ward,
        {"name": ward.name, "department": dept.name, "monthly_target": ward.monthly_target},
    )
    db.commit()
    return ward_out(ward, dept)


def get_ward(db: Session, ward_id: uuid.UUID) -> tuple[Ward, Department]:
    ward = db.get(Ward, ward_id)
    if ward is None:
        raise not_found("Ward")
    return ward, db.get(Department, ward.department_id)


def update_ward(db: Session, ctx: AuthContext, ward_id: uuid.UUID, data) -> dict:
    ward, dept = get_ward(db, ward_id)
    fields = data.model_dump(exclude_unset=True)
    old: dict = {}
    new: dict = {}
    if fields.get("name") is not None and fields["name"] != ward.name:
        if name_taken(db, Ward, fields["name"], ward.id):
            raise ApiError(409, "conflict", DUPLICATE_NAME)
        old["name"], new["name"] = ward.name, fields["name"]
        ward.name = fields["name"]
    if fields.get("monthly_target") is not None and fields["monthly_target"] != ward.monthly_target:
        old["monthly_target"], new["monthly_target"] = ward.monthly_target, fields["monthly_target"]
        ward.monthly_target = fields["monthly_target"]
    if fields.get("department_id") is not None and fields["department_id"] != ward.department_id:
        new_dept = active_department(db, fields["department_id"])
        old["department"], new["department"] = dept.name, new_dept.name
        ward.department_id, dept = new_dept.id, new_dept
    audit_update(db, ctx, "ward", "ward", ward, old, new)
    db.commit()
    return ward_out(ward, dept, nurse_count(db, ward.id))


def set_ward_status(
    db: Session, ctx: AuthContext, ward_id: uuid.UUID, data: StatusChange, now: datetime
) -> dict:
    ward, dept = get_ward(db, ward_id)
    if data.status == INACTIVE and ward.status != INACTIVE:
        assigned = nurse_count(db, ward.id)
        if assigned:
            raise ApiError(
                409, "conflict", f"Move this ward's link nurses first ({assigned} assigned)."
            )
    _apply_status(db, ctx, ward, "ward", "ward", data, now)
    return ward_out(ward, dept, nurse_count(db, ward.id))


# ---------- staff categories ----------


def list_categories(
    db: Session, page: PageParams, status, q, sort: str = "name", order: str = "asc"
) -> tuple[list[dict], int]:
    stmt = _filtered(select(StaffCategory), StaffCategory, status, q)
    column = {
        "name": func.lower(StaffCategory.name),
        "code": StaffCategory.code,
        "status": StaffCategory.status,
    }[sort]
    rows, total = _page(db, stmt, page, *_ordered(column, order, StaffCategory.name))
    return [category_out(c) for (c,) in rows], total


def summary(db: Session) -> dict:
    """Headline numbers for the Masters overview page."""

    def counts(model) -> dict:
        by_status = dict(
            db.execute(select(model.status, func.count()).group_by(model.status)).all()
        )
        return {"active": by_status.get(ACTIVE, 0), "inactive": by_status.get("Inactive", 0)}

    target_total = db.scalar(
        select(func.coalesce(func.sum(Ward.monthly_target), 0)).where(Ward.status == ACTIVE)
    )
    return {
        "departments": counts(Department),
        "wards": {**counts(Ward), "monthly_target_total": int(target_total or 0)},
        "staff_categories": counts(StaffCategory),
        "kpi": get_kpi(db),
    }


def create_category(db: Session, ctx: AuthContext, name: str, code: str) -> dict:
    if name_taken(db, StaffCategory, name):
        raise ApiError(409, "conflict", DUPLICATE_NAME)
    if code_taken(db, code):
        raise ApiError(409, "conflict", DUPLICATE_CODE)
    cat = StaffCategory(tenant_id=ctx.tenant_id, name=name, code=code, status=ACTIVE)
    db.add(cat)
    db.flush()
    audit_create(db, ctx, "staff_category", "staff category", cat, {"name": name, "code": code})
    db.commit()
    return category_out(cat)


def get_category(db: Session, category_id: uuid.UUID) -> StaffCategory:
    cat = db.get(StaffCategory, category_id)
    if cat is None:
        raise not_found("Staff category")
    return cat


def update_category(db: Session, ctx: AuthContext, category_id: uuid.UUID, data) -> dict:
    cat = get_category(db, category_id)
    fields = data.model_dump(exclude_unset=True)
    old: dict = {}
    new: dict = {}
    if fields.get("name") is not None and fields["name"] != cat.name:
        if name_taken(db, StaffCategory, fields["name"], cat.id):
            raise ApiError(409, "conflict", DUPLICATE_NAME)
        old["name"], new["name"] = cat.name, fields["name"]
        cat.name = fields["name"]
    if fields.get("code") is not None and fields["code"] != cat.code:
        if code_taken(db, fields["code"], cat.id):
            raise ApiError(409, "conflict", DUPLICATE_CODE)
        old["code"], new["code"] = cat.code, fields["code"]
        cat.code = fields["code"]
    audit_update(db, ctx, "staff_category", "staff category", cat, old, new)
    db.commit()
    return category_out(cat)


def set_category_status(
    db: Session, ctx: AuthContext, category_id: uuid.UUID, data: StatusChange, now: datetime
) -> dict:
    cat = get_category(db, category_id)
    _apply_status(db, ctx, cat, "staff_category", "staff category", data, now)
    return category_out(cat)


# ---------- KPI thresholds ----------


def get_kpi(db: Session) -> dict:
    row = db.scalar(select(Setting).where(Setting.key == KPI_KEY))
    return {**KPI_DEFAULTS, **(row.value if row else {})}


def update_kpi(db: Session, ctx: AuthContext, data) -> dict:
    if not 1 <= data.green <= 100:
        raise field_error("green", "Green must be between 1 and 100.")
    if not 1 <= data.amber < data.green:
        raise field_error("amber", "Amber must be at least 1 and lower than green.")
    if not 1 <= data.inactive_days <= 365:
        raise field_error("inactive_days", "Use a number of days between 1 and 365.")
    old = get_kpi(db)
    new = {"green": data.green, "amber": data.amber, "inactive_days": data.inactive_days}
    row = db.scalar(select(Setting).where(Setting.key == KPI_KEY))
    if row is None:
        db.add(Setting(tenant_id=ctx.tenant_id, key=KPI_KEY, value=new))
    else:
        row.value = new
    if old != new:
        audit.record(
            db,
            tenant_id=ctx.tenant_id,
            actor=ctx.user,
            entity="setting",
            entity_id=KPI_KEY,
            action="update",
            summary="Updated KPI thresholds",
            old=old,
            new=new,
            ip=ctx.ip,
        )
    db.commit()
    return new


def ensure_defaults(db: Session, tenant) -> None:
    """Idempotent: default staff categories and KPI thresholds for a tenant."""
    from app.core.db import set_tenant

    set_tenant(db, tenant.id)
    have_codes = {c.code for c in db.scalars(select(StaffCategory))}
    have_names = {c.name.lower() for c in db.scalars(select(StaffCategory))}
    for name, code in DEFAULT_CATEGORIES:
        if code not in have_codes and name.lower() not in have_names:
            db.add(StaffCategory(tenant_id=tenant.id, name=name, code=code, status=ACTIVE))
    if db.scalar(select(Setting).where(Setting.key == KPI_KEY)) is None:
        db.add(Setting(tenant_id=tenant.id, key=KPI_KEY, value=KPI_DEFAULTS))
    db.flush()


DEFAULT_CATEGORIES = [
    ("Doctor", "D"),
    ("Nurse", "N"),
    ("Technician", "T"),
    ("Housekeeping", "H"),
    ("Student", "S"),
    ("Other HCW", "O"),
]
