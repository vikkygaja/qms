"""Operator commands: `python -m app.cli <migrate|init|create-admin>`.

These run as the database OWNER (provisioning), never as the API's runtime role.
"""

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.core.config import Settings, get_settings
from app.core.db import make_engine, set_tenant
from app.core.security import hash_password, password_policy_error, temporary_password
from app.linknurses.demo import seed_demo_people
from app.masters import service as masters_service
from app.masters.demo import seed_demo
from app.roles.models import Role
from app.roles.seed import ADMIN_KEY, ensure_catalog, ensure_tenant
from app.users.models import ACTIVE, User, UserRole

BACKEND_DIR = Path(__file__).resolve().parent.parent
APP_ROLE = "qms_app"


def alembic_config(settings: Settings) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    url = settings.database_url.get_secret_value().replace("%", "%%")
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def bootstrap_app_role(settings: Settings) -> None:
    """Create (or refresh the password of) the non-superuser runtime role `qms_app`."""
    if settings.app_database_url is None:
        return
    runtime = make_url(settings.app_database_url.get_secret_value())
    if runtime.username != APP_ROLE or not runtime.password:
        raise SystemExit(f"APP_DATABASE_URL must use the role {APP_ROLE} with a password")
    owner = make_url(settings.database_url.get_secret_value()).set(drivername="postgresql")
    with psycopg.connect(owner.render_as_string(hide_password=False), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_ROLE,)).fetchone()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(
            sql.SQL(f"{verb} ROLE {{}} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD {{}}").format(
                sql.Identifier(APP_ROLE), sql.Literal(runtime.password)
            )
        )


def run_migrations(settings: Settings) -> None:
    bootstrap_app_role(settings)
    command.upgrade(alembic_config(settings), "head")


def _init(settings: Settings) -> int:
    engine = make_engine(settings.database_url.get_secret_value())
    with Session(engine) as db:
        tenant = ensure_tenant(db, settings.default_tenant_code, settings.default_tenant_name)
        ensure_catalog(db, tenant)
        masters_service.ensure_defaults(db, tenant)
        db.commit()
    engine.dispose()
    print(f"Tenant {settings.default_tenant_code} is ready.")
    return 0


def _seed_demo(settings: Settings, force: bool) -> int:
    if settings.env != "development" and not force:
        print(
            "Refusing to load demo data: ENV is not 'development'. "
            "Use --force only on a test system.",
            file=sys.stderr,
        )
        return 1
    engine = make_engine(settings.database_url.get_secret_value())
    try:
        with Session(engine) as db:
            tenant = ensure_tenant(db, settings.default_tenant_code, settings.default_tenant_name)
            ensure_catalog(db, tenant)
            masters_service.ensure_defaults(db, tenant)
            depts, wards = seed_demo(db, tenant)
            nurses, staff = seed_demo_people(db, tenant, settings)
            db.commit()
    finally:
        engine.dispose()
    print(
        f"Demo data ready: {depts} departments, {wards} wards, "
        f"{nurses} link nurses and {staff} staff users added."
    )
    return 0


def _create_admin(settings: Settings, args: argparse.Namespace) -> int:
    employee_id = args.employee_id.strip().upper()
    provided = os.environ.get("QMS_ADMIN_PASSWORD")
    password = provided or temporary_password()
    force_change = args.force_change or not provided
    problem = password_policy_error(password)
    if problem:
        print(f"Password rejected: {problem}", file=sys.stderr)
        return 1
    engine = make_engine(settings.database_url.get_secret_value())
    try:
        with Session(engine) as db:
            tenant = ensure_tenant(db, settings.default_tenant_code, settings.default_tenant_name)
            ensure_catalog(db, tenant)
            set_tenant(db, tenant.id)
            if db.scalar(select(User.id).where(User.employee_id == employee_id)):
                print(f"User {employee_id} already exists.", file=sys.stderr)
                return 1
            role = db.scalar(select(Role).where(Role.key == ADMIN_KEY))
            user = User(
                tenant_id=tenant.id,
                employee_id=employee_id,
                full_name=args.name.strip(),
                designation=args.designation.strip(),
                mobile=args.mobile.strip(),
                email="",
                password_hash=hash_password(password, settings),
                must_change_password=force_change,
                status=ACTIVE,
                created_at=datetime.now(UTC),
            )
            db.add(user)
            db.flush()
            db.add(UserRole(tenant_id=tenant.id, user_id=user.id, role_id=role.id))
            audit.record(
                db,
                tenant_id=tenant.id,
                actor=None,
                entity="user",
                entity_id=user.id,
                action="create",
                summary=f"Created admin {user.full_name} ({employee_id}) from the command line",
                new={"employee_id": employee_id, "role": role.name},
            )
            db.commit()
    finally:
        engine.dispose()
    print(f"Admin {employee_id} created.")
    if not provided:
        print("Temporary password (shown once, change required at first sign-in):")
        print(f"TEMP:{password}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="create the runtime DB role and upgrade the schema")
    sub.add_parser("init", help="create the default tenant, permissions and roles (idempotent)")
    demo = sub.add_parser("seed-demo", help="load dummy departments and wards (test systems only)")
    demo.add_argument("--force", action="store_true", help="allow outside ENV=development")
    admin = sub.add_parser("create-admin", help="create an Admin user")
    admin.add_argument("--employee-id", required=True)
    admin.add_argument("--name", required=True)
    admin.add_argument("--designation", default="IT Manager")
    admin.add_argument("--mobile", default="0000000000")
    admin.add_argument(
        "--force-change",
        action="store_true",
        help="require a new password at first sign-in (default only when none is supplied)",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    if args.cmd == "migrate":
        run_migrations(settings)
        print("Database is up to date.")
        return 0
    if args.cmd == "init":
        return _init(settings)
    if args.cmd == "seed-demo":
        return _seed_demo(settings, args.force)
    return _create_admin(settings, args)


if __name__ == "__main__":
    sys.exit(main())
