import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class GlossaryTerm(Base, IdMixin, TimestampMixin):
    """§5.2: org-wide glossary, referenced from any item's content via
    `[[abbreviation]]`. Scoped to the organization, not the project, since
    it's meant to be shared company-wide — always readable regardless of
    login or project access (§13.3)."""

    __tablename__ = "glossary_terms"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    abbreviation: Mapped[str] = mapped_column(String(100), index=True)
    term: Mapped[str] = mapped_column(String(255))
    definition: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
