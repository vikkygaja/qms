import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.auth.deps import AuthContext, get_db, require_users
from app.roles import service

router = APIRouter(tags=["roles"], dependencies=[Depends(require_users)])


class RoleOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    is_system: bool
    permissions: list[str]
    active_user_count: int


class PermissionOut(BaseModel):
    code: str
    description: str


class RoleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str


class PermissionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    permissions: list[str]


@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(db: Session = Depends(get_db)):
    return service.list_permissions(db)


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)):
    return service.list_roles(db)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(
    body: RoleCreate, ctx: AuthContext = Depends(require_users), db: Session = Depends(get_db)
):
    return service.create_role(db, ctx, body.name)


@router.put("/roles/{role_id}/permissions", response_model=RoleOut)
def set_permissions(
    role_id: uuid.UUID,
    body: PermissionsIn,
    ctx: AuthContext = Depends(require_users),
    db: Session = Depends(get_db),
):
    return service.set_permissions(db, ctx, role_id, body.permissions)
