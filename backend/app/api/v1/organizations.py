import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.organization import Organization
from app.models.user import User
from pydantic import BaseModel, ConfigDict

router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    email: str | None


@router.get("", response_model=list[OrganizationRead])
def list_organizations(db: Session = Depends(get_db)):
    return db.query(Organization).order_by(Organization.name).all()


@router.get("/{org_id}", response_model=OrganizationRead)
def get_organization(org_id: uuid.UUID, db: Session = Depends(get_db)):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    return org


@router.get("/{org_id}/users", response_model=list[UserRead])
def list_org_users(org_id: uuid.UUID, db: Session = Depends(get_db)):
    """Open like the rest of the org directory (no project data) — used to
    populate "assign as reviewer/approver" pickers (§workflow)."""
    return db.query(User).filter(User.org_id == org_id).order_by(User.display_name).all()
