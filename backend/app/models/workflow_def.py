import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin, _now


class WorkflowDefinition(Base, IdMixin, TimestampMixin):
    """Configurable item workflow (wymagania-wspolbieznosc §"Workflow
    wymagań" FR1–2): states + transitions for one item type, defined at org
    level (project_id NULL) and optionally overridden per project.

    `states`/`transitions` are JSON lists shaped like the templates in
    app/services/workflow_templates.py and validated by
    app/schemas/workflow_def.py on write.
    """

    __tablename__ = "workflow_definitions"
    __table_args__ = (
        UniqueConstraint("org_id", "project_id", "item_type_id", name="uq_workflow_def_scope"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    item_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_types.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    variant: Mapped[str] = mapped_column(String(30), default="custom")
    states: Mapped[list] = mapped_column(JSONB, default=list)
    transitions: Mapped[list] = mapped_column(JSONB, default=list)
    # Misc switches, e.g. {"suggestion_self_resolve": false}.
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)

    item_type: Mapped["ItemType"] = relationship()


class ChangeRequest(Base, IdMixin, TimestampMixin):
    """Created when an approved item moves to Change Requested (FR4). Holds
    the impact analysis — every item linked to/derived from the requirement
    at that moment — and is closed when the change is re-approved (or
    rejected)."""

    __tablename__ = "change_requests"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(30), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    base_version: Mapped[int] = mapped_column(Integer)
    # open → accepted → implemented, or open → rejected
    status: Mapped[str] = mapped_column(String(20), default="open")
    reason: Mapped[str] = mapped_column(Text, default="")
    impact: Mapped[list] = mapped_column(JSONB, default=list)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    implemented_version: Mapped[int | None] = mapped_column(Integer, nullable=True)

    item: Mapped["Item"] = relationship()
    requested_by: Mapped["User | None"] = relationship(foreign_keys=[requested_by_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_id])


class ElectronicSignature(Base, IdMixin):
    """Regulated variant (21 CFR Part 11-style): who signed what, with which
    meaning, against which exact content (hash of the version snapshot).
    Captured after re-authenticating the signer with their password."""

    __tablename__ = "electronic_signatures"

    subject_type: Mapped[str] = mapped_column(String(32))
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    subject_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    meaning: Mapped[str] = mapped_column(String(100))
    content_hash: Mapped[str] = mapped_column(String(64))
    transition_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()


class Review(Base, IdMixin, TimestampMixin):
    """Review as its own object (FR5): its status is separate from the
    reviewed items' statuses; one review covers many items (pinned to the
    version that was put up for review), has required reviewers and votes,
    and collects comments/suggestions."""

    __tablename__ = "reviews"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # open | closed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="open")
    # Which open suggestions block closing: "none" | "major" | "all"
    close_requires_resolved: Mapped[str] = mapped_column(String(10), default="major")
    require_all_votes: Mapped[bool] = mapped_column(Boolean, default=True)
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ReviewItem"]] = relationship(
        back_populates="review", cascade="all, delete-orphan"
    )
    participants: Mapped[list["ReviewParticipant"]] = relationship(
        back_populates="review", cascade="all, delete-orphan"
    )
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])
    closed_by: Mapped["User | None"] = relationship(foreign_keys=[closed_by_id])


class ReviewItem(Base, IdMixin):
    __tablename__ = "review_items"
    __table_args__ = (UniqueConstraint("review_id", "item_id", name="uq_review_item"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    item_version: Mapped[int] = mapped_column(Integer)

    review: Mapped["Review"] = relationship(back_populates="items")
    item: Mapped["Item"] = relationship()


REVIEW_VOTES = ("approve", "approve_with_comments", "reject")


class ReviewParticipant(Base, IdMixin):
    __tablename__ = "review_participants"
    __table_args__ = (UniqueConstraint("review_id", "user_id", name="uq_review_participant"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    vote: Mapped[str | None] = mapped_column(String(30), nullable=True)
    vote_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    voted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    review: Mapped["Review"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship()


class KeyCounter(Base):
    """Per-project (or per-org) sequence for human-readable keys like
    CR-001, REV-001, SUG-0042, IDEA-17 — a row lock on this table makes
    concurrent key minting safe without Postgres sequences per project."""

    __tablename__ = "key_counters"

    scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(20), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, default=0)
