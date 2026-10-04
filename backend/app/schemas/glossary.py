import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GlossaryTermBase(BaseModel):
    abbreviation: str
    term: str
    definition: str
    category: str | None = None


class GlossaryTermCreate(GlossaryTermBase):
    updated_by: str | None = None


class GlossaryTermUpdate(BaseModel):
    term: str | None = None
    definition: str | None = None
    category: str | None = None
    updated_by: str | None = None


class GlossaryTermRead(GlossaryTermBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    updated_at: datetime


class GlossaryConsistencyReport(BaseModel):
    unused_terms: list[str]  # abbreviations never referenced via [[..]] anywhere
    undefined_references: list[str]  # [[..]] refs used in content with no matching term


class GlossaryImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]
