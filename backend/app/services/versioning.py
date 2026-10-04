"""Item content versioning (app/models/item_version.py).

Every content write goes through `record_version()`: it bumps
`items.version` and stores a full snapshot of the resulting state. Version
1 is written on create. Purely structural changes (parent/order) bump
`documents.structure_version` via `bump_structure()` instead.
"""

import difflib
import uuid

from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.item import Item
from app.models.item_version import ItemVersion
from app.models.user import User

# Fields that make up an item's *content* — changing any of them is a new
# content version. parent_id/order are structure, not content.
CONTENT_FIELDS = ("title", "description_md", "attributes")
STRUCTURE_FIELDS = ("parent_id", "order")


def snapshot(item: Item) -> dict:
    return {
        "key": item.key,
        "title": item.title,
        "description_md": item.description_md,
        "attributes": dict(item.attributes or {}),
        "item_type_id": str(item.item_type_id),
        "parent_id": str(item.parent_id) if item.parent_id else None,
        "order": item.order,
        "obsolete": item.obsolete_at is not None,
    }


def record_version(
    db: Session,
    item: Item,
    *,
    changed_by: User | None,
    reason: str = "edit",
    note: str | None = None,
    source_ref: str | None = None,
    author: User | None = None,
    initial: bool = False,
) -> ItemVersion:
    """Bump the item's version (unless `initial`) and snapshot it.

    Must be called after the new values have been assigned to `item` and
    before commit. Flushes so a freshly created item has an id.
    """
    if not initial:
        item.version = (item.version or 1) + 1
    else:
        item.version = 1
    db.flush()
    row = ItemVersion(
        item_id=item.id,
        version=item.version,
        snapshot=snapshot(item),
        reason=reason,
        note=note,
        source_ref=source_ref,
        author_id=(author or changed_by).id if (author or changed_by) else None,
        changed_by_id=changed_by.id if changed_by else None,
    )
    db.add(row)
    return row


def bump_structure(db: Session, document_id: uuid.UUID) -> int:
    document = db.get(Document, document_id)
    document.structure_version = (document.structure_version or 1) + 1
    return document.structure_version


def get_version(db: Session, item_id: uuid.UUID, version: int) -> ItemVersion | None:
    return (
        db.query(ItemVersion)
        .filter(ItemVersion.item_id == item_id, ItemVersion.version == version)
        .first()
    )


def _text_ops(old: str, new: str) -> list[dict]:
    """Word-level diff as a list of {op: equal|insert|delete, text} chunks —
    ready for the frontend to render inline with <ins>/<del>."""
    import re

    a = re.findall(r"\s+|[^\s]+", old or "")
    b = re.findall(r"\s+|[^\s]+", new or "")
    ops: list[dict] = []
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            ops.append({"op": "equal", "text": "".join(a[i1:i2])})
        else:
            if i2 > i1:
                ops.append({"op": "delete", "text": "".join(a[i1:i2])})
            if j2 > j1:
                ops.append({"op": "insert", "text": "".join(b[j1:j2])})
    return ops


def diff_snapshots(old: dict, new: dict) -> list[dict]:
    """Field-level diff between two snapshots (or any two dicts shaped like
    one). Text fields also carry a word-level `ops` list."""
    changes: list[dict] = []
    for field in ("title", "description_md"):
        if (old.get(field) or "") != (new.get(field) or ""):
            changes.append(
                {
                    "field": field,
                    "old": old.get(field),
                    "new": new.get(field),
                    "ops": _text_ops(old.get(field) or "", new.get(field) or ""),
                }
            )
    old_attrs = old.get("attributes") or {}
    new_attrs = new.get("attributes") or {}
    for key in sorted(set(old_attrs) | set(new_attrs)):
        if old_attrs.get(key) != new_attrs.get(key):
            entry = {"field": f"attributes.{key}", "old": old_attrs.get(key), "new": new_attrs.get(key)}
            if isinstance(entry["old"], str) or isinstance(entry["new"], str):
                entry["ops"] = _text_ops(str(entry["old"] or ""), str(entry["new"] or ""))
            changes.append(entry)
    for field in ("parent_id", "order", "obsolete"):
        if old.get(field) != new.get(field):
            changes.append({"field": field, "old": old.get(field), "new": new.get(field)})
    return changes
