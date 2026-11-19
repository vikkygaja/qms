import uuid
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.deps import AuthContext
from app.auth.service import revoke_user_sessions
from app.core.config import Settings
from app.core.errors import ApiError, field_error
from app.core.pagination import PageParams
from app.core.security import hash_password, temporary_password
from app.core.timeutil import today_ist
from app.roles.models import Permission, Role, RolePermission
from app.roles.seed import LINK_NURSE_KEY, USERS_PERMISSION
from app.users.models import ACTIVE, INACTIVE, StatusHistory, User, UserRole
from app.users.schemas import StatusChange, UserCreate, UserPatch

LAST_ADMIN = "This is the last active admin. Give another user the Admin role first."


def not_found() -> ApiError:
    return ApiError(404, "not_found", "User not found.")


def user_out(user: User, role: Role | None) -> dict:
    return {
        "id": user.id,
        "employee_id": user.employee_id,
        "full_name": user.full_name,
        "designation": user.designation,
        "mobile": user.mobile,
        "email": user.email,
        "role": {"id": role.id, "key": role.key, "name": role.name} if role else None,
        "status": user.status,
        "must_change_password": user.must_change_password,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
    }


def get_role_of(db: Session, user_id: uuid.UUID) -> Role | None:
    return db.scalar(
        select(Role).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
    )


def get_user(db: Session, user_id: uuid.UUID) -> tuple[User, Role | None]:
    user = db.get(User, user_id)
    if user is None:
        raise not_found()
    return user, get_role_of(db, user.id)


def list_users(
    db: Session,
    page: PageParams,
    q: str | None,
    status: str | None,
    role_id: uuid.UUID | None,
) -> tuple[list[dict], int]:
    stmt = (
        select(User, Role)
        .outerjoin(UserRole, UserRole.user_id == User.id)
        .outerjoin(Role, Role.id == UserRole.role_id)
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.employee_id.ilike(like)))
    if status:
        stmt = stmt.where(User.status == status)
    if role_id:
        stmt = stmt.where(Role.id == role_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(User.employee_id).offset(page.offset).limit(page.page_size)
    ).all()
    return [user_out(u, r) for u, r in rows], total


def _refuse_link_nurse(role: Role | None) -> None:
    """Link nurses are managed on their own page, which also ends their ward assignments."""
    if role and role.key == LINK_NURSE_KEY:
        raise ApiError(409, "conflict", "Link nurses are managed on the Link nurses page.")


def _active_admin_ids(db: Session) -> set[uuid.UUID]:
    """Active users whose role carries the `users` permission."""
    rows = db.scalars(
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(User.status == ACTIVE, Permission.code == USERS_PERMISSION)
    )
    return set(rows)


def _guard_not_last_admin(db: Session, user_id: uuid.UUID) -> None:
    admins = _active_admin_ids(db)
    if user_id in admins and not (admins - {user_id}):
        raise ApiError(409, "conflict", LAST_ADMIN)


def _role_has_users_permission(db: Session, role_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(RolePermission)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(RolePermission.role_id == role_id, Permission.code == USERS_PERMISSION)
        )
        or 0
    ) > 0


def _assignable_role(db: Session, role_id: uuid.UUID) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise field_error("role_id", "Choose a valid role.")
    if role.key == LINK_NURSE_KEY:
        raise field_error("role_id", "Link nurses are created on the Link nurses page.")
    return role


def create_user(
    db: Session, settings: Settings, ctx: AuthContext, data: UserCreate
) -> tuple[dict, str]:
    role = _assignable_role(db, data.role_id)
    employee_id = data.employee_id.upper()
    if db.scalar(select(User.id).where(User.employee_id == employee_id)):
        raise ApiError(409, "conflict", "This employee ID already has a login.")
    temp = temporary_password()
    user = User(
        tenant_id=ctx.tenant_id,
        employee_id=employee_id,
        full_name=data.full_name,
        designation=data.designation,
        mobile=data.mobile,
        email=data.email,
        password_hash=hash_password(temp, settings),
        must_change_password=True,
        status=ACTIVE,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "This employee ID already has a login.") from None
    db.add(UserRole(tenant_id=ctx.tenant_id, user_id=user.id, role_id=role.id))
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity="user",
        entity_id=user.id,
        action="create",
        summary=f"Created user {user.full_name} ({employee_id}) as {role.name}",
        new={
            "employee_id": employee_id,
            "full_name": user.full_name,
            "designation": user.designation,
            "role": role.name,
        },
        ip=ctx.ip,
    )
    db.commit()
    return user_out(user, role), temp


def update_user(db: Session, ctx: AuthContext, user_id: uuid.UUID, data: UserPatch) -> dict:
    user, role = get_user(db, user_id)
    if role and role.key == LINK_NURSE_KEY:
        raise ApiError(409, "conflict", "Link nurses are managed on the Link nurses page.")
    changes = data.model_dump(exclude_unset=True, exclude={"role_id"})
    old: dict = {}
    new: dict = {}
    for field, value in changes.items():
        if value is None:
            raise field_error(field, "This field cannot be empty.")
        if getattr(user, field) != value:
            old[field], new[field] = getattr(user, field), value
            setattr(user, field, value)
    if data.role_id is not None and (role is None or data.role_id != role.id):
        new_role = _assignable_role(db, data.role_id)
        if not _role_has_users_permission(db, new_role.id):
            _guard_not_last_admin(db, user.id)
        old["role"], new["role"] = (role.name if role else None), new_role.name
        row = db.get(UserRole, (user.id, role.id)) if role else None
        if row:
            db.delete(row)
            db.flush()
        db.add(UserRole(tenant_id=ctx.tenant_id, user_id=user.id, role_id=new_role.id))
        role = new_role
    if new:
        audit.record(
            db,
            tenant_id=ctx.tenant_id,
            actor=ctx.user,
            entity="user",
            entity_id=user.id,
            action="update",
            summary=f"Updated {user.full_name} ({user.employee_id}): {', '.join(sorted(new))}",
            old=old,
            new=new,
            ip=ctx.ip,
        )
    db.commit()
    return user_out(user, role)


def set_status(
    db: Session, ctx: AuthContext, user_id: uuid.UUID, data: StatusChange, now: datetime
) -> dict:
    user, role = get_user(db, user_id)
    _refuse_link_nurse(role)
    if user.status == data.status:
        raise ApiError(409, "conflict", f"This user is already {data.status}.")
    if data.status == INACTIVE:
        _guard_not_last_admin(db, user.id)
        revoke_user_sessions(db, user.id, now)
    old_status = user.status
    user.status = data.status
    db.add(
        StatusHistory(
            tenant_id=ctx.tenant_id,
            entity_type="user",
            entity_id=user.id,
            old_status=old_status,
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
        entity="user",
        entity_id=user.id,
        action="status_change",
        summary=f"Set {user.full_name} ({user.employee_id}) {data.status}: {data.reason}",
        old={"status": old_status},
        new={"status": data.status, "reason": data.reason},
        ip=ctx.ip,
    )
    db.commit()
    return user_out(user, role)


def reset_password(
    db: Session, settings: Settings, ctx: AuthContext, user_id: uuid.UUID, now: datetime
) -> tuple[dict, str]:
    user, role = get_user(db, user_id)
    _refuse_link_nurse(role)
    if user.status != ACTIVE:
        raise ApiError(409, "conflict", "Make the user active before resetting the password.")
    temp = temporary_password()
    user.password_hash = hash_password(temp, settings)
    user.must_change_password = True
    user.failed_attempts = 0
    user.locked_until = None
    revoke_user_sessions(db, user.id, now)
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity="user",
        entity_id=user.id,
        action="password_reset",
        summary=f"Reset password for {user.full_name} ({user.employee_id})",
        ip=ctx.ip,
    )
    db.commit()
    return user_out(user, role), temp
