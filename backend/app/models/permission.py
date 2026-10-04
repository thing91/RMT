import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class RolePermission(Base, IdMixin, TimestampMixin):
    """Per-organization override of a role's default permission set
    (app/services/permissions.py ROLE_DEFAULT_PERMISSIONS): `granted=True`
    adds the permission to the role, `granted=False` takes it away."""

    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("org_id", "role", "permission", name="uq_role_permission"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    permission: Mapped[str] = mapped_column(String(64))
    granted: Mapped[bool] = mapped_column(Boolean, default=True)
