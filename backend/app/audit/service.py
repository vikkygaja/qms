from typing import Any

from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.users.models import User


def record(
    db: Session,
    *,
    tenant_id,
    actor: User | None,
    entity: str,
    entity_id: Any,
    action: str,
    summary: str,
    old: dict | None = None,
    new: dict | None = None,
    ip: str | None = None,
) -> AuditLog:
    """Append one audit row in the caller's transaction. Never pass passwords or tokens."""
    entry = AuditLog(
        tenant_id=tenant_id,
        actor_user_id=actor.id if actor else None,
        entity=entity,
        entity_id=str(entity_id),
        action=action,
        summary=summary,
        old_values=old,
        new_values=new,
        ip=ip,
    )
    db.add(entry)
    db.flush()
    return entry
