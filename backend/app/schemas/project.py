import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectBase(BaseModel):
    name: str
    visibility: Literal["public", "private"] = "private"
    gitlab_repo_url: str | None = None
    default_branch: str = "main"


class ProjectCreate(ProjectBase):
    kind: Literal["project", "library"] = "project"
    key_prefix: str | None = Field(default=None, pattern=r"^[A-Z0-9]{1,12}$")


class ProjectUpdate(BaseModel):
    name: str | None = None
    visibility: Literal["public", "private"] | None = None
    key_prefix: str | None = Field(default=None, pattern=r"^[A-Z0-9]{1,12}$")


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    kind: str = "project"
    key_prefix: str | None = None
    mission_attribute_defs: list = []
    mission_attributes: dict = {}


class DocumentBase(BaseModel):
    name: str
    order: int = 0
    group_id: uuid.UUID | None = None


class DocumentCreate(DocumentBase):
    pass


class DocumentUpdate(BaseModel):
    name: str | None = None
    order: int | None = None
    group_id: uuid.UUID | None = None


class DocumentRead(DocumentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID


class DocumentGroupBase(BaseModel):
    name: str
    order: int = 0


class DocumentGroupCreate(DocumentGroupBase):
    pass


class DocumentGroupUpdate(BaseModel):
    name: str | None = None
    order: int | None = None


class DocumentGroupRead(DocumentGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
