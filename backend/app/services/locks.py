"""Edit locks as leases (app/models/lock.py) — wymagania-wspolbieznosc §1–3, §5.

- `acquire()` takes (or renews) a lock; raises LockHeld if someone else has
  an unexpired one.
- `heartbeat()` extends the caller's own lease; raises LockLost if it's
  gone (expired and taken by someone else, or overridden by an admin).
- `release()` / `override()` free it; `override()` is audited.
- `assert_can_write()` is what write endpoints call: writing is allowed
  when nobody else holds a live lock (the optimistic If-Match check is the
  second line of defence, see app/services/concurrency.py).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.models.lock import EditLock, LockWaiter
from app.models.user import User
from app.services import audit
from app.services.notifications import notify


class LockHeld(Exception):
    def __init__(self, lock: EditLock):
        self.lock = lock
        super().__init__(f"Locked by {lock.user.display_name}")


class LockLost(Exception):
    pass


@dataclass
class LockInfo:
    scope: str
    target_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    acquired_at: datetime
    expires_at: datetime
    implicit: bool

    def as_dict(self) -> dict:
        return {
            "scope": self.scope,
            "target_id": str(self.target_id),
            "user_id": str(self.user_id),
            "user_name": self.user_name,
            "acquired_at": self.acquired_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "implicit": self.implicit,
        }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lease() -> timedelta:
    return timedelta(minutes=settings.edit_lock_timeout_minutes)


def _row(db: Session, scope: str, target_id: uuid.UUID) -> EditLock | None:
    return db.query(EditLock).filter_by(scope=scope, target_id=target_id).first()


def _is_live(lock: EditLock | None) -> bool:
    return lock is not None and lock.expires_at > _now()


def to_info(lock: EditLock) -> LockInfo:
    return LockInfo(
        scope=lock.scope,
        target_id=lock.target_id,
        user_id=lock.user_id,
        user_name=lock.user.display_name,
        acquired_at=lock.acquired_at,
        expires_at=lock.expires_at,
        implicit=lock.implicit,
    )


def active_lock(db: Session, scope: str, target_id: uuid.UUID) -> EditLock | None:
    lock = _row(db, scope, target_id)
    return lock if _is_live(lock) else None


def active_locks(db: Session, scope: str, target_ids: list[uuid.UUID]) -> dict[uuid.UUID, LockInfo]:
    if not target_ids:
        return {}
    rows = (
        db.query(EditLock)
        .filter(EditLock.scope == scope, EditLock.target_id.in_(target_ids), EditLock.expires_at > _now())
        .all()
    )
    return {r.target_id: to_info(r) for r in rows}


def acquire(
    db: Session,
    scope: str,
    target_id: uuid.UUID,
    project_id: uuid.UUID,
    user: User,
    *,
    implicit: bool = False,
    lease: timedelta | None = None,
) -> EditLock:
    lease = lease or _lease()
    now = _now()
    lock = _row(db, scope, target_id)
    if lock is not None and _is_live(lock) and lock.user_id != user.id:
        raise LockHeld(lock)
    if lock is None:
        lock = EditLock(
            scope=scope,
            target_id=target_id,
            project_id=project_id,
            user_id=user.id,
            acquired_at=now,
            heartbeat_at=now,
            expires_at=now + lease,
            implicit=implicit,
        )
        db.add(lock)
    else:
        if lock.user_id != user.id or not _is_live(lock):
            # Taking over an expired lease — a fresh acquisition.
            lock.user_id = user.id
            lock.acquired_at = now
        elif lock.implicit and not implicit:
            lock.implicit = False  # an explicit lock upgrades the implicit one
        # Never shorten a longer lease the same user already holds (an
        # implicit structure op inside an explicit structure session).
        lock.expires_at = max(lock.expires_at, now + lease) if lock.user_id == user.id else now + lease
        lock.heartbeat_at = now
        if not implicit:
            lock.implicit = False
    db.flush()
    db.refresh(lock)
    return lock


def heartbeat(db: Session, scope: str, target_id: uuid.UUID, user: User) -> EditLock:
    lock = _row(db, scope, target_id)
    if lock is None or lock.user_id != user.id:
        raise LockLost()
    if not _is_live(lock):
        # Expired but nobody took it meanwhile — just renew it; the user
        # never lost anything.
        lock.acquired_at = lock.acquired_at or _now()
    lock.heartbeat_at = _now()
    lock.expires_at = _now() + _lease()
    db.flush()
    return lock


def _notify_waiters(db: Session, scope: str, target_id: uuid.UUID, label: str, url: str | None) -> None:
    waiters = db.query(LockWaiter).filter_by(scope=scope, target_id=target_id).all()
    if not waiters:
        return
    users = [db.get(User, w.user_id) for w in waiters]
    notify(
        db,
        users,
        kind="lock.released",
        title=f"{label} is free to edit again",
        body=f"The edit lock on {label} was released.",
        url=url,
        subject_type="item" if scope == "item" else "document",
        subject_id=target_id,
        email=False,
    )
    for w in waiters:
        db.delete(w)


def release(
    db: Session, scope: str, target_id: uuid.UUID, user: User, *, label: str = "", url: str | None = None
) -> bool:
    lock = _row(db, scope, target_id)
    if lock is None or lock.user_id != user.id:
        return False
    db.delete(lock)
    _notify_waiters(db, scope, target_id, label or "The element", url)
    db.flush()
    return True


def override(
    db: Session,
    scope: str,
    target_id: uuid.UUID,
    project_id: uuid.UUID,
    admin: User,
    *,
    take_over: bool,
    label: str = "",
    url: str | None = None,
) -> EditLock | None:
    """Release (take_over=False) or take over (take_over=True) someone
    else's lock. Caller has already checked the `lock.override` permission."""
    lock = _row(db, scope, target_id)
    previous_owner = lock.user if lock is not None and _is_live(lock) else None
    audit.log(
        db,
        action="lock.take_over" if take_over else "lock.release_forced",
        subject_type=scope,
        subject_id=target_id,
        actor=admin,
        project_id=project_id,
        summary=(
            f"{admin.display_name} {'took over' if take_over else 'released'} the {scope} lock"
            + (f" held by {previous_owner.display_name}" if previous_owner else "")
            + (f" on {label}" if label else "")
        ),
        payload={"previous_owner_id": previous_owner.id if previous_owner else None},
    )
    if previous_owner is not None and previous_owner.id != admin.id:
        notify(
            db,
            [previous_owner],
            kind="lock.overridden",
            title=f"Your edit lock on {label or 'an element'} was {'taken over' if take_over else 'released'}",
            body=f"{admin.display_name} {'took over' if take_over else 'released'} your lock. Unsaved changes "
            "can no longer be saved without resolving a conflict.",
            url=url,
            actor=admin,
            subject_type=scope,
            subject_id=target_id,
        )
    if lock is not None:
        db.delete(lock)
        db.flush()
    if take_over:
        return acquire(db, scope, target_id, project_id, admin)
    _notify_waiters(db, scope, target_id, label or "The element", url)
    return None


def add_waiter(db: Session, scope: str, target_id: uuid.UUID, user: User) -> None:
    exists = db.query(LockWaiter).filter_by(scope=scope, target_id=target_id, user_id=user.id).first()
    if not exists:
        db.add(LockWaiter(scope=scope, target_id=target_id, user_id=user.id))
        db.flush()


def assert_can_write(db: Session, scope: str, target_id: uuid.UUID, user: User) -> None:
    lock = active_lock(db, scope, target_id)
    if lock is not None and lock.user_id != user.id:
        raise LockHeld(lock)


def assert_no_explicit_structure_lock(db: Session, document_id: uuid.UUID, user: User) -> None:
    """Adding an item only conflicts with someone deliberately reorganizing
    the document (an explicit structure lock) — not with another user's
    implicit move lease, so several people can add items side by side."""
    lock = active_lock(db, "structure", document_id)
    if lock is not None and lock.user_id != user.id and not lock.implicit:
        raise LockHeld(lock)


def touch_structure(db: Session, document_id: uuid.UUID, project_id: uuid.UUID, user: User) -> None:
    """Implicit structure lease for a toolbar operation (move/indent/...)."""
    acquire(
        db,
        "structure",
        document_id,
        project_id,
        user,
        implicit=True,
        lease=timedelta(seconds=settings.structure_lock_implicit_seconds),
    )
