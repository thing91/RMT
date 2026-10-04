import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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


# ---- workflow definitions -------------------------------------------------


class StateSpec(BaseModel):
    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(min_length=1, max_length=100)
    category: str = Field(default="active", pattern=r"^(draft|active|done|side)$")
    read_only: bool = False
    is_obsolete: bool = False
    initial: bool = False
    color: str | None = None


class RuleSpec(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str


class TransitionSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(min_length=1, max_length=100)
    from_: list[str] = Field(alias="from")
    to: str
    roles: list[str] = []
    conditions: list[RuleSpec] = []
    actions: list[RuleSpec] = []
    requires_comment: bool = False


class WorkflowSpecIn(BaseModel):
    """Either a full spec, or `template` naming one of the built-in
    templates (basic / change_managed / regulated / test_case)."""

    template: str | None = None
    name: str | None = None
    states: list[StateSpec] | None = None
    transitions: list[TransitionSpec] | None = None
    settings: dict[str, Any] = {}


class WorkflowDefinitionRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    project_id: uuid.UUID | None
    item_type_id: uuid.UUID
    item_type_name: str
    name: str
    variant: str
    states: list[dict]
    transitions: list[dict]
    settings: dict
    is_override: bool
    updated_at: datetime


class WorkflowTemplateRead(BaseModel):
    key: str
    name: str
    variant: str
    states: list[dict]
    transitions: list[dict]


# ---- running transitions --------------------------------------------------


class TransitionRequest(BaseModel):
    comment: str | None = None
    # Re-authentication for transitions that require an electronic signature.
    password: str | None = None
    # Extra values some conditions/actions read (e.g. release_ref).
    payload: dict[str, Any] = {}


class TransitionOptionRead(BaseModel):
    key: str
    label: str
    to: str
    to_label: str
    requires_comment: bool
    requires_signature: bool
    allowed: bool
    reasons: list[str]


class HistoryEntryRead(BaseModel):
    id: uuid.UUID
    at: datetime
    actor: str | None
    transition: str | None
    transition_label: str | None
    from_state: str | None
    from_label: str | None
    to_state: str | None
    to_label: str | None
    comment: str | None
    notes: dict = {}
    version: int | None = None


class SubjectWorkflowRead(BaseModel):
    state: str | None
    state_label: str
    states: list[dict]
    transitions: list[TransitionOptionRead]
    history: list[HistoryEntryRead]
    read_only_reason: str | None = None


class BulkTransitionRequest(TransitionRequest):
    # Limit to these items; default = every content item in the document
    # for which the transition is currently available.
    item_ids: list[uuid.UUID] | None = None


class BulkTransitionSkip(BaseModel):
    item_id: uuid.UUID
    key: str | None
    reason: str


class BulkTransitionResult(BaseModel):
    applied: list[str]
    skipped: list[BulkTransitionSkip]


# ---- change management ----------------------------------------------------


class ChangeRequestRead(BaseModel):
    id: uuid.UUID
    key: str
    project_id: uuid.UUID
    item_id: uuid.UUID
    item_key: str | None
    item_title: str
    base_version: int
    implemented_version: int | None
    status: str
    reason: str
    impact: list[dict]
    requested_by: str | None
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime


class SuspectLinkRead(BaseModel):
    id: uuid.UUID
    link_type: str
    source_item_id: uuid.UUID
    source_key: str | None
    source_title: str
    target_item_id: uuid.UUID
    target_key: str | None
    target_title: str
    changed_item_id: uuid.UUID | None
    reason: str | None
    since: datetime | None


class SignatureRead(BaseModel):
    id: uuid.UUID
    user: str
    meaning: str
    subject_version: int | None
    content_hash: str
    transition_key: str | None
    signed_at: datetime
