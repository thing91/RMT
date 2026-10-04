import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class LinkType(Base, IdMixin, TimestampMixin):
    __tablename__ = "link_types"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(255))
    inverse_name: Mapped[str] = mapped_column(String(255))
    # [] (empty list) = any item type allowed, matching §4.6
    allowed_source_types: Mapped[list] = mapped_column(JSONB, default=list)
    allowed_target_types: Mapped[list] = mapped_column(JSONB, default=list)

    organization: Mapped["Organization"] = relationship(back_populates="link_types")


class Link(Base, IdMixin, TimestampMixin):
    __tablename__ = "links"
    __table_args__ = (
        UniqueConstraint(
            "source_item_id", "target_item_id", "link_type_id", name="uq_link_source_target_type"
        ),
    )

    source_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    target_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    link_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("link_types.id"), index=True
    )

    # Suspect flag (change management): set when the item on the other end
    # of this link was re-approved after a change request, so this
    # relationship must be re-verified. Cleared explicitly by an editor.
    suspect: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    suspect_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    suspect_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Which end changed: the item whose change made this link suspect.
    suspect_item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    source_item: Mapped["Item"] = relationship(foreign_keys=[source_item_id])
    target_item: Mapped["Item"] = relationship(foreign_keys=[target_item_id])
    link_type: Mapped["LinkType"] = relationship()
