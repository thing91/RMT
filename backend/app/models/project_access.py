import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

ROLES = ("admin", "editor", "reviewer", "viewer")
ROLE_RANK = {role: i for i, role in enumerate(ROLES)}  # index 0 = most permissive


class ProjectAccess(Base, IdMixin, TimestampMixin):
    """§13.2: per-project role grant to a user or a group.

    Effective permission = union of direct user grants and group grants; the
    most permissive applicable role wins per the brief.
    """

    __tablename__ = "project_access"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    subject_type: Mapped[str] = mapped_column(String(10))  # "user" | "group"
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    role: Mapped[str] = mapped_column(String(20))
