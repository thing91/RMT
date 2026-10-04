import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

REFERENCE_SCOPES = ("standard", "project_reference")
REFERENCE_SOURCE_TYPES = ("pdf", "external_link")


class ReferenceSource(Base, IdMixin, TimestampMixin):
    """§5.4: a standard (org-wide, e.g. ECSS-E-ST-10C) or a per-project
    reference document, citable from item content via
    `[[ref:CODE#locator]]` (app/services/references.py)."""

    __tablename__ = "reference_sources"

    scope: Mapped[str] = mapped_column(String(20))  # "standard" | "project_reference"
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(500))
    version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_type: Mapped[str] = mapped_column(String(20))  # "pdf" | "external_link"
    file_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_sources.id"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    locators: Mapped[list["ReferenceLocator"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )
    superseding: Mapped["ReferenceSource | None"] = relationship(remote_side="ReferenceSource.id")


class ReferenceLocator(Base, IdMixin, TimestampMixin):
    __tablename__ = "reference_locators"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_sources.id"), index=True
    )
    label: Mapped[str] = mapped_column(String(255))  # e.g. "Clause 5.4.2"
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    locator_type: Mapped[str] = mapped_column(String(20), default="clause")

    source: Mapped["ReferenceSource"] = relationship(back_populates="locators")
