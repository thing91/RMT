"""Item version history + project audit trail."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.audit import AuditEvent
from app.models.item import Item
from app.models.item_version import ItemVersion
from app.models.project import Project
from app.models.user import User
from app.services.permissions import can_read, has_permission
from app.services.versioning import diff_snapshots, get_version, snapshot

router = APIRouter(tags=["history"])


class ItemVersionRead(BaseModel):
    version: int
    reason: str
    note: str | None
    source_ref: str | None
    author: str | None
    changed_by: str | None
    created_at: datetime
    status: str | None


class ItemVersionDetail(ItemVersionRead):
    snapshot: dict


class VersionDiff(BaseModel):
    from_version: int
    to_version: int
    changes: list[dict]


class AuditEventRead(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor: str | None
    action: str
    subject_type: str
    subject_id: uuid.UUID | None
    summary: str
    payload: dict


def _item(db: Session, item_id: uuid.UUID, user: User | None) -> Item:
    item = db.get(Item, item_id)
    if not item or not can_read(db, item.document.project, user.id if user else None):
        raise HTTPException(404, "Item not found")
    return item


def _vread(v: ItemVersion) -> ItemVersionRead:
    return ItemVersionRead(
        version=v.version,
        reason=v.reason,
        note=v.note,
        source_ref=v.source_ref,
        author=v.author.display_name if v.author else None,
        changed_by=v.changed_by.display_name if v.changed_by else None,
        created_at=v.created_at,
        status=(v.snapshot.get("attributes") or {}).get("status"),
    )


@router.get("/items/{item_id}/versions", response_model=list[ItemVersionRead])
def list_versions(item_id: uuid.UUID, user: User | None = Depends(get_current_user), db: Session = Depends(get_db)):
    _item(db, item_id, user)
    rows = db.query(ItemVersion).filter_by(item_id=item_id).order_by(ItemVersion.version.desc()).all()
    return [_vread(v) for v in rows]


@router.get("/items/{item_id}/versions/{version}", response_model=ItemVersionDetail)
def get_item_version(
    item_id: uuid.UUID, version: int, user: User | None = Depends(get_current_user), db: Session = Depends(get_db)
):
    _item(db, item_id, user)
    v = get_version(db, item_id, version)
    if not v:
        raise HTTPException(404, "Version not found")
    return ItemVersionDetail(**_vread(v).model_dump(), snapshot=v.snapshot)


@router.get("/items/{item_id}/diff", response_model=VersionDiff)
def diff_versions(
    item_id: uuid.UUID,
    from_version: int,
    to_version: int | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Diff two versions; `to_version` omitted = the current state."""
    item = _item(db, item_id, user)
    a = get_version(db, item_id, from_version)
    if not a:
        raise HTTPException(404, f"Version {from_version} not found")
    if to_version is None:
        b_snap, to_v = snapshot(item), item.version
    else:
        b = get_version(db, item_id, to_version)
        if not b:
            raise HTTPException(404, f"Version {to_version} not found")
        b_snap, to_v = b.snapshot, to_version
    return VersionDiff(from_version=from_version, to_version=to_v, changes=diff_snapshots(a.snapshot, b_snap))


def _aread(e: AuditEvent) -> AuditEventRead:
    return AuditEventRead(
        id=e.id,
        created_at=e.created_at,
        actor=e.actor.display_name if e.actor else None,
        action=e.action,
        subject_type=e.subject_type,
        subject_id=e.subject_id,
        summary=e.summary,
        payload=e.payload or {},
    )


@router.get("/projects/{project_id}/audit", response_model=list[AuditEventRead])
def project_audit(
    project_id: uuid.UUID,
    subject_type: str | None = None,
    subject_id: uuid.UUID | None = None,
    action: str | None = None,
    limit: int = 200,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    if not has_permission(db, project_id, user, "audit.read"):
        raise HTTPException(403, "Requires the 'audit.read' permission on this project.")
    q = db.query(AuditEvent).filter(AuditEvent.project_id == project_id)
    if subject_type:
        q = q.filter(AuditEvent.subject_type == subject_type)
    if subject_id:
        q = q.filter(AuditEvent.subject_id == subject_id)
    if action:
        q = q.filter(AuditEvent.action.like(f"{action}%"))
    return [_aread(e) for e in q.order_by(AuditEvent.created_at.desc()).limit(min(limit, 1000)).all()]


@router.get("/items/{item_id}/audit", response_model=list[AuditEventRead])
def item_audit(item_id: uuid.UUID, user: User | None = Depends(get_current_user), db: Session = Depends(get_db)):
    """An item's own audit trail — visible to anyone who can read the item
    (it only shows actions on that item)."""
    _item(db, item_id, user)
    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.subject_type == "item", AuditEvent.subject_id == item_id)
        .order_by(AuditEvent.created_at.desc())
        .all()
    )
    return [_aread(e) for e in rows]
