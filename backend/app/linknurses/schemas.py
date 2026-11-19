import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.users.schemas import EMAIL_RE, EMPLOYEE_ID_RE, MOBILE_RE, _required


def _uuid_list(value, *, allow_empty: bool) -> list[uuid.UUID]:
    if not isinstance(value, list):
        raise ValueError("Choose the wards.")
    try:
        ids = [uuid.UUID(str(v)) for v in value]
    except ValueError:
        raise ValueError("Choose valid wards.") from None
    ids = list(dict.fromkeys(ids))  # drop duplicates, keep order
    if not ids and not allow_empty:
        raise ValueError("Assign at least one ward.")
    return ids


class _Fields(BaseModel):
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


class LinkNurseCreate(_Fields):
    employee_id: str
    full_name: str
    designation: str
    department_id: uuid.UUID
    mobile: str
    email: str = ""
    link_nurse_from: date
    who5_training_date: date | None = None
    ward_ids: list[uuid.UUID]

    @field_validator("employee_id")
    @classmethod
    def _employee_id(cls, v: str) -> str:
        v = v.strip()
        if not EMPLOYEE_ID_RE.match(v):
            raise ValueError("Use 3-20 letters, numbers, - or _.")
        return v

    @field_validator("ward_ids", mode="before")
    @classmethod
    def _wards(cls, v):
        return _uuid_list(v, allow_empty=False)


class LinkNursePatch(_Fields):
    full_name: str | None = None
    designation: str | None = None
    department_id: uuid.UUID | None = None
    mobile: str | None = None
    email: str | None = None
    link_nurse_from: date | None = None
    who5_training_date: date | None = None


class WardsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ward_ids: list[uuid.UUID]

    @field_validator("ward_ids", mode="before")
    @classmethod
    def _wards(cls, v):
        return _uuid_list(v, allow_empty=True)  # the service explains an empty set


class LinkNurseStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["Active", "Inactive"]
    reason: str
    effective_date: date | None = None

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return _required(v, "Enter a reason.", 500)
