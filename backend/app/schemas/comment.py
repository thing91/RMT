import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CommentCreate(BaseModel):
    body: str
    parent_comment_id: uuid.UUID | None = None
    # Post into a suggestion's discussion thread instead of the item's.
    suggestion_id: uuid.UUID | None = None


class CommentUpdate(BaseModel):
    body: str


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    author_id: uuid.UUID
    author_name: str
    body: str
    created_at: datetime
    updated_at: datetime
    resolved: bool
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    suggestion_id: uuid.UUID | None = None
    replies: list["CommentRead"] = []
