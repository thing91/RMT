import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict


class TableViewColumn(BaseModel):
    attribute_key: str
    width: int | None = None


class TableViewBase(BaseModel):
    name: str
    scope: Literal["personal", "shared"] = "shared"
    item_type_id: uuid.UUID | None = None
    columns: list[TableViewColumn] = []
    filters: dict | None = None
    sort: dict | None = None
    is_default: bool = False


class TableViewCreate(TableViewBase):
    owner_id: str | None = None
    created_by: str | None = None


class TableViewUpdate(BaseModel):
    name: str | None = None
    columns: list[TableViewColumn] | None = None
    filters: dict | None = None
    sort: dict | None = None
    is_default: bool | None = None


class TableViewRead(TableViewBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    owner_id: str | None
    created_by: str | None
