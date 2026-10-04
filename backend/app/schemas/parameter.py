import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ParameterCreate(BaseModel):
    key: str
    name: str
    value: float | None = None
    unit: str | None = None
    data_type: str = "constant"  # "constant" | "derived"
    formula: str | None = None
    source: str = "assumed"
    min: float | None = None
    max: float | None = None
    tolerance: float | None = None
    description: str | None = None


class ParameterUpdate(BaseModel):
    name: str | None = None
    value: float | None = None
    unit: str | None = None
    data_type: str | None = None
    formula: str | None = None
    source: str | None = None
    min: float | None = None
    max: float | None = None
    tolerance: float | None = None
    description: str | None = None


class ParameterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    key: str
    name: str
    value: float | None
    computed_value: float | None = None
    unit: str | None
    data_type: str
    formula: str | None
    source: str
    min: float | None
    max: float | None
    tolerance: float | None
    updated_by: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime
    used_in_count: int = 0


class ParameterUsage(BaseModel):
    item_id: uuid.UUID
    item_key: str | None
    item_title: str
