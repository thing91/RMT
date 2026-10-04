import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class Document(Base, IdMixin, TimestampMixin):
    __tablename__ = "documents"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer, default=0)
    # Nullable, flat grouping for the sidebar (§ user request) — a document
    # with no group renders under an "Ungrouped" bucket.
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Optimistic-concurrency token for the document's *structure* (item
    # order/hierarchy) — separate from each item's own content version, so
    # reordering never conflicts with editing an item's text and vice versa.
    structure_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    project: Mapped["Project"] = relationship(back_populates="documents")
    items: Mapped[list["Item"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
