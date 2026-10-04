import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.baseline import Baseline
from app.models.comment import ItemComment
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.link import Link
from app.models.project import Project
from app.models.user import User
from app.schemas.item import ItemCreate, ItemRead, ItemUpdate, LockRead
from app.services import audit, locks
from app.services.attribute_validation import AttributeValidationError, validate_attributes
from app.services.concurrency import item_etag, require_item_version, set_item_etag
from app.services.git_sync import sync_item, sync_item_delete
from app.services.hierarchy import HierarchyError, validate_parent
from app.services.notifications import watch
from app.services.numbering import assign_numbers
from app.services.parameters import sync_parameter_links
from app.services.permissions import can_read, has_permission
from app.services.versioning import CONTENT_FIELDS, STRUCTURE_FIELDS, bump_structure, record_version
from app.services.workflow_engine import (
    STATUS_KEY,
    initial_state,
    resolve_item_definition,
    state,
)

router = APIRouter(tags=["items"])


def _project_id_for_document(db: Session, document_id: uuid.UUID) -> uuid.UUID | None:
    return (
        db.query(Document.project_id).filter(Document.id == document_id).scalar()
    )


def _require_content_read(db: Session, project_id: uuid.UUID, user: User | None) -> None:
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")


def _require_permission(db: Session, project_id: uuid.UUID, user: User | None, permission: str) -> User:
    if user is None or not has_permission(db, project_id, user, permission):
        raise HTTPException(403, f"Requires the '{permission}' permission on this project.")
    return user


def _lock_conflict(e: locks.LockHeld) -> HTTPException:
    info = locks.to_info(e.lock)
    return HTTPException(
        423,
        {
            "code": "locked",
            "message": f"{info.user_name} is editing this right now.",
            "lock": info.as_dict(),
        },
    )


def _next_key(db: Session, project_id: uuid.UUID, item_type: ItemType) -> str | None:
    if item_type.behavior != "content":
        return None
    # Based on the highest existing numeric suffix, not a row count — a
    # count would reissue an already-used key once an item gets deleted.
    existing_keys = (
        db.query(Item.key)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project_id, Item.item_type_id == item_type.id)
        .all()
    )
    highest = 0
    for (key,) in existing_keys:
        suffix = (key or "").removeprefix(item_type.prefix)
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{item_type.prefix}{highest + 1:03d}"


def _default_required_enums(
    attribute_defs: list[ItemTypeAttribute], attributes: dict
) -> dict:
    """Fills a required `enum` attribute with its first non-deprecated option
    when the creator didn't set one — e.g. a new Requirement starts out with
    Status = Draft, the same way ReqView-style tools default a fresh item's
    status rather than forcing every quick-add form to ask for it up front.
    Any other required attribute (text, number, ...) still has no sane
    default and is left to fail validation as usual.
    """
    result = dict(attributes)
    for attr in attribute_defs:
        if attr.required and attr.data_type == "enum" and result.get(attr.key) is None:
            options = [o for o in (attr.enum_options or []) if not o.get("deprecated")]
            if options:
                result[attr.key] = options[0]["value"]
    return result


def _behaviors_for_document(db: Session, document_id: uuid.UUID) -> dict:
    rows = (
        db.query(Item.item_type_id, ItemType.behavior)
        .join(ItemType, Item.item_type_id == ItemType.id)
        .filter(Item.document_id == document_id)
        .distinct()
        .all()
    )
    return {item_type_id: behavior for item_type_id, behavior in rows}


class ReadContext:
    """Preloads, once per request, everything `to_item_read` needs for a
    whole project (workflow definitions, live locks, locked baselines,
    suspect-link counts) so building a 500-item tree doesn't fire 500×N
    queries."""

    def __init__(self, db: Session, project_id: uuid.UUID, items: list[Item]):
        self.db = db
        self.project_id = project_id
        self._defs: dict[uuid.UUID, object] = {}
        ids = [i.id for i in items]
        self.locks = locks.active_locks(db, "item", ids)
        baselines = (
            db.query(Baseline)
            .filter(Baseline.project_id == project_id, Baseline.locks_items.is_(True))
            .order_by(Baseline.created_at)
            .all()
        )
        self.baselined: dict[str, str] = {}
        for b in baselines:
            for item_id in (b.item_versions or {}):
                self.baselined.setdefault(item_id, b.name)
        self.suspect: dict[uuid.UUID, int] = {}
        if ids:
            rows = (
                db.query(Link.source_item_id, Link.target_item_id)
                .filter(Link.suspect.is_(True))
                .filter(Link.source_item_id.in_(ids) | Link.target_item_id.in_(ids))
                .all()
            )
            for src, tgt in rows:
                # A suspect link needs re-verification from the side that
                # did *not* change, but both ends show the badge.
                self.suspect[src] = self.suspect.get(src, 0) + 1
                self.suspect[tgt] = self.suspect.get(tgt, 0) + 1

    def definition(self, item_type_id: uuid.UUID):
        if item_type_id not in self._defs:
            self._defs[item_type_id] = resolve_item_definition(self.db, self.project_id, item_type_id)
        return self._defs[item_type_id]

    def read_only_reason(self, item: Item) -> str | None:
        d = self.definition(item.item_type_id)
        if d is None:
            return None
        st = state({"states": d.states}, (item.attributes or {}).get(STATUS_KEY))
        if st and st.get("read_only"):
            return (
                f"'{st['label']}' items are read-only — run a workflow transition "
                "(e.g. request a change) to edit."
            )
        if st is not None and st.get("category") != "draft" and str(item.id) in self.baselined:
            return f"Frozen by baseline '{self.baselined[str(item.id)]}' — request a change to edit."
        return None


def to_item_read(item: Item, ctx: ReadContext | None = None, db: Session | None = None) -> ItemRead:
    # Built field-by-field rather than ItemRead.model_validate(item): the ORM
    # `Item.children` relationship would otherwise satisfy the schema's own
    # `children` field by lazy-loading and recursively validating real child
    # rows, which then collide with the flat-list tree we build ourselves.
    if ctx is None:
        ctx = ReadContext(db, item.document.project_id, [item])
    lock = ctx.locks.get(item.id)
    return ItemRead(
        id=item.id,
        document_id=item.document_id,
        parent_id=item.parent_id,
        item_type_id=item.item_type_id,
        key=item.key,
        title=item.title,
        description_md=item.description_md,
        attributes=item.attributes,
        order=item.order,
        created_at=item.created_at,
        updated_at=item.updated_at,
        updated_by=item.updated_by,
        number=None,
        children=[],
        approved_by=item.approved_by.display_name if item.approved_by else None,
        approved_at=item.approved_at,
        approval_stale=bool(item.approved_at and item.updated_at > item.approved_at),
        version=item.version,
        etag=item_etag(item),
        lock=LockRead(**lock.__dict__) if lock else None,
        obsolete=item.obsolete_at is not None,
        read_only_reason=ctx.read_only_reason(item),
        has_workflow=ctx.definition(item.item_type_id) is not None,
        suspect_links=ctx.suspect.get(item.id, 0),
    )


def _build_tree(items: list[Item], ctx: ReadContext) -> list[ItemRead]:
    by_id: dict[uuid.UUID, ItemRead] = {item.id: to_item_read(item, ctx) for item in items}
    roots: list[ItemRead] = []
    for item in items:
        node = by_id[item.id]
        if item.parent_id and item.parent_id in by_id:
            by_id[item.parent_id].children.append(node)
        else:
            roots.append(node)
    for node in by_id.values():
        node.children.sort(key=lambda n: n.order)
    roots.sort(key=lambda n: n.order)
    return roots


def _flatten_tree(nodes: list[ItemRead], depth: int = 0) -> list[ItemRead]:
    """Depth-first flatten of an already hierarchy-sorted tree (parent
    immediately followed by its own children, in order) — used so a flat
    listing (Table View) puts items in the same order Tree View shows them
    in, instead of a meaningless global sort by the `order` column (which
    is only ever comparable *within* one sibling group). Also stamps each
    node's nesting `depth` so a flat UI can still indicate structure."""
    flat: list[ItemRead] = []
    for node in nodes:
        children = node.children
        node.children = []
        node.depth = depth
        flat.append(node)
        flat.extend(_flatten_tree(children, depth + 1))
    return flat


@router.get("/documents/{document_id}/items", response_model=list[ItemRead])
def get_document_tree(
    document_id: uuid.UUID,
    include_obsolete: bool = False,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project_id = _project_id_for_document(db, document_id)
    if project_id is None:
        raise HTTPException(404, "Document not found")
    _require_content_read(db, project_id, user)

    query = db.query(Item).filter(Item.document_id == document_id)
    if not include_obsolete:
        # Obsolete items are retired, not deleted — they stay reachable
        # (traceability, matrix, history) but are hidden from the working
        # tree unless asked for.
        query = query.filter(Item.obsolete_at.is_(None))
    items = query.all()
    ctx = ReadContext(db, project_id, items)
    tree = _build_tree(items, ctx)
    behaviors = _behaviors_for_document(db, document_id)
    assign_numbers(tree, behaviors)
    return tree


@router.get("/projects/{project_id}/items", response_model=list[ItemRead])
def list_project_items(
    project_id: uuid.UUID,
    item_type_id: uuid.UUID | None = None,
    include_obsolete: bool = False,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_content_read(db, project_id, user)
    query = (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project_id)
    )
    if item_type_id:
        query = query.filter(Item.item_type_id == item_type_id)
    if not include_obsolete:
        query = query.filter(Item.obsolete_at.is_(None))
    items = query.all()
    ctx = ReadContext(db, project_id, items)

    by_document: dict[uuid.UUID, list[Item]] = {}
    for item in items:
        by_document.setdefault(item.document_id, []).append(item)

    documents = (
        db.query(Document)
        .filter(Document.project_id == project_id, Document.id.in_(list(by_document.keys())))
        .order_by(Document.order)
        .all()
    )

    behaviors = {item.item_type_id: item.item_type.behavior for item in items}

    result: list[ItemRead] = []
    for document in documents:
        tree = _build_tree(by_document[document.id], ctx)
        assign_numbers(tree, behaviors)
        result.extend(_flatten_tree(tree))
    return result


def _assert_structure_free(db: Session, document: Document, user: User) -> None:
    """Structure edits take an implicit short lease on the document's
    structure lock; refused while someone else holds it."""
    try:
        locks.touch_structure(db, document.id, document.project_id, user)
    except locks.LockHeld as e:
        raise _lock_conflict(e)


@router.post("/documents/{document_id}/items", response_model=ItemRead, status_code=201)
def create_item(
    document_id: uuid.UUID,
    payload: ItemCreate,
    response: Response,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    user = _require_permission(db, document.project_id, user, "item.edit")

    item_type = db.get(ItemType, payload.item_type_id)
    if not item_type:
        raise HTTPException(404, "Item type not found")

    parent = db.get(Item, payload.parent_id) if payload.parent_id else None
    if payload.parent_id and not parent:
        raise HTTPException(404, "Parent item not found")

    try:
        validate_parent(parent.item_type.behavior if parent else None)
    except HierarchyError as e:
        raise HTTPException(422, str(e))

    attributes = dict(payload.attributes)
    definition = resolve_item_definition(db, document.project_id, item_type.id)
    if definition is not None:
        # A new item always starts in the workflow's initial state — the
        # state is only ever changed by transitions afterwards.
        attributes[STATUS_KEY] = initial_state({"states": definition.states})
    attributes = _default_required_enums(item_type.attributes, attributes)

    try:
        validate_attributes(item_type.attributes, attributes)
    except AttributeValidationError as e:
        raise HTTPException(422, str(e))

    try:
        locks.assert_no_explicit_structure_lock(db, document.id, user)
    except locks.LockHeld as e:
        raise _lock_conflict(e)

    if payload.order is None:
        max_order = (
            db.query(func.max(Item.order))
            .filter(Item.document_id == document_id, Item.parent_id == payload.parent_id)
            .scalar()
        )
        order = (max_order or 0) + 1
    else:
        order = payload.order

    item = Item(
        document_id=document_id,
        parent_id=payload.parent_id,
        item_type_id=payload.item_type_id,
        title=payload.title,
        description_md=payload.description_md,
        attributes=attributes,
        order=order,
        key=_next_key(db, document.project_id, item_type),
        updated_by=user.username,
    )
    db.add(item)
    record_version(db, item, changed_by=user, reason="create", initial=True)
    bump_structure(db, document_id)
    watch(db, user, "item", item.id)
    db.commit()
    db.refresh(item)
    sync_item(db, document.project, item)
    sync_parameter_links(db, document.project_id, item.id, item.description_md)
    set_item_etag(response, item)
    return to_item_read(item, db=db)


@router.get("/items/{item_id}", response_model=ItemRead)
def get_item(
    item_id: uuid.UUID,
    response: Response,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _require_content_read(db, item.document.project_id, user)
    set_item_etag(response, item)
    return to_item_read(item, db=db)


@router.patch("/items/{item_id}", response_model=ItemRead)
def update_item(
    item_id: uuid.UUID,
    payload: ItemUpdate,
    response: Response,
    if_match: str | None = Header(default=None),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Content fields (title/description/attributes) and structure fields
    (parent/order) are versioned and locked independently: a content edit
    needs `If-Match` with the item's ETag and must not collide with
    someone else's item lock; a move only needs the document's structure
    lock to be free and never conflicts with a concurrent text edit."""
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    project_id = item.document.project_id

    data = payload.model_dump(exclude_unset=True)
    data.pop("updated_by", None)
    content = {k: v for k, v in data.items() if k in CONTENT_FIELDS}
    structure = {k: v for k, v in data.items() if k in STRUCTURE_FIELDS}
    # Drop no-op content fields (e.g. a form that resends unchanged values)
    # so they don't create empty versions.
    content = {k: v for k, v in content.items() if getattr(item, k) != v}

    if content:
        user = _require_permission(db, project_id, user, "item.edit")
    if structure:
        user = _require_permission(db, project_id, user, "structure.edit")
    if not content and not structure:
        if user is None:
            raise HTTPException(403, "Requires the 'item.edit' permission on this project.")
        set_item_etag(response, item)
        return to_item_read(item, db=db)

    if content:
        require_item_version(db, item, if_match)
        try:
            locks.assert_can_write(db, "item", item.id, user)
        except locks.LockHeld as e:
            raise _lock_conflict(e)
        ctx = ReadContext(db, project_id, [item])
        reason = ctx.read_only_reason(item)
        if reason:
            raise HTTPException(409, {"code": "read_only", "message": reason})

    if "parent_id" in structure:
        new_parent = db.get(Item, structure["parent_id"]) if structure["parent_id"] else None
        if structure["parent_id"] and not new_parent:
            raise HTTPException(404, "Parent item not found")
        if structure["parent_id"] == item.id:
            raise HTTPException(422, "An item cannot be its own parent.")
        if new_parent and new_parent.document_id != item.document_id:
            raise HTTPException(422, "Items can only be moved within their own document.")
        try:
            validate_parent(new_parent.item_type.behavior if new_parent else None)
        except HierarchyError as e:
            raise HTTPException(422, str(e))

        walker = new_parent
        while walker is not None:
            if walker.id == item.id:
                raise HTTPException(
                    422, "Cannot move an item under one of its own descendants."
                )
            walker = walker.parent

    if "attributes" in content:
        try:
            validate_attributes(item.item_type.attributes, content["attributes"])
        except AttributeValidationError as e:
            raise HTTPException(422, str(e))
        old_status = (item.attributes or {}).get(STATUS_KEY)
        new_status = content["attributes"].get(STATUS_KEY, old_status)
        if new_status != old_status and resolve_item_definition(db, project_id, item.item_type_id):
            raise HTTPException(
                422,
                "Status is controlled by the workflow — use a workflow transition instead of editing it.",
            )

    if structure:
        _assert_structure_free(db, item.document, user)

    for field, value in {**content, **structure}.items():
        setattr(item, field, value)
    item.updated_by = user.username
    if content:
        record_version(db, item, changed_by=user, reason="edit")
    if structure:
        bump_structure(db, item.document_id)
    db.commit()
    db.refresh(item)
    sync_item(db, item.document.project, item)
    if "description_md" in content:
        sync_parameter_links(db, project_id, item.id, item.description_md)
    if content:
        from app.services.suggestion_hooks import on_item_content_changed

        on_item_content_changed(db, item, user)
    set_item_etag(response, item)
    return to_item_read(item, db=db)


def _content_descendants(item: Item) -> list[Item]:
    found: list[Item] = []
    stack = list(item.children)
    while stack:
        child = stack.pop()
        if child.item_type.behavior == "content":
            found.append(child)
        stack.extend(child.children)
    return found


def _deletable_content_item(db: Session, item: Item) -> str | None:
    """Content items are retired (Obsolete), not deleted — the one
    exception is a brand-new item nobody has touched yet (still version 1,
    no links, no comments, never left its initial state), which is just a
    mistake to undo, with no history or traceability worth keeping."""
    if item.version > 1:
        return "it has history"
    links = (
        db.query(Link)
        .filter((Link.source_item_id == item.id) | (Link.target_item_id == item.id))
        .count()
    )
    if links:
        return "it has traceability links"
    if db.query(ItemComment).filter(ItemComment.item_id == item.id).count():
        return "it has comments"
    return None


@router.delete("/items/{item_id}", status_code=204)
def delete_item(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    project_id = item.document.project_id
    user = _require_permission(db, project_id, user, "structure.edit")

    if item.item_type.behavior == "content":
        why = _deletable_content_item(db, item)
        if why:
            raise HTTPException(
                409,
                {
                    "code": "use_obsolete",
                    "message": f"{item.key or 'This item'} can't be deleted because {why} — "
                    "requirements are retired with the 'Make obsolete' workflow transition instead, "
                    "so history and traceability are kept.",
                },
            )
    else:
        content = _content_descendants(item)
        if content:
            raise HTTPException(
                409,
                {
                    "code": "section_not_empty",
                    "message": f"This section still contains {len(content)} item(s). Move them out or "
                    "make them obsolete and move them elsewhere first — items are never deleted together "
                    "with their section.",
                },
            )

    try:
        locks.assert_can_write(db, "item", item.id, user)
    except locks.LockHeld as e:
        raise _lock_conflict(e)
    _assert_structure_free(db, item.document, user)

    project, document_name = item.document.project, item.document.name
    item_key, item_id = item.key, item.id
    audit.log(
        db,
        action="item.delete",
        subject_type="item",
        subject_id=item_id,
        actor=user,
        project_id=project_id,
        summary=f"Deleted {item_key or item.title[:60]}",
        payload={"title": item.title, "key": item_key, "document": document_name},
    )
    bump_structure(db, item.document_id)
    db.delete(item)
    db.commit()
    # Note: cascading deletes of a Section's (empty) sub-sections only remove
    # this item's own file — orphaned child YAML files are a known gap in
    # this local-only sync, same class of limitation as the rest of §7.
    sync_item_delete(project, document_name, item_key, item_id)
