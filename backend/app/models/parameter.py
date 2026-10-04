import uuid

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

PARAMETER_DATA_TYPES = ("constant", "derived")
PARAMETER_SOURCES = ("measured", "estimated", "derived", "assumed")


class Parameter(Base, IdMixin, TimestampMixin):
    """§5.3: a numeric variable (Valispace-style), referenced from item
    content via `{{param:KEY}}` (app/services/parameters.py). `formula` is
    only evaluated for `data_type == "derived"` — a restricted expression
    over other parameters' keys, +-*/ and parentheses only (no eval())."""

    __tablename__ = "parameters"
    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_parameter_project_key"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    key: Mapped[str] = mapped_column(String(100))  # e.g. "BRAKE_TORQUE_MAX"
    name: Mapped[str] = mapped_column(String(255))
    value: Mapped[float | None] = mapped_column(Float, nullable=True)  # constant value, or cached derived result
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    data_type: Mapped[str] = mapped_column(String(20), default="constant")
    formula: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="assumed")
    min: Mapped[float | None] = mapped_column(Float, nullable=True)
    max: Mapped[float | None] = mapped_column(Float, nullable=True)
    tolerance: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class ParameterLink(Base, IdMixin, TimestampMixin):
    """"Used in" traceability (§5.3) — same pattern as items.links."""

    __tablename__ = "parameter_links"
    __table_args__ = (UniqueConstraint("parameter_id", "item_id", name="uq_parameter_link"),)

    parameter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("parameters.id"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)

    parameter: Mapped["Parameter"] = relationship()
