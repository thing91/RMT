import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, _now


class Subscription(Base, IdMixin):
    """A user watching an object ("item", "idea", "suggestion", "review",
    "lock"...). Watchers get in-app notifications (and email) about it."""

    __tablename__ = "subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "subject_type", "subject_id", name="uq_subscription"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    subject_type: Mapped[str] = mapped_column(String(32))
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base, IdMixin):
    """In-app inbox entry (the bell in the top bar)."""

    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # In-app route (e.g. "/projects/<id>/documents/<id>?item=<id>") — the
    # frontend navigates to it; emails prefix it with settings.app_base_url.
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    subject_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    subject_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    actor: Mapped["User | None"] = relationship(foreign_keys=[actor_id])
