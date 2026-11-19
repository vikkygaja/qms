import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.audit.models import AuditLog
from app.auth.deps import get_db, require_users
from app.core.pagination import PageParams, page_of, page_params
from app.users.models import User

router = APIRouter(tags=["audit"], dependencies=[Depends(require_users)])
IST = ZoneInfo("Asia/Kolkata")


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=IST)


@router.get("/audit-log")
def list_audit_log(
    entity: str | None = Query(None, max_length=32),
    action: str | None = Query(None, max_length=32),
    actor_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = Query(None, max_length=100),
    page: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
):
    """Newest first. Date filters are Asia/Kolkata calendar days (inclusive)."""
    stmt = select(AuditLog, User).outerjoin(User, User.id == AuditLog.actor_user_id)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_user_id == actor_id)
    if date_from:
        stmt = stmt.where(AuditLog.at >= _day_start(date_from))
    if date_to:
        stmt = stmt.where(AuditLog.at < _day_start(date_to + timedelta(days=1)))
    if q:
        stmt = stmt.where(AuditLog.summary.ilike(f"%{q.strip()}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(AuditLog.at.desc(), AuditLog.id.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).all()
    items = [audit_service.item(a, u) for a, u in rows]
    return page_of(items, total, page)
