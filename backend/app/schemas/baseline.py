import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BaselineCreate(BaseModel):
    name: str
    created_by: str | None = None


class BaselineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    git_commit_sha: str | None
    created_by: str | None
    created_at: datetime
    item_count: int


class BaselineDetail(BaselineRead):
    snapshot: dict
