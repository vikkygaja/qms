import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

EMPLOYEE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,20}$")
MOBILE_RE = re.compile(r"^\d{10}$")
EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")


class RoleRef(BaseModel):
    id: uuid.UUID
    key: str
    name: str


class UserOut(BaseModel):
    id: uuid.UUID
    employee_id: str
    full_name: str
    designation: str
    mobile: str
    email: str
    role: RoleRef | None
    status: str
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime


class UserPage(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    page_size: int


class UserWithPassword(BaseModel):
    user: UserOut
    temporary_password: str


def _required(value: str, message: str, max_len: int = 100) -> str:
    value = value.strip()
    if not value:
        raise ValueError(message)
    if len(value) > max_len:
        raise ValueError(f"Use at most {max_len} characters.")
    return value


class _UserFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("full_name", "designation", check_fields=False)
    @classmethod
    def _names(cls, v: str | None, info) -> str | None:
        if v is None:
            return v
        label = "full name" if info.field_name == "full_name" else "designation"
        return _required(v, f"Enter the {label}.")

    @field_validator("mobile", check_fields=False)
    @classmethod
    def _mobile(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not MOBILE_RE.match(v):
            raise ValueError("Enter a 10-digit mobile number.")
        return v

    @field_validator("email", check_fields=False)
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v and not EMAIL_RE.match(v):
            raise ValueError("Email looks incorrect.")
        return v


class UserCreate(_UserFields):
    employee_id: str
    full_name: str
    designation: str
    role_id: uuid.UUID
    mobile: str
    email: str = ""

    @field_validator("employee_id")
    @classmethod
    def _employee_id(cls, v: str) -> str:
        v = v.strip()
        if not EMPLOYEE_ID_RE.match(v):
            raise ValueError("Use 3-20 letters, numbers, - or _.")
        return v


class UserPatch(_UserFields):
    full_name: str | None = None
    designation: str | None = None
    role_id: uuid.UUID | None = None
    mobile: str | None = None
    email: str | None = None


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["Active", "Inactive"]
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return _required(v, "Enter a reason.", 500)
