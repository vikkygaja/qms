import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import (
    AuthContext,
    get_db,
    get_now,
    get_settings_dep,
    require_permission,
)
from app.core.config import Settings
from app.core.pagination import PageParams, page_of
from app.linknurses import service
from app.linknurses.schemas import (
    LinkNurseCreate,
    LinkNursePatch,
    LinkNurseStatus,
    WardsIn,
)

require_ln = require_permission("ln")

router = APIRouter(prefix="/link-nurses", tags=["link-nurses"], dependencies=[Depends(require_ln)])


def _page(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)) -> PageParams:
    return PageParams(page, page_size)


@router.get("")
def list_link_nurses(
    q: str | None = Query(None, max_length=100),
    ward_id: uuid.UUID | None = None,
    status: Literal["Active", "Inactive"] | None = None,
    sort: Literal["name", "employee_id", "status"] = "name",
    order: Literal["asc", "desc"] = "asc",
    page: PageParams = Depends(_page),
    db: Session = Depends(get_db),
):
    items, total = service.list_nurses(db, page, q, ward_id, status, sort, order)
    return page_of(items, total, page)


@router.post("", status_code=201)
def create_link_nurse(
    body: LinkNurseCreate,
    ctx: AuthContext = Depends(require_ln),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
):
    nurse, temp = service.create_nurse(db, settings, ctx, body, now)
    return {"link_nurse": nurse, "temporary_password": temp}


# Declared before "/{user_id}" so the literal path is not read as an id.
@router.get("/recent-changes")
def recent_changes(limit: int = Query(8, ge=1, le=50), db: Session = Depends(get_db)):
    return service.recent_changes(db, limit)


@router.get("/{user_id}")
def get_link_nurse(user_id: uuid.UUID, db: Session = Depends(get_db)):
    return service.detail_out(db, service.get_nurse(db, user_id))


@router.patch("/{user_id}")
def update_link_nurse(
    user_id: uuid.UUID,
    body: LinkNursePatch,
    ctx: AuthContext = Depends(require_ln),
    db: Session = Depends(get_db),
):
    return service.update_nurse(db, ctx, user_id, body)


@router.put("/{user_id}/wards")
def set_wards(
    user_id: uuid.UUID,
    body: WardsIn,
    ctx: AuthContext = Depends(require_ln),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_wards(db, ctx, user_id, body.ward_ids, now)


@router.post("/{user_id}/status")
def set_status(
    user_id: uuid.UUID,
    body: LinkNurseStatus,
    ctx: AuthContext = Depends(require_ln),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_status(db, ctx, user_id, body, now)


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_ln),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
):
    nurse, temp = service.reset_password(db, settings, ctx, user_id, now)
    return {"link_nurse": nurse, "temporary_password": temp}
