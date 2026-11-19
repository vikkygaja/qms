import re
import uuid
from collections import defaultdict

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.deps import AuthContext
from app.core.errors import ApiError, field_error
from app.roles.models import Permission, Role, RolePermission
from app.roles.seed import ADMIN_KEY, PERMISSIONS, USERS_PERMISSION
from app.users.models import ACTIVE, User, UserRole

ORDER = {code: i for i, (code, _) in enumerate(PERMISSIONS)}
NEW_ROLE_DEFAULT = ["dash"]


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Role not found.")


def list_permissions(db: Session) -> list[dict]:
    rows = db.scalars(select(Permission)).all()
    return [
        {"code": p.code, "description": p.description}
        for p in sorted(rows, key=lambda p: ORDER.get(p.code, 99))
    ]


def _permissions_by_role(db: Session) -> dict[uuid.UUID, list[str]]:
    result: dict[uuid.UUID, list[str]] = defaultdict(list)
    rows = db.execute(
        select(RolePermission.role_id, Permission.code).join(
            Permission, Permission.id == RolePermission.permission_id
        )
    ).all()
    for role_id, code in rows:
        result[role_id].append(code)
    return {k: sorted(v, key=lambda c: ORDER.get(c, 99)) for k, v in result.items()}


def _role_out(role: Role, perms: list[str], count: int) -> dict:
    return {
        "id": role.id,
        "key": role.key,
        "name": role.name,
        "is_system": role.is_system,
        "permissions": perms,
        "active_user_count": count,
    }


def list_roles(db: Session) -> list[dict]:
    perms = _permissions_by_role(db)
    counts = dict(
        db.execute(
            select(UserRole.role_id, func.count())
            .join(User, User.id == UserRole.user_id)
            .where(User.status == ACTIVE)
            .group_by(UserRole.role_id)
        ).all()
    )
    roles = db.scalars(select(Role).order_by(Role.is_system.desc(), Role.created_at)).all()
    return [_role_out(r, perms.get(r.id, []), counts.get(r.id, 0)) for r in roles]


def get_role_out(db: Session, role_id: uuid.UUID) -> dict:
    for r in list_roles(db):
        if r["id"] == role_id:
            return r
    raise not_found()


def create_role(db: Session, ctx: AuthContext, name: str) -> dict:
    name = name.strip()
    if not name:
        raise field_error("name", "Enter a role name.")
    if len(name) > 100:
        raise field_error("name", "Use at most 100 characters.")
    names = {n.lower() for n in db.scalars(select(Role.name))}
    if name.lower() in names:
        raise ApiError(409, "conflict", "That role already exists.")
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "role"
    keys = set(db.scalars(select(Role.key)))
    key, n = base, 2
    while key in keys:
        key, n = f"{base}_{n}", n + 1
    role = Role(tenant_id=ctx.tenant_id, key=key, name=name, is_system=False)
    db.add(role)
    db.flush()
    catalogue = {p.code: p for p in db.scalars(select(Permission))}
    for code in NEW_ROLE_DEFAULT:
        db.add(
            RolePermission(
                tenant_id=ctx.tenant_id, role_id=role.id, permission_id=catalogue[code].id
            )
        )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity="role",
        entity_id=role.id,
        action="role_create",
        summary=f"Created role {name}",
        new={"name": name, "permissions": NEW_ROLE_DEFAULT},
        ip=ctx.ip,
    )
    db.commit()
    return get_role_out(db, role.id)


def set_permissions(db: Session, ctx: AuthContext, role_id: uuid.UUID, codes: list[str]) -> dict:
    role = db.get(Role, role_id)
    if role is None:
        raise not_found()
    catalogue = {p.code: p for p in db.scalars(select(Permission))}
    wanted = sorted(set(codes), key=lambda c: ORDER.get(c, 99))
    unknown = [c for c in wanted if c not in catalogue]
    if unknown:
        raise field_error("permissions", f"Unknown permission: {unknown[0]}")
    if role.key == ADMIN_KEY and USERS_PERMISSION not in wanted:
        raise ApiError(409, "conflict", "Admin always keeps the permission to manage users.")
    old = _permissions_by_role(db).get(role.id, [])
    db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    for code in wanted:
        db.add(
            RolePermission(
                tenant_id=ctx.tenant_id, role_id=role.id, permission_id=catalogue[code].id
            )
        )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity="role",
        entity_id=role.id,
        action="permission_change",
        summary=f"Changed permissions of role {role.name}",
        old={"permissions": old},
        new={"permissions": wanted},
        ip=ctx.ip,
    )
    db.commit()
    return get_role_out(db, role.id)
