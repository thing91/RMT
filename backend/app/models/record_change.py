import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, _now


class RecordChange(Base, IdMixin):
    """One change to any record in the database — written automatically by
    the ORM hook in app/services/record_history.py, so every table gets a
    history without per-endpoint code.

    `changes` is {field: [old, new]}: on create every field is [null, value],
    on delete [value, null]. No foreign keys on purpose — the history must
    outlive the record (and the actor) it describes.
    """

    __tablename__ = "record_changes"
    __table_args__ = (Index("ix_record_changes_entity", "entity_type", "entity_id", "at"),)

    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(10))  # create | update | delete
    label: Mapped[str | None] = mapped_column(String(500), nullable=True)
    changes: Mapped[dict] = mapped_column(JSONB, default=dict)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
