"""The signed-in user's inbox, watch list and effective permissions."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.notification import Notification
from app.models.permission import RolePermission
from app.models.project import Project
from app.models.user import User
from app.services import audit
from app.services.notifications import is_watching, unwatch, watch, watcher_count
from app.services.permissions import (
    ALL_PERMISSIONS,
    ROLE_DEFAULT_PERMISSIONS,
    can_read,
    get_effective_role,
    is_org_admin,
    org_permissions,
    permissions_for_role,
    project_permissions,
)

router = APIRouter(tags=["me"])


class NotificationRead(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None
    url: str | None
    actor: str | None
    subject_type: str | None
    subject_id: uuid.UUID | None
    read: bool
    created_at: datetime


class NotificationPage(BaseModel):
    unread: int
    items: list[NotificationRead]


class WatchState(BaseModel):
    watching: bool
    watchers: int


class WatchRequest(BaseModel):
    subject_type: str
    subject_id: uuid.UUID


class PermissionsRead(BaseModel):
    role: str | None
    permissions: list[str]
    org_admin: bool
    org_permissions: list[str]


def _nread(n: Notification) -> NotificationRead:
    return NotificationRead(
        id=n.id,
        kind=n.kind,
        title=n.title,
        body=n.body,
        url=n.url,
        actor=n.actor.display_name if n.actor else None,
        subject_type=n.subject_type,
        subject_id=n.subject_id,
        read=n.read_at is not None,
        created_at=n.created_at,
    )


@router.get("/me/notifications", response_model=NotificationPage)
def my_notifications(
    unread_only: bool = False, limit: int = 50, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    unread = q.filter(Notification.read_at.is_(None)).count()
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    rows = q.order_by(Notification.created_at.desc()).limit(min(limit, 200)).all()
    return NotificationPage(unread=unread, items=[_nread(n) for n in rows])


@router.post("/me/notifications/{notification_id}/read", status_code=204)
def mark_read(notification_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    n.read_at = n.read_at or datetime.now(timezone.utc)
    db.commit()


@router.post("/me/notifications/read-all", status_code=204)
def mark_all_read(user: User = Depends(require_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).update(
        {Notification.read_at: datetime.now(timezone.utc)}
    )
    db.commit()


@router.get("/watch/{subject_type}/{subject_id}", response_model=WatchState)
def watch_state(
    subject_type: str,
    subject_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return WatchState(
        watching=is_watching(db, user, subject_type, subject_id),
        watchers=watcher_count(db, subject_type, subject_id),
    )


@router.post("/watch", response_model=WatchState)
def start_watching(payload: WatchRequest, user: User = Depends(require_user), db: Session = Depends(get_db)):
    watch(db, user, payload.subject_type, payload.subject_id)
    db.commit()
    return watch_state(payload.subject_type, payload.subject_id, user, db)


@router.delete("/watch/{subject_type}/{subject_id}", response_model=WatchState)
def stop_watching(
    subject_type: str, subject_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    unwatch(db, user, subject_type, subject_id)
    db.commit()
    return watch_state(subject_type, subject_id, user, db)


@router.get("/me/permissions", response_model=PermissionsRead)
def my_permissions(
    project_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """What the caller may do — globally, or on one project. Lets the UI
    hide/disable actions instead of discovering a 403 on click."""
    if project_id is not None:
        project = db.get(Project, project_id)
        if not project or not can_read(db, project, user.id if user else None):
            raise HTTPException(404, "Project not found")
    return PermissionsRead(
        role=get_effective_role(db, project_id, user.id) if (user and project_id) else None,
        permissions=sorted(project_permissions(db, project_id, user)) if project_id else [],
        org_admin=is_org_admin(user),
        org_permissions=sorted(org_permissions(db, user)),
    )


# ---- organization role → permission overrides (org admins only) ----------


class RolePermissionsRead(BaseModel):
    role: str
    defaults: list[str]
    effective: list[str]


class RolePermissionSet(BaseModel):
    role: str
    permission: str
    granted: bool | None  # None = back to the default


@router.get("/organizations/{org_id}/role-permissions", response_model=list[RolePermissionsRead])
def list_role_permissions(org_id: uuid.UUID, db: Session = Depends(get_db)):
    roles = list(ROLE_DEFAULT_PERMISSIONS) + ["org_member"]
    return [
        RolePermissionsRead(
            role=r,
            defaults=sorted(ROLE_DEFAULT_PERMISSIONS.get(r, frozenset())),
            effective=sorted(permissions_for_role(db, org_id, r)),
        )
        for r in roles
    ]


@router.put("/organizations/{org_id}/role-permissions", response_model=list[RolePermissionsRead])
def set_role_permission(
    org_id: uuid.UUID, payload: RolePermissionSet, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    if not is_org_admin(user) or user.org_id != org_id:
        raise HTTPException(403, "Only an organization admin can change role permissions.")
    if payload.permission not in ALL_PERMISSIONS:
        raise HTTPException(422, f"Unknown permission '{payload.permission}'.")
    if payload.role not in list(ROLE_DEFAULT_PERMISSIONS) + ["org_member"]:
        raise HTTPException(422, f"Unknown role '{payload.role}'.")
    row = db.query(RolePermission).filter_by(org_id=org_id, role=payload.role, permission=payload.permission).first()
    if payload.granted is None:
        if row:
            db.delete(row)
    elif row:
        row.granted = payload.granted
    else:
        db.add(RolePermission(org_id=org_id, role=payload.role, permission=payload.permission, granted=payload.granted))
    audit.log(
        db,
        action="permissions.changed",
        subject_type="role",
        subject_id=None,
        actor=user,
        org_id=org_id,
        summary=f"{payload.role}: {payload.permission} → "
        + {True: "granted", False: "revoked", None: "default"}[payload.granted],
    )
    db.commit()
    return list_role_permissions(org_id, db)


# ---- organization settings (org admins only to change) ----------------------

ORG_SETTING_SPECS = {
    "edit_lock_timeout_minutes": (int, 1, 240),
    "structure_lock_implicit_seconds": (int, 15, 1800),
    "suggestion_self_resolve": (bool, None, None),
    "applicability_self_approve": (bool, None, None),
}


class OrgSettingsRead(BaseModel):
    values: dict
    defaults: dict


@router.get("/organizations/{org_id}/settings", response_model=OrgSettingsRead)
def get_org_settings(org_id: uuid.UUID, db: Session = Depends(get_db)):
    from app.config import settings as app_settings
    from app.models.organization import Organization

    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    defaults = {k: getattr(app_settings, k) for k in ORG_SETTING_SPECS}
    return OrgSettingsRead(values={**defaults, **(org.settings or {})}, defaults=defaults)


@router.put("/organizations/{org_id}/settings", response_model=OrgSettingsRead)
def put_org_settings(
    org_id: uuid.UUID, payload: dict, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    from app.api.deps import assert_org_admin
    from app.models.organization import Organization

    assert_org_admin(db, user, org_id)
    org = db.get(Organization, org_id)
    current = dict(org.settings or {})
    for key, value in payload.items():
        if key not in ORG_SETTING_SPECS:
            raise HTTPException(422, f"Unknown setting '{key}'.")
        typ, lo, hi = ORG_SETTING_SPECS[key]
        if value is None:
            current.pop(key, None)
            continue
        if typ is bool and not isinstance(value, bool):
            raise HTTPException(422, f"'{key}' must be true or false.")
        if typ is int:
            if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
                raise HTTPException(422, f"'{key}' must be a whole number between {lo} and {hi}.")
        current[key] = value
    org.settings = current
    audit.log(db, action="org.settings", subject_type="organization", subject_id=org.id, actor=user,
              org_id=org.id, summary="Organization settings changed", payload=payload)
    db.commit()
    return get_org_settings(org_id, db)
