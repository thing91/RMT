import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class ItemComment(Base, IdMixin, TimestampMixin):
    """§ user request, not in the original brief — item-level discussion,
    ReqView/Polarion-style: a flat two-level thread (a top-level comment
    plus replies under it, via `parent_comment_id`) rather than arbitrary
    nesting, since that's what every reply UI in this app actually needs.
    Only a top-level comment (`parent_comment_id IS NULL`) carries
    meaningful `resolved` state — a thread is resolved as a whole."""

    __tablename__ = "item_comments"

    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_comments.id"), nullable=True, index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped["Item"] = relationship()
    author: Mapped["User"] = relationship(foreign_keys=[author_id])
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])
    parent: Mapped["ItemComment | None"] = relationship(
        remote_side="ItemComment.id", back_populates="replies"
    )
    replies: Mapped[list["ItemComment"]] = relationship(back_populates="parent")
