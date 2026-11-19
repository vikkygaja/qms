import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CODE_RE = re.compile(r"^[A-Za-z0-9]{1,3}$")


def clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("Enter a name.")
    if len(value) > 100:
        raise ValueError("Use at most 100 characters.")
    return value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DepartmentIn(_Strict):
    name: str

    _name = field_validator("name")(clean_name)


class DepartmentPatch(_Strict):
    name: str | None = None

    _name = field_validator("name")(clean_name)


class WardIn(_Strict):
    name: str
    department_id: uuid.UUID
    monthly_target: int = Field(ge=0, le=100000)

    _name = field_validator("name")(clean_name)


class WardPatch(_Strict):
    name: str | None = None
    department_id: uuid.UUID | None = None
    monthly_target: int | None = Field(default=None, ge=0, le=100000)

    _name = field_validator("name")(clean_name)


def clean_code(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not CODE_RE.match(value):
        raise ValueError("Use 1-3 letters or numbers.")
    return value.upper()


class CategoryIn(_Strict):
    name: str
    code: str

    _name = field_validator("name")(clean_name)
    _code = field_validator("code")(clean_code)


class CategoryPatch(_Strict):
    name: str | None = None
    code: str | None = None

    _name = field_validator("name")(clean_name)
    _code = field_validator("code")(clean_code)


class KpiIn(_Strict):
    green: int
    amber: int
    inactive_days: int


class DeptRef(BaseModel):
    id: uuid.UUID
    name: str


class DepartmentOut(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    ward_count: int


class WardOut(BaseModel):
    id: uuid.UUID
    name: str
    department: DeptRef
    monthly_target: int
    status: str
    link_nurse_count: int = 0


class CategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    status: str


class KpiOut(BaseModel):
    green: int
    amber: int
    inactive_days: int


StatusFilter = Literal["Active", "Inactive"]
