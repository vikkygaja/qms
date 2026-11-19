from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import (
    COOKIE_NAME,
    AuthContext,
    auth_context,
    client_ip,
    get_db,
    get_now,
    get_settings_dep,
    load_permissions,
)
from app.core.config import Settings
from app.core.db import set_tenant
from app.core.errors import ApiError
from app.core.models import Tenant
from app.core.security import POLICY_MESSAGE
from app.roles.models import Role
from app.roles.seed import PERMISSIONS
from app.users.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
_ORDER = {code: i for i, (code, _) in enumerate(PERMISSIONS)}


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    employee_id: str
    password: str


class ChangePasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str
    new_password: str


def me_payload(user: User, role: Role | None, permissions: set[str], csrf_token: str) -> dict:
    return {
        "user": {
            "id": str(user.id),
            "employee_id": user.employee_id,
            "full_name": user.full_name,
            "designation": user.designation,
            "role": {"id": str(role.id), "key": role.key, "name": role.name} if role else None,
            "permissions": sorted(permissions, key=lambda c: _ORDER.get(c, 99)),
            "must_change_password": user.must_change_password,
        },
        "csrf_token": csrf_token,
    }


def _set_cookie(response: Response, settings: Settings, value: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        value,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login")
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
):
    tenant = db.scalar(select(Tenant).where(Tenant.code == settings.default_tenant_code))
    if tenant is None:
        raise ApiError(503, "not_configured", "The hospital is not set up yet. Contact IT.")
    set_tenant(db, tenant.id)
    cookie_value, session, user = service.login(
        db,
        settings,
        tenant_id=tenant.id,
        employee_id=body.employee_id.strip(),
        password=body.password,
        now=now,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    role, permissions = load_permissions(db, user)
    _set_cookie(response, settings, cookie_value)
    return me_payload(user, role, permissions, session.csrf_token)


@router.get("/me")
def me(ctx: AuthContext = Depends(auth_context)):
    return me_payload(ctx.user, ctx.role, ctx.permissions, ctx.session.csrf_token)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    ctx: AuthContext = Depends(auth_context),
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
):
    service.logout(db, ctx.session, now)
    response.delete_cookie(COOKIE_NAME, path="/")


@router.post("/change-password")
def change_password(
    body: ChangePasswordIn,
    ctx: AuthContext = Depends(auth_context),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
):
    service.change_password(
        db,
        settings,
        user=ctx.user,
        session=ctx.session,
        current_password=body.current_password,
        new_password=body.new_password,
        now=now,
        ip=ctx.ip,
    )
    return me_payload(ctx.user, ctx.role, ctx.permissions, ctx.session.csrf_token)


__all__ = ["POLICY_MESSAGE", "router"]
