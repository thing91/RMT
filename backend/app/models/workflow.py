import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin

WORKFLOW_ROLES = ("reviewer", "approver")


class DocumentWorkflowRole(Base, IdMixin, TimestampMixin):
    """Who may review/approve THIS document's items (§ user request, not in
    the original brief).

    Distinct from the project-wide "reviewer" role in project_access.py,
    which only gates *read* access tier (§13.2) — this is sign-off authority
    for the status-approval workflow (app/services/workflow.py), scoped per
    document since the same project can have documents at very different
    review stages at once.
    """

    __tablename__ = "document_workflow_roles"
    __table_args__ = (
        UniqueConstraint("document_id", "user_id", "role", name="uq_workflow_role_doc_user_role"),
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # "reviewer" | "approver"

    document: Mapped["Document"] = relationship()
    user: Mapped["User"] = relationship()
