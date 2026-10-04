import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

SUGGESTION_KINDS = ("editorial", "technical")
SUGGESTION_SEVERITIES = ("major", "minor")


class Suggestion(Base, IdMixin, TimestampMixin):
    """Formal change suggestion (≈ ECSS RID) on one field of one item.

    `target_field` is "title", "description_md", "attributes.<key>",
    "links.add" or "links.remove". `base_value` is what the field held at
    `item_version` when the suggestion was made; if the field changes
    afterwards the suggestion goes Outdated (the author can rebase it).
    Status follows the system "suggestion" workflow
    (app/services/workflow_templates.py).
    """

    __tablename__ = "suggestions"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(30), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    item_version: Mapped[int] = mapped_column(Integer)
    target_field: Mapped[str] = mapped_column(String(120))
    base_value: Mapped[dict | list | str | None] = mapped_column(JSONB, nullable=True)
    proposed_value: Mapped[dict | list | str | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), default="technical")
    severity: Mapped[str] = mapped_column(String(10), default="minor")
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    review_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reviews.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_comments.id", ondelete="SET NULL"), nullable=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    resolution_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The value actually written on accept (differs from proposed_value for
    # "accepted with modification").
    final_value: Mapped[dict | list | str | None] = mapped_column(JSONB, nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Accepted while the item was read-only (e.g. Approved): the change
    # request was raised and the content is applied once the item is
    # editable again.
    apply_pending: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    applied_version: Mapped[int | None] = mapped_column(Integer, nullable=True)

    item: Mapped["Item"] = relationship()
    author: Mapped["User"] = relationship(foreign_keys=[author_id])
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])
    review: Mapped["Review | None"] = relationship()
