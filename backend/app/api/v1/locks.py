"""Edit-lock endpoints (wymagania-wspolbieznosc §1–3, §5).

Item content locks:   /items/{id}/lock[...]
Structure locks:      /documents/{id}/structure-lock[...]

Clients acquire on "start editing", heartbeat every ~60 s while the editor
is open, and release on Save/Cancel. `navigator.sendBeacon` can't set an
Authorization header, so release also accepts POST /.../lock/release with
the token in the body.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.document import Document
from app.models.item import Item
from app.models.user import User
from app.schemas.item import LockRead
from app.services import locks
from app.services.auth import AuthError, decode_access_token
from app.services.notifications import item_route
from app.services.permissions import can_read, has_permission

router = APIRouter(tags=["locks"])


class LockStatus(BaseModel):
    lock: LockRead | None
    mine: bool
    can_override: bool
    timeout_minutes: int


class BeaconRelease(BaseModel):
    token: str


def _status(db: Session, scope: str, target_id: uuid.UUID, project_id: uuid.UUID, user: User | None) -> LockStatus:
    lock = locks.active_lock(db, scope, target_id)
    info = locks.to_info(lock) if lock else None
    return LockStatus(
        lock=LockRead(**info.__dict__) if info else None,
        mine=bool(info and user and info.user_id == user.id),
        can_override=bool(user and has_permission(db, project_id, user, "lock.override")),
        timeout_minutes=locks.org_setting(db, project_id, "edit_lock_timeout_minutes"),
    )


def _held(e: locks.LockHeld) -> HTTPException:
    info = locks.to_info(e.lock)
    return HTTPException(
        423, {"code": "locked", "message": f"{info.user_name} is editing this right now.", "lock": info.as_dict()}
    )


def _item(db: Session, item_id: uuid.UUID, user: User | None) -> Item:
    item = db.get(Item, item_id)
    if not item or not can_read(db, item.document.project, user.id if user else None):
        raise HTTPException(404, "Item not found")
    return item


def _document(db: Session, document_id: uuid.UUID, user: User | None) -> Document:
    document = db.get(Document, document_id)
    if not document or not can_read(db, document.project, user.id if user else None):
        raise HTTPException(404, "Document not found")
    return document


def _target(db: Session, scope: str, target_id: uuid.UUID, user: User | None):
    """(project_id, label, url) for a lock target."""
    if scope == "item":
        item = _item(db, target_id, user)
        return item.document.project_id, item.key or item.title[:60], item_route(
            item.document.project_id, item.document_id, item.id
        )
    document = _document(db, target_id, user)
    return document.project_id, f"structure of {document.name}", (
        f"/projects/{document.project_id}/documents/{document.id}"
    )


def _perm_for(scope: str) -> str:
    return "item.edit" if scope == "item" else "structure.edit"


def _get(scope: str, target_id: uuid.UUID, db: Session, user: User | None) -> LockStatus:
    project_id, _, _ = _target(db, scope, target_id, user)
    return _status(db, scope, target_id, project_id, user)


def _acquire(scope: str, target_id: uuid.UUID, db: Session, user: User) -> LockStatus:
    project_id, _, _ = _target(db, scope, target_id, user)
    if not has_permission(db, project_id, user, _perm_for(scope)):
        raise HTTPException(403, f"Requires the '{_perm_for(scope)}' permission on this project.")
    document_id = db.get(Item, target_id).document_id if scope == "item" else target_id
    try:
        locks.acquire(db, scope, target_id, project_id, user, document_id=document_id)
    except locks.LockHeld as e:
        raise _held(e)
    db.commit()
    return _status(db, scope, target_id, project_id, user)


def _heartbeat(scope: str, target_id: uuid.UUID, db: Session, user: User) -> LockStatus:
    project_id, _, _ = _target(db, scope, target_id, user)
    try:
        locks.heartbeat(db, scope, target_id, user)
    except locks.LockLost:
        current = locks.active_lock(db, scope, target_id)
        raise HTTPException(
            409,
            {
                "code": "lock_lost",
                "message": "You no longer hold this lock"
                + (f" — {current.user.display_name} is editing now." if current else "."),
                "lock": locks.to_info(current).as_dict() if current else None,
            },
        )
    db.commit()
    return _status(db, scope, target_id, project_id, user)


def _release(scope: str, target_id: uuid.UUID, db: Session, user: User) -> LockStatus:
    project_id, label, url = _target(db, scope, target_id, user)
    locks.release(db, scope, target_id, user, label=label, url=url)
    db.commit()
    return _status(db, scope, target_id, project_id, user)


def _override(scope: str, target_id: uuid.UUID, take_over: bool, db: Session, user: User) -> LockStatus:
    project_id, label, url = _target(db, scope, target_id, user)
    if not has_permission(db, project_id, user, "lock.override"):
        raise HTTPException(403, "Requires the 'lock.override' permission on this project.")
    locks.override(db, scope, target_id, project_id, user, take_over=take_over, label=label, url=url)
    db.commit()
    return _status(db, scope, target_id, project_id, user)


def _wait(scope: str, target_id: uuid.UUID, db: Session, user: User) -> LockStatus:
    project_id, _, _ = _target(db, scope, target_id, user)
    locks.add_waiter(db, scope, target_id, user)
    db.commit()
    return _status(db, scope, target_id, project_id, user)


def _beacon(scope: str, target_id: uuid.UUID, body: BeaconRelease, db: Session) -> None:
    try:
        payload = decode_access_token(body.token)
    except AuthError:
        raise HTTPException(401, "Invalid token.")
    user = db.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise HTTPException(401, "Invalid token.")
    _release(scope, target_id, db, user)


# Item content locks

@router.get("/items/{item_id}/lock", response_model=LockStatus)
def get_item_lock(item_id: uuid.UUID, db: Session = Depends(get_db), user: User | None = Depends(get_current_user)):
    return _get("item", item_id, db, user)


@router.post("/items/{item_id}/lock", response_model=LockStatus)
def acquire_item_lock(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _acquire("item", item_id, db, user)


@router.post("/items/{item_id}/lock/heartbeat", response_model=LockStatus)
def heartbeat_item_lock(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _heartbeat("item", item_id, db, user)


@router.delete("/items/{item_id}/lock", response_model=LockStatus)
def release_item_lock(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _release("item", item_id, db, user)


@router.post("/items/{item_id}/lock/release", status_code=204)
def beacon_release_item_lock(item_id: uuid.UUID, body: BeaconRelease, db: Session = Depends(get_db)):
    _beacon("item", item_id, body, db)


@router.post("/items/{item_id}/lock/override", response_model=LockStatus)
def override_item_lock(
    item_id: uuid.UUID, take_over: bool = False, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    return _override("item", item_id, take_over, db, user)


@router.post("/items/{item_id}/lock/notify-when-free", response_model=LockStatus)
def wait_item_lock(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _wait("item", item_id, db, user)


# Document structure locks

@router.get("/documents/{document_id}/structure-lock", response_model=LockStatus)
def get_structure_lock(
    document_id: uuid.UUID, db: Session = Depends(get_db), user: User | None = Depends(get_current_user)
):
    return _get("structure", document_id, db, user)


@router.post("/documents/{document_id}/structure-lock", response_model=LockStatus)
def acquire_structure_lock(document_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _acquire("structure", document_id, db, user)


@router.post("/documents/{document_id}/structure-lock/heartbeat", response_model=LockStatus)
def heartbeat_structure_lock(
    document_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    return _heartbeat("structure", document_id, db, user)


@router.delete("/documents/{document_id}/structure-lock", response_model=LockStatus)
def release_structure_lock(document_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return _release("structure", document_id, db, user)


@router.post("/documents/{document_id}/structure-lock/override", response_model=LockStatus)
def override_structure_lock(
    document_id: uuid.UUID, take_over: bool = False, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    return _override("structure", document_id, take_over, db, user)


@router.get("/projects/{project_id}/locks", response_model=list[LockRead])
def list_project_locks(
    project_id: uuid.UUID, db: Session = Depends(get_db), user: User | None = Depends(get_current_user)
):
    """Every live lock in the project — cheap enough for the tree view to
    poll every few seconds instead of refetching the whole item list."""
    from datetime import datetime, timezone

    from app.models.lock import EditLock
    from app.models.project import Project

    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    rows = (
        db.query(EditLock)
        .filter(EditLock.project_id == project_id, EditLock.expires_at > datetime.now(timezone.utc))
        .all()
    )
    return [LockRead(**locks.to_info(r).__dict__) for r in rows]
