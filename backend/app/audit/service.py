from typing import Any

from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.users.models import User


def item(entry: AuditLog, actor: User | None) -> dict:
    """API shape of one audit row (shared by /audit-log and /link-nurses/recent-changes)."""
    return {
        "id": entry.id,
        "at": entry.at,
        "actor": (
            {"id": actor.id, "employee_id": actor.employee_id, "full_name": actor.full_name}
            if actor
            else None
        ),
        "entity": entry.entity,
        "entity_id": entry.entity_id,
        "action": entry.action,
        "summary": entry.summary,
        "old_values": entry.old_values,
        "new_values": entry.new_values,
    }


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
