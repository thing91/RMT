"""In-app notifications + watching (app/models/notification.py), with email
fan-out through app/services/email.py.

`notify()` adds the inbox rows to the session (committed with the caller's
change) and sends email right away — same synchronous, best-effort model
the existing workflow emails use.
"""

import logging
import uuid
from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.config import settings
from app.models.notification import Notification, Subscription
from app.models.user import User
from app.services import email as mail

logger = logging.getLogger("rmt.notifications")


def watch(db: Session, user: User | uuid.UUID, subject_type: str, subject_id: uuid.UUID) -> None:
    user_id = user.id if isinstance(user, User) else user
    exists = (
        db.query(Subscription)
        .filter_by(user_id=user_id, subject_type=subject_type, subject_id=subject_id)
        .first()
    )
    if not exists:
        db.add(Subscription(user_id=user_id, subject_type=subject_type, subject_id=subject_id))
        db.flush()


def unwatch(db: Session, user: User | uuid.UUID, subject_type: str, subject_id: uuid.UUID) -> None:
    user_id = user.id if isinstance(user, User) else user
    db.query(Subscription).filter_by(
        user_id=user_id, subject_type=subject_type, subject_id=subject_id
    ).delete()


def is_watching(db: Session, user: User | None, subject_type: str, subject_id: uuid.UUID) -> bool:
    if user is None:
        return False
    return (
        db.query(Subscription)
        .filter_by(user_id=user.id, subject_type=subject_type, subject_id=subject_id)
        .first()
        is not None
    )


def watchers(db: Session, subject_type: str, subject_id: uuid.UUID) -> list[User]:
    return (
        db.query(User)
        .join(Subscription, Subscription.user_id == User.id)
        .filter(Subscription.subject_type == subject_type, Subscription.subject_id == subject_id)
        .all()
    )


def watcher_count(db: Session, subject_type: str, subject_id: uuid.UUID) -> int:
    return (
        db.query(Subscription)
        .filter(Subscription.subject_type == subject_type, Subscription.subject_id == subject_id)
        .count()
    )


def move_watchers(db: Session, subject_type: str, from_id: uuid.UUID, to_id: uuid.UUID) -> None:
    for sub in db.query(Subscription).filter_by(subject_type=subject_type, subject_id=from_id).all():
        watch(db, sub.user_id, subject_type, to_id)


def notify(
    db: Session,
    recipients: Iterable[User],
    *,
    kind: str,
    title: str,
    body: str | None = None,
    url: str | None = None,
    actor: User | None = None,
    subject_type: str | None = None,
    subject_id: uuid.UUID | None = None,
    email: bool = True,
    badge: str = "Update",
) -> int:
    """Notify each distinct recipient except the actor themself. Returns the
    number of users notified."""
    seen: set[uuid.UUID] = set()
    targets: list[User] = []
    for u in recipients:
        if u is None or u.id in seen or (actor is not None and u.id == actor.id):
            continue
        seen.add(u.id)
        targets.append(u)
    from app.services.events import emit

    for u in targets:
        emit(db, {"type": "notification", "user_id": str(u.id), "title": title[:200]})
        db.add(
            Notification(
                user_id=u.id,
                actor_id=actor.id if actor else None,
                kind=kind,
                title=title[:500],
                body=body,
                url=url,
                subject_type=subject_type,
                subject_id=subject_id,
            )
        )
    if email:
        addresses = [u.email for u in targets if u.email]
        if addresses:
            html = mail.render_generic_email(
                badge=badge,
                heading=title,
                intro=body or "",
                url=f"{settings.app_base_url}{url}" if url and url.startswith("/") else url,
            )
            try:
                mail.send_email(addresses, f"[RMT] {title}", html)
            except Exception:  # noqa: BLE001 — email is best-effort, never blocks the change
                logger.exception("Failed to send notification email")
    return len(targets)


def item_route(project_id: uuid.UUID, document_id: uuid.UUID, item_id: uuid.UUID) -> str:
    return f"/projects/{project_id}/documents/{document_id}?item={item_id}"
