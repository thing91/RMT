import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

# §4.4 attribute type catalog
ATTRIBUTE_DATA_TYPES = (
    "text",
    "rich_text",
    "enum",
    "multi_enum",
    "number",
    "date",
    "boolean",
    "user_ref",
    "item_ref",
)

ITEM_TYPE_BEHAVIORS = ("structural", "content")


class ItemType(Base, IdMixin, TimestampMixin):
    __tablename__ = "item_types"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(255))
    prefix: Mapped[str] = mapped_column(String(20), default="")
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    behavior: Mapped[str] = mapped_column(String(20), default="content")

    organization: Mapped["Organization"] = relationship(back_populates="item_types")
    attributes: Mapped[list["ItemTypeAttribute"]] = relationship(
        back_populates="item_type",
        cascade="all, delete-orphan",
        order_by="ItemTypeAttribute.order",
    )


class ItemTypeAttribute(Base, IdMixin, TimestampMixin):
    __tablename__ = "item_type_attributes"

    item_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("item_types.id"), index=True
    )
    key: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(255))
    data_type: Mapped[str] = mapped_column(String(20))
    enum_options: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    min: Mapped[float | None] = mapped_column(nullable=True)
    max: Mapped[float | None] = mapped_column(nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    deprecated: Mapped[bool] = mapped_column(Boolean, default=False)

    item_type: Mapped["ItemType"] = relationship(back_populates="attributes")
