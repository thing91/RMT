import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ItemBase(BaseModel):
    title: str
    description_md: str | None = None
    attributes: dict = {}


class ItemCreate(ItemBase):
    # document_id is not here: the create route takes it from the URL path,
    # not the body — duplicating it here would make FastAPI require callers
    # to send it twice.
    item_type_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    order: int | None = None


class ItemUpdate(BaseModel):
    title: str | None = None
    description_md: str | None = None
    attributes: dict | None = None
    parent_id: uuid.UUID | None = None
    order: int | None = None
    # Accepted for backwards compatibility but ignored — the server always
    # records the authenticated user.
    updated_by: str | None = None


class ItemMove(BaseModel):
    parent_id: uuid.UUID | None = None
    order: int


class LockRead(BaseModel):
    scope: str
    target_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    acquired_at: datetime
    expires_at: datetime
    implicit: bool = False


class ItemRead(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    parent_id: uuid.UUID | None
    item_type_id: uuid.UUID
    key: str | None
    order: int
    created_at: datetime
    updated_at: datetime
    updated_by: str | None
    number: str | None = None
    children: list["ItemRead"] = []
    # Nesting depth within its document (0 = root) — only meaningful (and
    # only populated) for a flat listing like /projects/{id}/items; a
    # nested response like /documents/{id}/items conveys depth via
    # `children` instead and leaves this at 0.
    depth: int = 0
    # §workflow: latest sign-off only. `approval_stale` = the item was
    # edited again after being approved (updated_at moved past approved_at).
    approved_by: str | None = None
    approved_at: datetime | None = None
    approval_stale: bool = False
    # Concurrency: content version (ETag = "<id>:<version>") and the live
    # edit lock, if anyone holds one.
    version: int = 1
    etag: str | None = None
    lock: LockRead | None = None
    # Workflow: retired items, and why content can't be edited right now
    # (read-only workflow state or a locked milestone baseline).
    obsolete: bool = False
    read_only_reason: str | None = None
    has_workflow: bool = False
    suspect_links: int = 0
    # Library-derived copy ("Applicable with modification") or null for a
    # project-specific requirement.
    source_item_id: uuid.UUID | None = None
    source_version: int | None = None
