import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict


class MatrixViewBase(BaseModel):
    name: str
    scope: Literal["personal", "shared"] = "shared"
    row_type_id: uuid.UUID
    col_type_id: uuid.UUID
    link_type_id: uuid.UUID
    is_default: bool = False


class MatrixViewCreate(MatrixViewBase):
    owner_id: str | None = None
    created_by: str | None = None


class MatrixViewUpdate(BaseModel):
    name: str | None = None
    is_default: bool | None = None


class MatrixViewRead(MatrixViewBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    owner_id: str | None
