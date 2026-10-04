import uuid

from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.user import User
from app.services.auth import AuthError, decode_access_token
from app.services.permissions import can_read, has_org_permission, has_role_at_least

__all__ = ["get_db"]


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Returns None for an anonymous caller — most reads stay open per §13.3;
    only specific project content is gated (§13.2/13.4), enforced separately.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_access_token(token)
    except AuthError:
        return None
    return db.get(User, uuid.UUID(payload["sub"]))


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Authentication required.")
    return user


def require_project_read(
    project_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    # §13.4: a private project is invisible to a non-member — not even its
    # existence is disclosed, so this is a 404, not a 403.
    if not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    return project


def require_project_role(min_role: str):
    def dependency(
        project_id: uuid.UUID,
        user: User = Depends(require_user),
        db: Session = Depends(get_db),
    ) -> Project:
        project = db.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")
        if not has_role_at_least(db, project_id, user.id, min_role):
            raise HTTPException(403, f"Requires at least '{min_role}' role on this project.")
        return project

    return dependency


def assert_org_admin(db: Session, user: User | None, org_id: uuid.UUID) -> None:
    """Organization-wide schema and reference data (item/link types,
    glossary, standards) may only be changed by an admin of that org."""
    if user is None or user.org_id != org_id or not has_org_permission(db, user, "org.admin"):
        raise HTTPException(403, "Only an organization admin can change this organization-wide setting.")
