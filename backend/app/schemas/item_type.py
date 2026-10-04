import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict

DataType = Literal[
    "text",
    "rich_text",
    "enum",
    "multi_enum",
    "number",
    "date",
    "boolean",
    "user_ref",
    "item_ref",
]
Behavior = Literal["structural", "content"]


class EnumOption(BaseModel):
    value: str
    label: str
    deprecated: bool = False
    # §workflow: only meaningful on the attribute keyed "status". Setting a
    # content item's status to a value flagged `requires_approval` can only
    # happen through the dedicated approve endpoint, not a plain edit — see
    # app/services/workflow.py. `notify_reviewers` fires a "review requested"
    # email to the document's assigned reviewers/approvers when an item's
    # status is set to that value via a normal edit.
    requires_approval: bool = False
    notify_reviewers: bool = False


class ItemTypeAttributeBase(BaseModel):
    key: str
    label: str
    data_type: DataType
    enum_options: list[EnumOption] | None = None
    unit: str | None = None
    min: float | None = None
    max: float | None = None
    required: bool = False
    order: int = 0


class ItemTypeAttributeCreate(ItemTypeAttributeBase):
    pass


class ItemTypeAttributeUpdate(BaseModel):
    label: str | None = None
    enum_options: list[EnumOption] | None = None
    unit: str | None = None
    min: float | None = None
    max: float | None = None
    required: bool | None = None
    order: int | None = None
    deprecated: bool | None = None


class ItemTypeAttributeRead(ItemTypeAttributeBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_system: bool
    deprecated: bool


class ItemTypeBase(BaseModel):
    key: str
    name: str
    prefix: str = ""
    icon: str | None = None
    color: str | None = None
    behavior: Behavior = "content"


class ItemTypeCreate(ItemTypeBase):
    pass


class ItemTypeUpdate(BaseModel):
    name: str | None = None
    prefix: str | None = None
    icon: str | None = None
    color: str | None = None


class ItemTypeRead(ItemTypeBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_system: bool
    attributes: list[ItemTypeAttributeRead] = []
