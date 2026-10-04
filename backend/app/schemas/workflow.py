import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WorkflowRoleCreate(BaseModel):
    user_id: uuid.UUID
    role: str  # "reviewer" | "approver"


class WorkflowRoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    username: str
    display_name: str


class ApproveRequest(BaseModel):
    status_value: str
    note: str | None = None


class DocumentApproveResult(BaseModel):
    approved_count: int
    skipped_count: int


class ApprovalInfo(BaseModel):
    approved_by: str | None = None
    approved_at: datetime | None = None
    stale: bool = False
