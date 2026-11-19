"""Demo link nurses and demo ICN/QM users for the test instance (dummy data only).

Follows the approved prototype: 30 link nurses SN1001-SN1030, one ward each (ten wards have a
second nurse), Priya R. with ward history, and Preethi Z. inactive since 31 Oct 2026.
All demo users share the dummy password below and never have to change it.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.core.config import Settings
from app.core.db import set_tenant
from app.core.models import Tenant
from app.core.security import hash_password
from app.linknurses.models import WardAssignment
from app.masters.demo import WARDS
from app.masters.models import Department, Ward
from app.roles.models import Role
from app.users.models import ACTIVE, INACTIVE, StatusHistory, User, UserRole

DEMO_PASSWORD = "Demo-1234"  # noqa: S105  (dummy, test systems only)

NAMES = [
    "Priya R.", "Kavitha S.", "Anitha M.", "Deepa K.", "Lakshmi V.", "Revathi P.",
    "Sangeetha N.", "Divya T.", "Meena J.", "Saranya B.", "Gayathri L.", "Nandhini A.",
    "Suganya R.", "Pavithra S.", "Keerthana M.", "Jothi K.", "Vani P.", "Malathi G.",
    "Selvi D.", "Bhuvana C.", "Ramya H.", "Sowmya E.", "Indhu F.", "Shalini Q.",
    "Brindha U.", "Vidhya Y.", "Abirami O.", "Kalaivani I.", "Uma W.", "Preethi Z.",
]  # fmt: skip
SECOND = [0, 1, 5, 6, 9, 10, 11, 12, 13, 14]  # wards that get a second link nurse
FROM = date(2026, 1, 5)
TRAINING = date(2026, 1, 10)

STAFF = [
    ("ICN001", "Sr. Mary J.", "Infection Control Nurse", "9840000002", "icn"),
    ("QM001", "Dr. Arun K.", "Quality Manager", "9840000003", "qm"),
]


def _ward_index(i: int) -> int:
    return i if i < 20 else SECOND[i - 20]


def seed_demo_people(db: Session, tenant: Tenant, settings: Settings) -> tuple[int, int]:
    """Idempotent. Returns (link nurses created, staff users created). Needs the demo wards."""
    set_tenant(db, tenant.id)
    roles = {r.key: r for r in db.scalars(select(Role))}
    wards = {w.name: w for w in db.scalars(select(Ward))}
    depts = {d.id: d for d in db.scalars(select(Department))}
    existing = set(db.scalars(select(User.employee_id)))
    pw = hash_password(DEMO_PASSWORD, settings)

    staff_made = 0
    users: dict[str, User] = {}
    for emp, name, designation, mobile, role_key in STAFF:
        if emp in existing:
            continue
        user = User(
            tenant_id=tenant.id,
            employee_id=emp,
            full_name=name,
            designation=designation,
            mobile=mobile,
            email="",
            password_hash=pw,
            must_change_password=False,
            status=ACTIVE,
        )
        db.add(user)
        db.flush()
        db.add(UserRole(tenant_id=tenant.id, user_id=user.id, role_id=roles[role_key].id))
        users[emp] = user
        staff_made += 1
    icn = users.get("ICN001") or db.scalar(select(User).where(User.employee_id == "ICN001"))

    made = 0
    for i, name in enumerate(NAMES):
        emp = f"SN{1001 + i}"
        if emp in existing:
            continue
        ward = wards[WARDS[_ward_index(i)][0]]
        dept = depts[ward.department_id]
        nurse = User(
            tenant_id=tenant.id,
            employee_id=emp,
            full_name=name,
            designation="Sister" if i % 3 == 0 else "Staff Nurse",
            mobile="98400" + str(10000 + i * 137)[-5:],
            email="",
            password_hash=pw,
            must_change_password=False,
            status=ACTIVE,
            department_id=dept.id,
            link_nurse_from=FROM,
            who5_training_date=TRAINING,
        )
        db.add(nurse)
        db.flush()
        db.add(UserRole(tenant_id=tenant.id, user_id=nurse.id, role_id=roles["link_nurse"].id))

        def assign(w: Ward, start: date, end: date | None = None, nurse: User = nurse) -> None:
            db.add(
                WardAssignment(
                    tenant_id=tenant.id,
                    user_id=nurse.id,
                    ward_id=w.id,
                    from_date=start,
                    to_date=end,
                    created_by=icn.id if icn else None,
                )
            )

        if i == 0:  # Priya R.: Ward 2 until May, MICU from June, SICU added in September
            assign(wards["Ward 2 – Surgery"], FROM, date(2026, 5, 31))
            assign(wards["MICU"], date(2026, 6, 1))
            assign(wards["SICU"], date(2026, 9, 1))
        elif i == len(NAMES) - 1:  # Preethi Z.: inactive since 31 Oct 2026
            assign(ward, FROM, date(2026, 10, 31))
            nurse.status = INACTIVE
            db.add(
                StatusHistory(
                    tenant_id=tenant.id,
                    entity_type="link_nurse",
                    entity_id=nurse.id,
                    old_status=ACTIVE,
                    new_status=INACTIVE,
                    reason="Moved to OT as scrub nurse",
                    effective_date=date(2026, 10, 31),
                    changed_by=icn.id if icn else None,
                )
            )
            audit.record(
                db,
                tenant_id=tenant.id,
                actor=icn,
                entity="link_nurse",
                entity_id=nurse.id,
                action="status_change",
                summary=f"Set {name} ({emp}) Inactive: Moved to OT as scrub nurse (demo data)",
                new={"status": INACTIVE},
            )
        else:
            assign(ward, FROM)
        made += 1
    db.flush()
    return made, staff_made
