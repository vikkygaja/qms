import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.models import utcnow


class WardAssignment(Base):
    """Which ward a link nurse covers, with history. `to_date` NULL means current."""

    __tablename__ = "ward_assignment"
    __table_args__ = (
        Index(
            "uq_ward_assignment_current",
            "user_id",
            "ward_id",
            unique=True,
            postgresql_where=text("to_date IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"), index=True)
    ward_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ward.id"), index=True)
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=text("now()")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ended_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
