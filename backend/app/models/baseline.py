import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class Baseline(Base, IdMixin, TimestampMixin):
    """§4.7: a frozen snapshot of a project's items/links at a point in time.

    `git_commit_sha` stays null until Git sync (§7) exists — for now a
    baseline is a pure DB snapshot, not yet tied to a commit.
    """

    __tablename__ = "baselines"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), index=True
    )
    # Set for a document baseline (a frozen version of one document, e.g. for
    # a System Requirements Review); null for a whole-project baseline.
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    git_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A milestone baseline (`locks_items=True`) makes every item it froze
    # read-only outside the draft state — changing one then needs a
    # workflow change request (app/services/workflow_engine.read_only_reason).
    locks_items: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # {item_id: version} — the exact item versions this baseline froze, so
    # the full text can be rebuilt from item_versions at any time.
    item_versions: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
