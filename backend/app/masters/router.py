import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import (
    AuthContext,
    active_context,
    get_db,
    get_now,
    require_masters,
)
from app.core.pagination import PageParams, page_of
from app.masters import service
from app.masters.schemas import (
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    DepartmentIn,
    DepartmentOut,
    DepartmentPatch,
    KpiIn,
    KpiOut,
    StatusFilter,
    WardIn,
    WardOut,
    WardPatch,
)
from app.users.schemas import StatusChange

# Reads: any signed-in user (entry screens need the lists). Writes: permission `masters`.
router = APIRouter(tags=["masters"], dependencies=[Depends(active_context)])


Order = Literal["asc", "desc"]


@router.get("/masters/summary")
def masters_summary(db: Session = Depends(get_db)):
    """Headline numbers for the Masters overview page (any signed-in user)."""
    return service.summary(db)


def list_params(
    status: StatusFilter | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    return status, q, PageParams(page, page_size)


# ---------- departments ----------


@router.get("/departments")
def list_departments(
    params=Depends(list_params),
    sort: Literal["name", "ward_count", "status"] = "name",
    order: Order = "asc",
    db: Session = Depends(get_db),
):
    status, q, page = params
    items, total = service.list_departments(db, page, status, q, sort, order)
    return page_of(items, total, page)


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(
    body: DepartmentIn, ctx: AuthContext = Depends(require_masters), db: Session = Depends(get_db)
):
    return service.create_department(db, ctx, body.name)


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: uuid.UUID,
    body: DepartmentPatch,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
):
    return service.update_department(db, ctx, department_id, body.name)


@router.post("/departments/{department_id}/status", response_model=DepartmentOut)
def department_status(
    department_id: uuid.UUID,
    body: StatusChange,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_department_status(db, ctx, department_id, body, now)


# ---------- wards ----------


@router.get("/wards")
def list_wards(
    params=Depends(list_params),
    department_id: uuid.UUID | None = None,
    sort: Literal["name", "department", "monthly_target", "status"] = "name",
    order: Order = "asc",
    db: Session = Depends(get_db),
):
    status, q, page = params
    items, total = service.list_wards(db, page, status, q, department_id, sort, order)
    return page_of(items, total, page)


@router.post("/wards", response_model=WardOut, status_code=201)
def create_ward(
    body: WardIn, ctx: AuthContext = Depends(require_masters), db: Session = Depends(get_db)
):
    return service.create_ward(db, ctx, body)


@router.patch("/wards/{ward_id}", response_model=WardOut)
def update_ward(
    ward_id: uuid.UUID,
    body: WardPatch,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
):
    return service.update_ward(db, ctx, ward_id, body)


@router.post("/wards/{ward_id}/status", response_model=WardOut)
def ward_status(
    ward_id: uuid.UUID,
    body: StatusChange,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_ward_status(db, ctx, ward_id, body, now)


# ---------- staff categories ----------


@router.get("/staff-categories")
def list_categories(
    params=Depends(list_params),
    sort: Literal["name", "code", "status"] = "name",
    order: Order = "asc",
    db: Session = Depends(get_db),
):
    status, q, page = params
    items, total = service.list_categories(db, page, status, q, sort, order)
    return page_of(items, total, page)


@router.post("/staff-categories", response_model=CategoryOut, status_code=201)
def create_category(
    body: CategoryIn, ctx: AuthContext = Depends(require_masters), db: Session = Depends(get_db)
):
    return service.create_category(db, ctx, body.name, body.code)


@router.patch("/staff-categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: uuid.UUID,
    body: CategoryPatch,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
):
    return service.update_category(db, ctx, category_id, body)


@router.post("/staff-categories/{category_id}/status", response_model=CategoryOut)
def category_status(
    category_id: uuid.UUID,
    body: StatusChange,
    ctx: AuthContext = Depends(require_masters),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_category_status(db, ctx, category_id, body, now)


# ---------- KPI thresholds ----------


@router.get("/settings/kpi", response_model=KpiOut)
def get_kpi(db: Session = Depends(get_db)):
    return service.get_kpi(db)


@router.put("/settings/kpi", response_model=KpiOut)
def put_kpi(
    body: KpiIn, ctx: AuthContext = Depends(require_masters), db: Session = Depends(get_db)
):
    return service.update_kpi(db, ctx, body)
