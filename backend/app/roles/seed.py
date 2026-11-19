"""Idempotent provisioning of a tenant's permission catalogue and default roles."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import set_tenant
from app.core.models import Tenant
from app.roles.models import Permission, Role, RolePermission

PERMISSIONS: list[tuple[str, str]] = [
    ("masters", "Manage masters (wards, departments, categories)"),
    ("users", "Manage users and roles (all)"),
    ("ln", "Manage link nurses (create login, wards, active/inactive)"),
    ("record", "Record hand hygiene sessions"),
    ("review", "Review / reject sessions"),
    ("targets", "Set ward targets"),
    ("dash", "View dashboards"),
    ("alerts", "Receive low-compliance alerts"),
    ("reports", "Reports and exports"),
]

# key -> (name, permission codes); matches docs/roles-permissions.md
DEFAULT_ROLES: dict[str, tuple[str, list[str]]] = {
    "admin": ("Admin", ["masters", "users", "ln", "targets", "dash", "reports"]),
    "icn": ("ICN", ["ln", "record", "review", "targets", "dash", "alerts", "reports"]),
    "qm": ("Quality Manager", ["dash", "alerts", "reports"]),
    "link_nurse": ("Link nurse", ["record", "dash"]),
}
LINK_NURSE_KEY = "link_nurse"
ADMIN_KEY = "admin"
USERS_PERMISSION = "users"


def ensure_tenant(db: Session, code: str, name: str) -> Tenant:
    tenant = db.scalar(select(Tenant).where(Tenant.code == code))
    if tenant is None:
        tenant = Tenant(code=code, name=name)
        db.add(tenant)
        db.flush()
    return tenant


def ensure_catalog(db: Session, tenant: Tenant) -> None:
    """Create missing permissions and roles. Existing roles are never modified."""
    set_tenant(db, tenant.id)
    existing = {
        p.code: p for p in db.scalars(select(Permission).where(Permission.tenant_id == tenant.id))
    }
    for code, description in PERMISSIONS:
        if code not in existing:
            existing[code] = Permission(tenant_id=tenant.id, code=code, description=description)
            db.add(existing[code])
    db.flush()
    roles = {r.key for r in db.scalars(select(Role).where(Role.tenant_id == tenant.id))}
    for key, (name, codes) in DEFAULT_ROLES.items():
        if key in roles:
            continue
        role = Role(tenant_id=tenant.id, key=key, name=name, is_system=True)
        db.add(role)
        db.flush()
        for code in codes:
            db.add(
                RolePermission(
                    tenant_id=tenant.id, role_id=role.id, permission_id=existing[code].id
                )
            )
    db.flush()
