import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.models import UserSession
from app.core.config import Settings
from app.core.errors import ApiError, field_error
from app.core.security import (
    burn_verify_time,
    hash_password,
    hash_token,
    new_token,
    password_policy_error,
    verify_password,
)
from app.users.models import ACTIVE, User

WRONG_CREDENTIALS = "Employee ID or password is incorrect."
INACTIVE_MESSAGE = "This account is inactive. Contact the ICN or IT."


def revoke_user_sessions(
    db: Session, user_id: uuid.UUID, now: datetime, except_session_id: uuid.UUID | None = None
) -> None:
    stmt = (
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    db.execute(stmt)


def login(
    db: Session,
    settings: Settings,
    *,
    tenant_id: uuid.UUID,
    employee_id: str,
    password: str,
    now: datetime,
    ip: str | None,
    user_agent: str | None,
) -> tuple[str, UserSession, User]:
    """Returns (cookie token, session, user). Commits failures itself so counters persist."""
    user = db.scalar(
        select(User).where(User.tenant_id == tenant_id, User.employee_id == employee_id.upper())
    )
    if user is None:
        burn_verify_time(password)
        raise ApiError(401, "unauthenticated", WRONG_CREDENTIALS)

    if user.locked_until and user.locked_until > now:
        raise ApiError(
            423,
            "locked",
            f"Too many failed attempts. Try again in {settings.lockout_minutes} minutes.",
        )

    if not verify_password(user.password_hash, password):
        user.failed_attempts += 1
        if user.failed_attempts >= settings.lockout_attempts:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_attempts = 0
            audit.record(
                db,
                tenant_id=tenant_id,
                actor=None,
                entity="user",
                entity_id=user.id,
                action="account_locked",
                summary=f"Locked {user.full_name} ({user.employee_id}) after failed sign-ins",
                ip=ip,
            )
        db.commit()
        raise ApiError(401, "unauthenticated", WRONG_CREDENTIALS)

    if user.status != ACTIVE:
        raise ApiError(403, "inactive_account", INACTIVE_MESSAGE)

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    token = new_token()
    session = UserSession(
        tenant_id=tenant_id,
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token=new_token(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_absolute_hours),
        ip=ip,
        user_agent=(user_agent or "")[:300] or None,
    )
    db.add(session)
    db.commit()
    return f"{tenant_id}.{token}", session, user


def logout(db: Session, session: UserSession, now: datetime) -> None:
    session.revoked_at = now
    db.commit()


def change_password(
    db: Session,
    settings: Settings,
    *,
    user: User,
    session: UserSession,
    current_password: str,
    new_password: str,
    now: datetime,
    ip: str | None,
) -> None:
    if not verify_password(user.password_hash, current_password):
        raise field_error("current_password", "Current password is incorrect.")
    problem = password_policy_error(new_password)
    if problem:
        raise field_error("new_password", problem)
    if new_password == current_password:
        raise field_error("new_password", "Choose a password different from the current one.")
    user.password_hash = hash_password(new_password, settings)
    user.must_change_password = False
    revoke_user_sessions(db, user.id, now, except_session_id=session.id)
    audit.record(
        db,
        tenant_id=user.tenant_id,
        actor=user,
        entity="user",
        entity_id=user.id,
        action="password_change",
        summary=f"{user.full_name} ({user.employee_id}) changed their password",
        ip=ip,
    )
    db.commit()
