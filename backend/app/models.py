"""Import every model so Base.metadata knows all tables (used by Alembic)."""

from app.audit.models import AuditLog
from app.auth.models import UserSession
from app.core.models import Tenant
from app.roles.models import Permission, Role, RolePermission
from app.users.models import StatusHistory, User, UserRole

__all__ = [
    "AuditLog",
    "Permission",
    "Role",
    "RolePermission",
    "StatusHistory",
    "Tenant",
    "User",
    "UserRole",
    "UserSession",
]
