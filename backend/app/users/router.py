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
    require_users,
)
from app.core.config import Settings
from app.core.pagination import PageParams, page_of, page_params
from app.users import service
from app.users.schemas import (
    StatusChange,
    UserCreate,
    UserOut,
    UserPage,
    UserPatch,
    UserWithPassword,
)

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_users)])


@router.get("", response_model=UserPage)
def list_users(
    q: str | None = Query(None, max_length=100),
    status: Literal["Active", "Inactive"] | None = None,
    role_id: uuid.UUID | None = None,
    page: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
):
    items, total = service.list_users(db, page, q, status, role_id)
    return page_of(items, total, page)


@router.post("", response_model=UserWithPassword, status_code=201)
def create_user(
    body: UserCreate,
    ctx: AuthContext = Depends(require_users),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user, temp = service.create_user(db, settings, ctx, body)
    return {"user": user, "temporary_password": temp}


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user, role = service.get_user(db, user_id)
    return service.user_out(user, role)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    body: UserPatch,
    ctx: AuthContext = Depends(require_users),
    db: Session = Depends(get_db),
):
    return service.update_user(db, ctx, user_id, body)


@router.post("/{user_id}/status", response_model=UserOut)
def set_status(
    user_id: uuid.UUID,
    body: StatusChange,
    ctx: AuthContext = Depends(require_users),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    return service.set_status(db, ctx, user_id, body, now)


@router.post("/{user_id}/reset-password", response_model=UserWithPassword)
def reset_password(
    user_id: uuid.UUID,
    ctx: AuthContext = Depends(require_users),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
):
    user, temp = service.reset_password(db, settings, ctx, user_id, now)
    return {"user": user, "temporary_password": temp}
