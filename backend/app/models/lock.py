import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, _now

LOCK_SCOPES = ("item", "structure")


class EditLock(Base, IdMixin):
    """Pessimistic edit lock, held as a lease (expires_at moves forward on
    every heartbeat). An expired row is treated exactly like no row — it's
    overwritten lazily by the next acquirer, so no cleanup job is needed.

    scope="item"      → target_id is an item id (content lock)
    scope="structure" → target_id is a document id (order/hierarchy lock)
    """

    __tablename__ = "edit_locks"
    __table_args__ = (UniqueConstraint("scope", "target_id", name="uq_edit_lock_target"),)

    scope: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # True for the short implicit structure lease taken by a toolbar
    # operation, as opposed to one the user took explicitly.
    implicit: Mapped[bool] = mapped_column(default=False)

    user: Mapped["User"] = relationship()


class LockWaiter(Base, IdMixin):
    """"Notify me when this is released" — one-shot, removed once notified."""

    __tablename__ = "lock_waiters"
    __table_args__ = (UniqueConstraint("scope", "target_id", "user_id", name="uq_lock_waiter"),)

    scope: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
