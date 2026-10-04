import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
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
    # "project" (a normal project) or "library" (generic requirements,
    # consumed by other projects only through releases).
    kind: Mapped[str] = mapped_column(String(20), default="project", server_default="project")
    # Library: the mission attributes its applicability rules may test,
    # [{key, label, type: boolean|enum|number|text, options?}].
    # Project: the values of those attributes, {key: value}.
    mission_attribute_defs: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    mission_attributes: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")

    organization: Mapped["Organization"] = relationship(back_populates="projects")
    documents: Mapped[list["Document"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
