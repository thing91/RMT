"""Generic requirements library + per-project applicability matrix
(wymagania-wspolbieznosc-i-workflow.md, "Biblioteka wymagań generycznych").

A library is an ordinary project with `projects.kind = "library"` whose
documents are its subsystems (EPS, AOCS, OBC, ...). It is consumed only
through *releases* (immutable {item_id: version} snapshots), never through
its working draft. A consuming project adopts one release per library and
gets one ApplicabilityRecord per generic requirement — a reference with a
decision, not a copy.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin, _now


class LibraryRelease(Base, IdMixin):
    __tablename__ = "library_releases"
    __table_args__ = (UniqueConstraint("library_id", "name", name="uq_library_release_name"),)

    library_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))  # e.g. "GEN-SAT v3.1"
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {item_id: version} of every non-obsolete content item at release time.
    item_versions: Mapped[dict] = mapped_column(JSONB, default=dict)
    # {item_id: document name} — the subsystem each requirement belonged to.
    subsystems: Mapped[dict] = mapped_column(JSONB, default=dict)
    previous_release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("library_releases.id"), nullable=True
    )
    released_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    released_by: Mapped["User | None"] = relationship()


class ProjectLibrary(Base, IdMixin, TimestampMixin):
    """A project's subscription to one library, pinned to one release."""

    __tablename__ = "project_libraries"
    __table_args__ = (UniqueConstraint("project_id", "library_id", name="uq_project_library"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    library_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    release_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("library_releases.id"))
    # A newer release the project consciously decided not to adopt (yet),
    # with the justification — so it isn't offered again as "new".
    declined_release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("library_releases.id"), nullable=True
    )
    declined_justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Where "Applicable with modification" copies are created by default.
    target_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    library: Mapped["Project"] = relationship(foreign_keys=[library_id])
    release: Mapped["LibraryRelease"] = relationship(foreign_keys=[release_id])
    declined_release: Mapped["LibraryRelease | None"] = relationship(foreign_keys=[declined_release_id])


class ApplicabilityRecord(Base, IdMixin, TimestampMixin):
    __tablename__ = "applicability_records"
    __table_args__ = (UniqueConstraint("project_id", "source_item_id", name="uq_applicability_source"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    library_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    release_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("library_releases.id"))
    source_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    source_version: Mapped[int] = mapped_column(Integer)
    subsystem: Mapped[str] = mapped_column(String(255), default="")
    # to_be_assessed | applicable | applicable_modified | not_applicable_pending | not_applicable
    status: Mapped[str] = mapped_column(String(30), default="to_be_assessed", index=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "Applicable with modification": the project's modified copy and the
    # diff of its text against the library version.
    modified_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="SET NULL"), nullable=True
    )
    modification_diff: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the library requirement changed (or was removed) in a newly
    # adopted release — the decision must be re-confirmed.
    suspect: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    suspect_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    removed_from_library: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Rule-based proposal (always needs a human decision).
    suggested_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    suggested_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_item: Mapped["Item"] = relationship(foreign_keys=[source_item_id])
    modified_item: Mapped["Item | None"] = relationship(foreign_keys=[modified_item_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_id])
    approved_by: Mapped["User | None"] = relationship(foreign_keys=[approved_by_id])
    release: Mapped["LibraryRelease"] = relationship()


class LibraryRule(Base, IdMixin, TimestampMixin):
    """Conditional applicability on a library requirement, evaluated against
    a project's mission attributes, e.g. {"attribute": "propulsion", "op":
    "eq", "value": false, "suggest": "not_applicable", "reason": "No
    propulsion on this mission"}. Only ever *suggests* a status."""

    __tablename__ = "library_rules"

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    rules: Mapped[list] = mapped_column(JSONB, default=list)
