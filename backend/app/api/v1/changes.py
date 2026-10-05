"""Change history of any record (`record_changes`, written automatically
on every flush) and personal API tokens."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.api_token import ApiToken
from app.models.project import Project
from app.models.record_change import RecordChange
from app.models.user import User
from app.services.api_tokens import create_token
from app.services.permissions import can_read, is_org_admin

router = APIRouter(tags=["history"])

# Organization-level records only an org admin may see the history of.
_ADMIN_ONLY = {"users", "organizations", "role_permissions", "groups", "group_members", "project_access"}


class RecordChangeRead(BaseModel):
    id: uuid.UUID
    at: datetime
    entity_type: str
    entity_id: str
    action: str
    label: str | None
    changes: dict
    actor_name: str | None
    project_id: uuid.UUID | None


def _visible(db: Session, user: User | None, row: RecordChange) -> bool:
    if row.project_id is not None:
        project = db.get(Project, row.project_id)
        return project is not None and can_read(db, project, user.id if user else None)
    if user is None:
        return False
    if row.entity_type in _ADMIN_ONLY:
        return is_org_admin(user)
    return row.org_id is None or row.org_id == user.org_id


@router.get("/changes/{entity_type}/{entity_id}", response_model=list[RecordChangeRead])
def record_history(
    entity_type: str,
    entity_id: str,
    limit: int = Query(200, le=1000),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every change to one record, newest first."""
    rows = (
        db.query(RecordChange)
        .filter(RecordChange.entity_type == entity_type, RecordChange.entity_id == entity_id)
        .order_by(RecordChange.at.desc())
        .limit(limit)
        .all()
    )
    if rows and not _visible(db, user, rows[-1]):
        raise HTTPException(404, "Not found")
    return rows


@router.get("/projects/{project_id}/changes", response_model=list[RecordChangeRead])
def project_changes(
    project_id: uuid.UUID,
    entity_type: str | None = None,
    before: datetime | None = None,
    limit: int = Query(100, le=500),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The project's change log: every change to anything in it, newest
    first; page back with `before`."""
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    q = db.query(RecordChange).filter(RecordChange.project_id == project_id)
    if entity_type:
        q = q.filter(RecordChange.entity_type == entity_type)
    if before:
        q = q.filter(RecordChange.at < before)
    return q.order_by(RecordChange.at.desc()).limit(limit).all()


# ---- personal API tokens -------------------------------------------------------


class ApiTokenRead(BaseModel):
    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiTokenCreate(BaseModel):
    name: str
    expires_in_days: int | None = 90


class ApiTokenCreated(ApiTokenRead):
    token: str


@router.get("/me/api-tokens", response_model=list[ApiTokenRead])
def list_tokens(user: User = Depends(require_user), db: Session = Depends(get_db)):
    return db.query(ApiToken).filter(ApiToken.user_id == user.id).order_by(ApiToken.created_at.desc()).all()


@router.post("/me/api-tokens", response_model=ApiTokenCreated, status_code=201)
def new_token(payload: ApiTokenCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Create a token. The plain value is in the response only — store it
    somewhere safe, it can't be shown again."""
    if not payload.name.strip():
        raise HTTPException(422, "Give the token a name.")
    if payload.expires_in_days is not None and not 1 <= payload.expires_in_days <= 3650:
        raise HTTPException(422, "Expiry must be between 1 and 3650 days.")
    row, plain = create_token(db, user, payload.name.strip(), payload.expires_in_days)
    db.commit()
    db.refresh(row)
    return ApiTokenCreated(**ApiTokenRead.model_validate(row, from_attributes=True).model_dump(), token=plain)


@router.delete("/me/api-tokens/{token_id}", status_code=204)
def revoke_token(token_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    row = db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Token not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
