import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class Project(Base, IdMixin, TimestampMixin):
    __tablename__ = "projects"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    visibility: Mapped[str] = mapped_column(String(20), default="private")
    gitlab_repo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    default_branch: Mapped[str] = mapped_column(String(100), default="main")

    organization: Mapped["Organization"] = relationship(back_populates="projects")
    documents: Mapped[list["Document"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
