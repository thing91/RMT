import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReferenceLocatorCreate(BaseModel):
    label: str
    page_number: int | None = None
    locator_type: str = "clause"


class ReferenceLocatorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_id: uuid.UUID
    label: str
    page_number: int | None
    locator_type: str


class ReferenceSourceCreate(BaseModel):
    code: str
    title: str
    version: str | None = None
    source_type: str  # "pdf" | "external_link"
    external_url: str | None = None
    description: str | None = None


class ReferenceSourceUpdate(BaseModel):
    title: str | None = None
    version: str | None = None
    external_url: str | None = None
    description: str | None = None
    superseded_by: uuid.UUID | None = None


class ReferenceSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    scope: str
    org_id: uuid.UUID | None
    project_id: uuid.UUID | None
    code: str
    title: str
    version: str | None
    source_type: str
    file_ref: str | None
    external_url: str | None
    superseded_by: uuid.UUID | None
    description: str | None
    created_at: datetime
    locators: list[ReferenceLocatorRead] = []


class ReferenceConsistencyReport(BaseModel):
    unused_sources: list[str]
    superseded_citations: list[str]
