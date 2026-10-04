import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class MatrixView(Base, IdMixin, TimestampMixin):
    """Saved (row type, column type, link type) combo for the traceability
    matrix — same shared/personal save pattern as `TableView` (§4.8)."""

    __tablename__ = "matrix_views"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    scope: Mapped[str] = mapped_column(String(20), default="shared")
    owner_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    row_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    col_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    link_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
