"""Demo data for the test instance (dummy only): the approved prototype's departments and wards."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.core.db import set_tenant
from app.core.models import Tenant
from app.masters.models import Department, Ward
from app.users.models import ACTIVE

# (ward, monthly opportunity target, department) - targets total 1000, as in the prototype
WARDS: list[tuple[str, int, str]] = [
    ("MICU", 65, "Critical Care"),
    ("SICU", 65, "Critical Care"),
    ("NICU", 65, "Critical Care"),
    ("PICU", 65, "Critical Care"),
    ("CCU", 65, "Critical Care"),
    ("Emergency", 70, "Emergency"),
    ("OT Complex", 60, "Surgery"),
    ("Dialysis", 40, "Nephrology"),
    ("Cath Lab", 35, "Cardiology"),
    ("Ward 1 – Medicine", 50, "Medicine"),
    ("Ward 2 – Surgery", 50, "Surgery"),
    ("Ward 3 – Ortho", 50, "Orthopaedics"),
    ("Ward 4 – OBG", 50, "Women & Child"),
    ("Ward 5 – Paediatrics", 50, "Women & Child"),
    ("Ward 6 – Neuro", 50, "Neurology"),
    ("Ward 7 – Cardiac", 50, "Cardiology"),
    ("Ward 8 – Oncology", 50, "Oncology"),
    ("Private Ward A", 30, "Medicine"),
    ("Private Ward B", 30, "Medicine"),
    ("OPD", 10, "Outpatient"),
]


def seed_demo(db: Session, tenant: Tenant) -> tuple[int, int]:
    """Idempotent: adds missing departments and wards, never edits existing ones."""
    set_tenant(db, tenant.id)
    depts = {d.name.lower(): d for d in db.scalars(select(Department))}
    wards = {w.name.lower() for w in db.scalars(select(Ward))}
    made_depts = made_wards = 0
    for ward_name, target, dept_name in WARDS:
        dept = depts.get(dept_name.lower())
        if dept is None:
            dept = Department(tenant_id=tenant.id, name=dept_name, status=ACTIVE)
            db.add(dept)
            db.flush()
            depts[dept_name.lower()] = dept
            made_depts += 1
            audit.record(
                db,
                tenant_id=tenant.id,
                actor=None,
                entity="department",
                entity_id=dept.id,
                action="create",
                summary=f"Created department {dept_name} (demo data)",
                new={"name": dept_name},
            )
        if ward_name.lower() in wards:
            continue
        ward = Ward(
            tenant_id=tenant.id,
            name=ward_name,
            department_id=dept.id,
            monthly_target=target,
            status=ACTIVE,
        )
        db.add(ward)
        db.flush()
        wards.add(ward_name.lower())
        made_wards += 1
        audit.record(
            db,
            tenant_id=tenant.id,
            actor=None,
            entity="ward",
            entity_id=ward.id,
            action="create",
            summary=f"Created ward {ward_name} (demo data)",
            new={"name": ward_name, "department": dept_name, "monthly_target": target},
        )
    db.flush()
    return made_depts, made_wards
