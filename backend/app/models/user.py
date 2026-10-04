import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class User(Base, IdMixin, TimestampMixin):
    """§13.1: identity confirmed via LDAP bind — no password stored here."""

    __tablename__ = "users"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ldap_dn: Mapped[str | None] = mapped_column(String(500), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255))
    # Organization-level role: "admin" = org admin (project admin everywhere
    # in the org + org permissions like roadmap.manage); null = regular user.
    org_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Group(Base, IdMixin, TimestampMixin):
    __tablename__ = "groups"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(20), default="manual")  # "ldap" | "manual"
    ldap_dn: Mapped[str | None] = mapped_column(String(500), nullable=True)

    members: Mapped[list["GroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )

    group: Mapped["Group"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship()
