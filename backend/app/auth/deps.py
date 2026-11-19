"""Request authentication: cookie -> tenant context -> session -> user -> permissions."""

import hmac
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import UserSession
from app.core.config import Settings
from app.core.db import set_tenant
from app.core.errors import ApiError
from app.core.security import hash_token
from app.roles.models import Permission, Role, RolePermission
from app.users.models import ACTIVE, User, UserRole

COOKIE_NAME = "qms_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
TOUCH_EVERY = timedelta(seconds=60)


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.sessionmaker() as session:
        yield session


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_now(request: Request) -> datetime:
    return request.app.state.clock()


@dataclass
class AuthContext:
    user: User
    session: UserSession
    role: Role | None
    permissions: set[str]
    ip: str | None

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.user.tenant_id


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _unauthenticated(message: str = "Please sign in.", code: str = "unauthenticated") -> ApiError:
    return ApiError(401, code, message)


def _split_cookie(value: str | None) -> tuple[uuid.UUID, str]:
    if not value or "." not in value:
        raise _unauthenticated()
    tenant_part, token = value.split(".", 1)
    try:
        return uuid.UUID(tenant_part), token
    except ValueError:
        raise _unauthenticated() from None


def load_permissions(db: Session, user: User) -> tuple[Role | None, set[str]]:
    role = db.scalar(
        select(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user.id)
        .limit(1)
    )
    codes = db.scalars(
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .where(UserRole.user_id == user.id)
    ).all()
    return role, set(codes)


def auth_context(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    now: datetime = Depends(get_now),
) -> AuthContext:
    """Authenticate the request. Also enforces CSRF on state-changing methods."""
    tenant_id, token = _split_cookie(request.cookies.get(COOKIE_NAME))
    set_tenant(db, tenant_id)  # row-level security applies from here on
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or session.revoked_at is not None:
        raise _unauthenticated()
    idle = timedelta(minutes=settings.session_idle_minutes)
    if now >= session.expires_at or now - session.last_seen_at > idle:
        session.revoked_at = now
        db.commit()
        raise _unauthenticated("Your session has expired. Please sign in again.", "session_expired")
    user = db.get(User, session.user_id)
    if user is None or user.status != ACTIVE:
        raise _unauthenticated()

    if request.method not in SAFE_METHODS:
        sent = request.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(sent.encode(), session.csrf_token.encode()):
            raise ApiError(403, "forbidden", "CSRF token missing or invalid.")

    if now - session.last_seen_at > TOUCH_EVERY:
        session.last_seen_at = now
        db.commit()
    role, permissions = load_permissions(db, user)
    return AuthContext(user, session, role, permissions, client_ip(request))


def active_context(ctx: AuthContext = Depends(auth_context)) -> AuthContext:
    """Like auth_context, but blocks users who still have to change a temporary password."""
    if ctx.user.must_change_password:
        raise ApiError(
            403, "password_change_required", "You must set a new password before continuing."
        )
    return ctx


def require_permission(code: str) -> Callable[..., AuthContext]:
    def checker(ctx: AuthContext = Depends(active_context)) -> AuthContext:
        if code not in ctx.permissions:
            raise ApiError(403, "forbidden", "You do not have permission to do this.")
        return ctx

    return checker


# One shared instance so FastAPI resolves it once per request (router-level + handler-level).
require_users = require_permission("users")
require_masters = require_permission("masters")
