"""Optimistic concurrency (wymagania-wspolbieznosc §4): ETag / If-Match.

An item's ETag is `"<item_id>:<version>"` (quoted, per RFC 9110). Every
content write must send `If-Match` with the ETag of the version it was
based on; a mismatch is a 412 whose body carries the current version and a
field diff between what the caller saw and what's there now, so the UI can
show the conflict instead of silently overwriting. This applies to every
writer — UI, API scripts, imports — not just the browser.
"""

import uuid

from fastapi import HTTPException, Response

from app.models.item import Item
from app.services.versioning import diff_snapshots, get_version, snapshot


def item_etag(item: Item) -> str:
    return f'"{item.id}:{item.version}"'


def set_item_etag(response: Response, item: Item) -> None:
    response.headers["ETag"] = item_etag(item)


def parse_version(if_match: str | None, item_id: uuid.UUID) -> int | None:
    """Accepts `"<id>:<n>"`, `W/"<id>:<n>"`, `<id>:<n>` or a bare `<n>`."""
    if if_match is None:
        return None
    value = if_match.strip()
    if value.startswith("W/"):
        value = value[2:]
    value = value.strip('"')
    if ":" in value:
        etag_id, _, num = value.rpartition(":")
        if etag_id != str(item_id):
            raise HTTPException(412, {"code": "etag_mismatch", "message": "If-Match refers to a different item."})
        value = num
    if not value.isdigit():
        raise HTTPException(400, "Malformed If-Match header.")
    return int(value)


def require_item_version(db, item: Item, if_match: str | None) -> None:
    """428 when If-Match is missing, 412 (with diff) when it's stale."""
    expected = parse_version(if_match, item.id)
    if expected is None:
        raise HTTPException(
            428,
            {
                "code": "precondition_required",
                "message": "This write requires an If-Match header with the item's current ETag.",
                "current_version": item.version,
            },
        )
    if expected == item.version:
        return
    base = get_version(db, item.id, expected)
    current = snapshot(item)
    raise HTTPException(
        412,
        {
            "code": "version_conflict",
            "message": (
                f"This item was changed by someone else (you edited version {expected}, "
                f"the current version is {item.version})."
            ),
            "your_version": expected,
            "current_version": item.version,
            "current": current,
            "changes_since_yours": diff_snapshots(base.snapshot, current) if base else [],
            "etag": item_etag(item),
        },
    )
