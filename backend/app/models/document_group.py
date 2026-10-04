import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class DocumentGroup(Base, IdMixin, TimestampMixin):
    """A flat, user-defined bucket for organizing a project's documents in
    the sidebar (§ user request, not in the original brief) — one level
    only, no nesting: a group holds documents, not other groups."""

    __tablename__ = "document_groups"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer, default=0)
