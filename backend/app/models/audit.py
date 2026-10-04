import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, _now


class AuditEvent(Base, IdMixin):
    """Append-only audit trail: who did what to which object, and when.

    Never updated or deleted by the app. `subject_type`/`subject_id` is a
    polymorphic pointer ("item", "suggestion", "applicability", "idea",
    "lock", ...) so one table covers every auditable object.
    """

    __tablename__ = "audit_events"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    subject_type: Mapped[str] = mapped_column(String(32))
    subject_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)

    actor: Mapped["User | None"] = relationship()
