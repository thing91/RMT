"""Append-only audit trail (app/models/audit.py).

`log()` only adds the row to the session — it's committed together with
the change it describes, so an audited action and its audit entry can never
diverge (either both land or neither does).
"""

import uuid

from sqlalchemy.orm import Session

from app.models.audit import AuditEvent
from app.models.project import Project
from app.models.user import User


def log(
    db: Session,
    *,
    action: str,
    subject_type: str,
    subject_id: uuid.UUID | None,
    actor: User | None,
    project_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    summary: str = "",
    payload: dict | None = None,
) -> AuditEvent:
    if org_id is None and project_id is not None:
        org_id = db.query(Project.org_id).filter(Project.id == project_id).scalar()
    if org_id is None and actor is not None:
        org_id = actor.org_id
    event = AuditEvent(
        org_id=org_id,
        project_id=project_id,
        actor_id=actor.id if actor else None,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        summary=summary,
        payload=_jsonable(payload or {}),
    )
    db.add(event)
    return event


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
