import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LinkTypeBase(BaseModel):
    key: str
    name: str
    inverse_name: str
    # empty list = no restriction, any item type may be used (§4.6)
    allowed_source_types: list[uuid.UUID] = []
    allowed_target_types: list[uuid.UUID] = []


class LinkTypeCreate(LinkTypeBase):
    pass


class LinkTypeUpdate(BaseModel):
    name: str | None = None
    inverse_name: str | None = None
    allowed_source_types: list[uuid.UUID] | None = None
    allowed_target_types: list[uuid.UUID] | None = None


class LinkTypeRead(LinkTypeBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class LinkBase(BaseModel):
    source_item_id: uuid.UUID
    target_item_id: uuid.UUID
    link_type_id: uuid.UUID


class LinkCreate(LinkBase):
    pass


class LinkRead(LinkBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
