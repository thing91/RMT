import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class TableView(Base, IdMixin, TimestampMixin):
    """§4.8: named, savable table configurations — shared (visible to the
    whole project) or personal (owner_id set, private to them)."""

    __tablename__ = "table_views"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    scope: Mapped[str] = mapped_column(String(20), default="shared")
    owner_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_types.id"), nullable=True
    )
    # ordered array: [{attribute_key, width?}, ...] — order IS column order
    columns: Mapped[list] = mapped_column(JSONB, default=list)
    filters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sort: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
