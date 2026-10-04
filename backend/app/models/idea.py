"""Roadmap: users submit improvement ideas for the application itself, vote
on them and follow their status. An idea is one more workflow subject (the
system "idea" workflow in app/services/workflow_templates.py) and reuses
history, watching and notifications.

Ideas are visible to every signed-in user of every organization; the
submitter's organization (and name) is only shown to members of the same
organization and to the product team (`roadmap.manage`).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin, _now

IDEA_CATEGORIES = (
    "Requirements editing",
    "Workflow & reviews",
    "Traceability",
    "Library & applicability",
    "Import / export",
    "Integrations",
    "Performance",
    "Usability",
    "Other",
)
IDEA_HORIZONS = ("now", "next", "later")


class ReleaseNote(Base, IdMixin):
    """An entry in the application's release notes — a released idea links
    to the entry that shipped it."""

    __tablename__ = "release_notes"

    version: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class Idea(Base, IdMixin, TimestampMixin):
    __tablename__ = "ideas"

    number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="Other")
    status: Mapped[str] = mapped_column(String(30), default="submitted", index=True)
    horizon: Mapped[str | None] = mapped_column(String(10), nullable=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ideas.id", ondelete="SET NULL"), nullable=True
    )
    release_note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("release_notes.id", ondelete="SET NULL"), nullable=True
    )
    status_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Product-team-only fields — never serialized for other users.
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    effort: Mapped[str | None] = mapped_column(String(20), nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    author: Mapped["User"] = relationship(foreign_keys=[author_id])
    organization: Mapped["Organization"] = relationship()
    duplicate_of: Mapped["Idea | None"] = relationship(remote_side="Idea.id")
    release_note: Mapped["ReleaseNote | None"] = relationship()


class IdeaVote(Base, IdMixin):
    __tablename__ = "idea_votes"
    __table_args__ = (UniqueConstraint("idea_id", "user_id", name="uq_idea_vote"),)

    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class IdeaComment(Base, IdMixin, TimestampMixin):
    __tablename__ = "idea_comments"

    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("idea_comments.id", ondelete="CASCADE"), nullable=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    # A reply from the product team, highlighted and sent to all watchers.
    official: Mapped[bool] = mapped_column(Boolean, default=False)

    author: Mapped["User"] = relationship()
