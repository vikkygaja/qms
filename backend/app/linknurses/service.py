import uuid
from datetime import date, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.audit.models import AuditLog
from app.auth.deps import AuthContext
from app.auth.service import revoke_user_sessions
from app.core.config import Settings
from app.core.errors import ApiError, field_error
from app.core.pagination import PageParams
from app.core.security import hash_password, temporary_password
from app.core.timeutil import today_ist
from app.linknurses.models import WardAssignment
from app.linknurses.schemas import LinkNurseCreate, LinkNursePatch, LinkNurseStatus
from app.masters.models import Department, Ward
from app.roles.models import Role
from app.roles.seed import LINK_NURSE_KEY
from app.users.models import ACTIVE, INACTIVE, StatusHistory, User, UserRole

ENTITY = "link_nurse"
DUPLICATE_ID = "This employee ID already has a login."


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Link nurse not found.")


def _label(user: User) -> str:
    return f"{user.full_name} ({user.employee_id})"


# ---------------------------------------------------------------- shaping


def _current_wards(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Ward]]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(WardAssignment.user_id, Ward)
        .join(Ward, Ward.id == WardAssignment.ward_id)
        .where(WardAssignment.user_id.in_(user_ids), WardAssignment.to_date.is_(None))
        .order_by(func.lower(Ward.name))
    ).all()
    out: dict[uuid.UUID, list[Ward]] = {uid: [] for uid in user_ids}
    for uid, ward in rows:
        out[uid].append(ward)
    return out


def nurse_out(user: User, dept: Department | None, wards: list[Ward]) -> dict:
    return {
        "id": user.id,
        "employee_id": user.employee_id,
        "full_name": user.full_name,
        "designation": user.designation,
        "department": {"id": dept.id, "name": dept.name} if dept else None,
        "mobile": user.mobile,
        "email": user.email,
        "link_nurse_from": user.link_nurse_from,
        "who5_training_date": user.who5_training_date,
        "status": user.status,
        "must_change_password": user.must_change_password,
        "wards": [{"id": w.id, "name": w.name} for w in wards],
        # Placeholders until session entry exists (Slice 5/6)
        "sessions_this_month": 0,
        "last_entry_date": None,
        "no_entry_flag": False,
    }


def detail_out(db: Session, user: User) -> dict:
    dept = db.get(Department, user.department_id) if user.department_id else None
    wards = _current_wards(db, [user.id])[user.id]
    out = nurse_out(user, dept, wards)
    assignments = db.execute(
        select(WardAssignment, Ward)
        .join(Ward, Ward.id == WardAssignment.ward_id)
        .where(WardAssignment.user_id == user.id)
        .order_by(WardAssignment.from_date.desc(), WardAssignment.created_at.desc())
    ).all()
    out["assignments"] = [
        {
            "ward": {"id": w.id, "name": w.name},
            "from_date": a.from_date,
            "to_date": a.to_date,
        }
        for a, w in assignments
    ]
    history = db.execute(
        select(StatusHistory, User)
        .outerjoin(User, User.id == StatusHistory.changed_by)
        .where(StatusHistory.entity_type == ENTITY, StatusHistory.entity_id == user.id)
        .order_by(StatusHistory.changed_at.desc())
    ).all()
    out["status_history"] = [
        {
            "old_status": h.old_status,
            "new_status": h.new_status,
            "reason": h.reason,
            "effective_date": h.effective_date,
            "changed_at": h.changed_at,
            "changed_by": {"id": u.id, "full_name": u.full_name} if u else None,
        }
        for h, u in history
    ]
    return out


# ---------------------------------------------------------------- lookups


def get_nurse(db: Session, user_id: uuid.UUID) -> User:
    user = db.scalar(
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(User.id == user_id, Role.key == LINK_NURSE_KEY)
    )
    if user is None:
        raise not_found()
    return user


def _active_department(db: Session, department_id: uuid.UUID) -> Department:
    dept = db.get(Department, department_id)
    if dept is None or dept.status != ACTIVE:
        raise field_error("department_id", "Choose an active department.")
    return dept


def _wards_by_id(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, Ward]:
    rows = db.scalars(select(Ward).where(Ward.id.in_(ids))).all()
    return {w.id: w for w in rows}


def _names(wards) -> str:
    return ", ".join(sorted((w.name for w in wards), key=str.lower))


# ---------------------------------------------------------------- list


def list_nurses(
    db: Session,
    page: PageParams,
    q: str | None,
    ward_id: uuid.UUID | None,
    status: str | None,
    sort: str,
    order: str,
) -> tuple[list[dict], int]:
    stmt = (
        select(User, Department)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(Role.key == LINK_NURSE_KEY)
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(User.full_name.ilike(like) | User.employee_id.ilike(like))
    if status:
        stmt = stmt.where(User.status == status)
    if ward_id:
        stmt = stmt.where(
            exists().where(
                WardAssignment.user_id == User.id,
                WardAssignment.ward_id == ward_id,
                WardAssignment.to_date.is_(None),
            )
        )
    column = {
        "name": func.lower(User.full_name),
        "employee_id": User.employee_id,
        "status": User.status,
    }[sort]
    primary = column.desc() if order == "desc" else column.asc()
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(primary, func.lower(User.full_name)).offset(page.offset).limit(page.page_size)
    ).all()
    wards = _current_wards(db, [u.id for u, _ in rows])
    return [nurse_out(u, d, wards[u.id]) for u, d in rows], total


# ---------------------------------------------------------------- create


def create_nurse(
    db: Session, settings: Settings, ctx: AuthContext, data: LinkNurseCreate, now: datetime
) -> tuple[dict, str]:
    dept = _active_department(db, data.department_id)
    wards = _wards_by_id(db, data.ward_ids)
    if len(wards) != len(data.ward_ids) or any(w.status != ACTIVE for w in wards.values()):
        raise field_error("ward_ids", "Choose active wards.")
    employee_id = data.employee_id.upper()
    if db.scalar(select(User.id).where(User.employee_id == employee_id)):
        raise ApiError(409, "conflict", DUPLICATE_ID)
    role = db.scalar(select(Role).where(Role.key == LINK_NURSE_KEY))
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
        department_id=dept.id,
        link_nurse_from=data.link_nurse_from,
        who5_training_date=data.who5_training_date,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", DUPLICATE_ID) from None
    db.add(UserRole(tenant_id=ctx.tenant_id, user_id=user.id, role_id=role.id))
    for ward_id in data.ward_ids:
        db.add(
            WardAssignment(
                tenant_id=ctx.tenant_id,
                user_id=user.id,
                ward_id=ward_id,
                from_date=data.link_nurse_from,
                created_by=ctx.user.id,
            )
        )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=ENTITY,
        entity_id=user.id,
        action="create",
        summary=f"Created link nurse {_label(user)} and login",
        new={
            "employee_id": employee_id,
            "full_name": user.full_name,
            "designation": user.designation,
            "department": dept.name,
            "link_nurse_from": data.link_nurse_from.isoformat(),
        },
        ip=ctx.ip,
    )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=ENTITY,
        entity_id=user.id,
        action="ward_change",
        summary=f"Assigned {_names(wards.values())} to {_label(user)}",
        new={"wards": sorted(w.name for w in wards.values())},
        ip=ctx.ip,
    )
    db.commit()
    return detail_out(db, user), temp


# ---------------------------------------------------------------- edit


def update_nurse(db: Session, ctx: AuthContext, user_id: uuid.UUID, data: LinkNursePatch) -> dict:
    user = get_nurse(db, user_id)
    fields = data.model_dump(exclude_unset=True)
    old: dict = {}
    new: dict = {}

    def show(value):
        return value.isoformat() if isinstance(value, date) else value

    for name in ("full_name", "designation", "mobile", "email", "link_nurse_from"):
        if name not in fields:
            continue
        value = fields[name]
        if value is None:
            raise field_error(name, "This field cannot be empty.")
        if getattr(user, name) != value:
            old[name], new[name] = show(getattr(user, name)), show(value)
            setattr(user, name, value)
    if "who5_training_date" in fields and user.who5_training_date != fields["who5_training_date"]:
        old["who5_training_date"] = show(user.who5_training_date)
        new["who5_training_date"] = show(fields["who5_training_date"])
        user.who5_training_date = fields["who5_training_date"]
    if "department_id" in fields:
        if fields["department_id"] is None:
            raise field_error("department_id", "Choose an active department.")
        if fields["department_id"] != user.department_id:
            dept = _active_department(db, fields["department_id"])
            before = db.get(Department, user.department_id) if user.department_id else None
            old["department"], new["department"] = (before.name if before else None), dept.name
            user.department_id = dept.id
    if new:
        audit.record(
            db,
            tenant_id=ctx.tenant_id,
            actor=ctx.user,
            entity=ENTITY,
            entity_id=user.id,
            action="update",
            summary=f"Updated details of {_label(user)}: {', '.join(sorted(new))}",
            old=old,
            new=new,
            ip=ctx.ip,
        )
    db.commit()
    return detail_out(db, user)


# ---------------------------------------------------------------- wards


def set_wards(
    db: Session, ctx: AuthContext, user_id: uuid.UUID, ward_ids: list[uuid.UUID], now: datetime
) -> dict:
    user = get_nurse(db, user_id)
    if user.status != ACTIVE:
        raise ApiError(409, "conflict", "Make the link nurse active first.")
    if not ward_ids:
        raise field_error(
            "ward_ids", "Keep at least one ward, or make the link nurse inactive instead."
        )
    current_rows = db.scalars(
        select(WardAssignment).where(
            WardAssignment.user_id == user.id, WardAssignment.to_date.is_(None)
        )
    ).all()
    current = {r.ward_id: r for r in current_rows}
    wanted = set(ward_ids)
    wards = _wards_by_id(db, list(wanted | set(current)))
    added = [w for w in ward_ids if w not in current]
    for ward_id in added:
        ward = wards.get(ward_id)
        if ward is None or ward.status != ACTIVE:
            raise field_error("ward_ids", "Choose active wards.")
    removed = [wid for wid in current if wid not in wanted]
    if not added and not removed:
        return detail_out(db, user)

    today = today_ist(now)
    for wid in removed:
        row = current[wid]
        row.to_date = max(today, row.from_date)
        row.ended_by = ctx.user.id
    for wid in added:
        db.add(
            WardAssignment(
                tenant_id=ctx.tenant_id,
                user_id=user.id,
                ward_id=wid,
                from_date=today,
                created_by=ctx.user.id,
            )
        )
    db.flush()
    before = sorted(wards[w].name for w in current)
    after = sorted(wards[w].name for w in wanted)
    parts = []
    if added:
        parts.append(f"Assigned {_names(wards[w] for w in added)} to {_label(user)}")
    if removed:
        parts.append(f"Ended {_names(wards[w] for w in removed)} for {_label(user)}")
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=ENTITY,
        entity_id=user.id,
        action="ward_change",
        summary="; ".join(parts),
        old={"wards": before},
        new={"wards": after},
        ip=ctx.ip,
    )
    db.commit()
    return detail_out(db, user)


# ---------------------------------------------------------------- status


def set_status(
    db: Session, ctx: AuthContext, user_id: uuid.UUID, data: LinkNurseStatus, now: datetime
) -> dict:
    user = get_nurse(db, user_id)
    today = today_ist(now)
    effective = data.effective_date or today
    if effective > today:
        raise field_error("effective_date", "The date cannot be in the future.")
    if user.status == data.status:
        raise ApiError(409, "conflict", f"This link nurse is already {data.status}.")

    old_status = user.status
    ended: list[str] = []
    if data.status == INACTIVE:
        rows = db.execute(
            select(WardAssignment, Ward)
            .join(Ward, Ward.id == WardAssignment.ward_id)
            .where(WardAssignment.user_id == user.id, WardAssignment.to_date.is_(None))
        ).all()
        for assignment, ward in rows:
            assignment.to_date = max(effective, assignment.from_date)
            assignment.ended_by = ctx.user.id
            ended.append(ward.name)
        revoke_user_sessions(db, user.id, now)
    user.status = data.status
    db.add(
        StatusHistory(
            tenant_id=ctx.tenant_id,
            entity_type=ENTITY,
            entity_id=user.id,
            old_status=old_status,
            new_status=data.status,
            reason=data.reason,
            effective_date=effective,
            changed_by=ctx.user.id,
            changed_at=now,
        )
    )
    audit.record(
        db,
        tenant_id=ctx.tenant_id,
        actor=ctx.user,
        entity=ENTITY,
        entity_id=user.id,
        action="status_change",
        summary=f"Set {_label(user)} {data.status}: {data.reason}",
        old={"status": old_status},
        new={
            "status": data.status,
            "reason": data.reason,
            "effective_date": effective.isoformat(),
            "ended_wards": sorted(ended),
        },
        ip=ctx.ip,
    )
    db.commit()
    return detail_out(db, user)


def reset_password(
    db: Session, settings: Settings, ctx: AuthContext, user_id: uuid.UUID, now: datetime
) -> tuple[dict, str]:
    user = get_nurse(db, user_id)
    if user.status != ACTIVE:
        raise ApiError(409, "conflict", "Make the link nurse active before resetting the password.")
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
        entity=ENTITY,
        entity_id=user.id,
        action="password_reset",
        summary=f"Reset password for {_label(user)}",
        ip=ctx.ip,
    )
    db.commit()
    return detail_out(db, user), temp


def recent_changes(db: Session, limit: int) -> list[dict]:
    rows = db.execute(
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.entity == ENTITY)
        .order_by(AuditLog.at.desc(), AuditLog.id.desc())
        .limit(limit)
    ).all()
    return [audit.item(a, u) for a, u in rows]
