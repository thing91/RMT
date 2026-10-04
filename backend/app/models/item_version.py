import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, _now

# Why a version was created — shown in the item's history.
VERSION_REASONS = ("create", "edit", "transition", "suggestion", "import", "migration", "revert")


class ItemVersion(Base, IdMixin):
    """Immutable snapshot of an item's content at one version.

    `items.version` is the item's current version number (and its
    optimistic-concurrency token); every content write bumps it and stores
    the resulting state here, so the exact text of any past version — in
    particular an approved one — can always be reconstructed. Pure
    structural moves (parent/order) don't create a version: those are
    tracked by `documents.structure_version` instead.
    """

    __tablename__ = "item_versions"
    __table_args__ = (UniqueConstraint("item_id", "version", name="uq_item_version"),)

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    reason: Mapped[str] = mapped_column(String(20), default="edit")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-form pointer to whatever caused this version, e.g. "SUG-0042" or
    # a transition key — shown next to the version in history.
    source_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # The person the content change is attributed to. For an accepted
    # suggestion that's the suggestion's author, while `changed_by` is the
    # person who accepted it.
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    author: Mapped["User | None"] = relationship(foreign_keys=[author_id])
    changed_by: Mapped["User | None"] = relationship(foreign_keys=[changed_by_id])
