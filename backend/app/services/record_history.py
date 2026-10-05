"""Automatic change history for every record.

An `after_flush` hook on every SQLAlchemy session looks at what is about to
be committed — new, changed and deleted objects — and writes one
`record_changes` row per object with the changed fields ({field: [old,
new]}). Endpoints don't have to do anything; a new table is covered the
moment it has a model.

Who made the change comes from a per-request "actor" holder: a middleware
creates an empty holder for every request, and `get_current_user` fills it
once it knows the caller. (A holder object rather than a plain context
variable, because FastAPI runs dependencies and the endpoint in separate
worker threads — a value set inside one doesn't flow into the next, but a
shared object mutated in place does.)
"""

import contextvars
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.record_change import RecordChange

_actor: contextvars.ContextVar[dict | None] = contextvars.ContextVar("rmt_actor", default=None)

# Tables whose rows are bookkeeping, not records anyone needs the history of
# (or that already are a history).
EXCLUDED_TABLES = {
    "record_changes",
    "audit_events",
    "item_versions",
    "edit_locks",
    "lock_waiters",
    "notifications",
    "key_counters",
    "api_tokens",
}
# Columns that change on every write without meaning anything to a person.
IGNORED_FIELDS = {"updated_at", "version", "last_synced_at", "last_used_at"}
LABEL_FIELDS = ("key", "name", "title", "abbreviation", "abbr", "code", "display_name", "username")


def new_request_actor() -> contextvars.Token:
    """Called by the middleware at the start of every request."""
    return _actor.set({})


def reset_request_actor(token: contextvars.Token) -> None:
    _actor.reset(token)


def set_actor(user_id: uuid.UUID | None, name: str | None) -> None:
    holder = _actor.get()
    if holder is not None:
        holder["id"] = user_id
        holder["name"] = name


def _json(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value) if isinstance(value, uuid.UUID) else float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): _json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json(v) for v in value]
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    return str(value)


def _entity_id(obj) -> str:
    identity = inspect(obj).identity
    if identity:
        return ":".join(str(v) for v in identity)
    mapper = inspect(obj).mapper
    return ":".join(str(getattr(obj, c.key)) for c in mapper.primary_key)


def _label(obj) -> str | None:
    for field in LABEL_FIELDS:
        value = getattr(obj, field, None)
        if isinstance(value, str) and value:
            if field == "key" and isinstance(getattr(obj, "title", None), str):
                return f"{value} {obj.title}"[:500]
            return value[:500]
    return None


def _scope(session: Session, obj) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """(project_id, org_id) the record belongs to, best effort — used to
    authorize reading its history and to build per-project change logs."""
    from app.models.document import Document
    from app.models.item import Item
    from app.models.project import Project

    project_id = getattr(obj, "project_id", None)
    org_id = getattr(obj, "org_id", None)
    with session.no_autoflush:
        if project_id is None and getattr(obj, "document_id", None):
            doc = session.get(Document, obj.document_id)
            project_id = doc.project_id if doc else None
        if project_id is None and getattr(obj, "item_id", None):
            item = session.get(Item, obj.item_id)
            if item is not None:
                doc = session.get(Document, item.document_id)
                project_id = doc.project_id if doc else None
        if project_id is None and getattr(obj, "source_item_id", None):
            item = session.get(Item, obj.source_item_id)
            if item is not None:
                doc = session.get(Document, item.document_id)
                project_id = doc.project_id if doc else None
        if isinstance(obj, Project):
            project_id = obj.id
        if org_id is None and project_id is not None:
            project = session.get(Project, project_id)
            org_id = project.org_id if project else None
    return project_id, org_id


def _column_changes(obj, action: str) -> dict:
    state = inspect(obj)
    changes: dict = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        if action == "update" and key in IGNORED_FIELDS:
            continue
        hist = state.attrs[key].history
        if action == "create":
            value = getattr(obj, key, None)
            if value is not None and key not in ("created_at", "updated_at"):
                changes[key] = [None, _json(value)]
        elif action == "delete":
            value = hist.unchanged[0] if hist.unchanged else (hist.deleted[0] if hist.deleted else None)
            if value is not None:
                changes[key] = [_json(value), None]
        elif hist.has_changes():
            old = hist.deleted[0] if hist.deleted else None
            new = hist.added[0] if hist.added else None
            old_j, new_j = _json(old), _json(new)
            if old_j != new_j:
                changes[key] = [old_j, new_j]
    return changes


@event.listens_for(Session, "after_flush")
def _record_changes(session: Session, flush_context) -> None:
    holder = _actor.get() or {}
    rows = []
    for action, objects in (("create", session.new), ("update", session.dirty), ("delete", session.deleted)):
        for obj in list(objects):
            table = getattr(obj, "__tablename__", None)
            if table is None or table in EXCLUDED_TABLES:
                continue
            if action == "update" and not session.is_modified(obj, include_collections=False):
                continue
            changes = _column_changes(obj, action)
            if action == "update" and not changes:
                continue
            project_id, org_id = _scope(session, obj)
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "at": datetime.now().astimezone(),
                    "entity_type": table,
                    "entity_id": _entity_id(obj),
                    "action": action,
                    "label": _label(obj),
                    "changes": changes,
                    "actor_id": holder.get("id"),
                    "actor_name": holder.get("name"),
                    "project_id": project_id,
                    "org_id": org_id,
                }
            )
    if rows:
        session.connection().execute(RecordChange.__table__.insert(), rows)
