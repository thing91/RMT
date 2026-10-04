import uuid

from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    username: str
    email: str | None
    display_name: str


class ProjectAccessCreate(BaseModel):
    subject_type: str  # "user" | "group"
    subject_id: uuid.UUID
    role: str


class ProjectAccessRead(ProjectAccessCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
