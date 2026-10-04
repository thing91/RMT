import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class Item(Base, IdMixin, TimestampMixin):
    __tablename__ = "items"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), nullable=True, index=True
    )
    item_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_types.id"), index=True
    )
    # Not globally unique: `_next_key()` scopes numbering per project (§4.2's
    # per-type prefix), and item types are shared org-wide, so two different
    # projects legitimately both mint "SYS-001" independently.
    key: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(1000))
    description_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Content version — bumped on every content write (title, description,
    # attributes, workflow state) and snapshotted into `item_versions`.
    # Doubles as the optimistic-concurrency token: ETag = "<id>:<version>".
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # Set while the item sits in a workflow state flagged `is_obsolete`
    # (items are retired, never physically deleted). Kept as a column so
    # "hide obsolete" filters stay a cheap WHERE clause.
    obsolete_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Library-derived copy ("Applicable with modification"): which library
    # requirement and version it was copied from. Null = project-specific.
    source_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="SET NULL"), nullable=True
    )
    source_version: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # §workflow (app/services/workflow.py): latest sign-off only, not a full
    # history — a status value flagged `requires_approval` can only be set
    # via the approve endpoints, which stamp these together. `updated_at`
    # moving past `approved_at` (any later edit) is what "stale" means.
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship(back_populates="items")
    item_type: Mapped["ItemType"] = relationship()
    parent: Mapped["Item | None"] = relationship(
        remote_side="Item.id", back_populates="children", foreign_keys=[parent_id]
    )
    children: Mapped[list["Item"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan", foreign_keys=[parent_id]
    )
    approved_by: Mapped["User | None"] = relationship(foreign_keys=[approved_by_id])
