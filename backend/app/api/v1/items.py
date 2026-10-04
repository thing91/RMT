import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.project import Project
from app.models.user import User
from app.schemas.item import ItemCreate, ItemRead, ItemUpdate
from app.services.attribute_validation import AttributeValidationError, validate_attributes
from app.services.git_sync import sync_item, sync_item_delete
from app.services.hierarchy import HierarchyError, validate_parent
from app.services.numbering import assign_numbers
from app.services.parameters import sync_parameter_links
from app.services.permissions import can_read, has_role_at_least
from app.services.workflow import WorkflowError, assert_not_gated_transition
from app.services.workflow_notify import notify_review_requested

router = APIRouter(tags=["items"])


def _project_id_for_document(db: Session, document_id: uuid.UUID) -> uuid.UUID | None:
    return (
        db.query(Document.project_id).filter(Document.id == document_id).scalar()
    )


def _require_content_read(db: Session, project_id: uuid.UUID, user: User | None) -> None:
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")


def _require_editor(db: Session, project_id: uuid.UUID, user: User | None) -> None:
    if user is None or not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")


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


def _to_item_read(item: Item) -> ItemRead:
    # Built field-by-field rather than ItemRead.model_validate(item): the ORM
    # `Item.children` relationship would otherwise satisfy the schema's own
    # `children` field by lazy-loading and recursively validating real child
    # rows, which then collide with the flat-list tree we build ourselves.
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
    )


def _build_tree(items: list[Item]) -> list[ItemRead]:
    by_id: dict[uuid.UUID, ItemRead] = {item.id: _to_item_read(item) for item in items}
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
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project_id = _project_id_for_document(db, document_id)
    if project_id is None:
        raise HTTPException(404, "Document not found")
    _require_content_read(db, project_id, user)

    items = db.query(Item).filter(Item.document_id == document_id).all()
    tree = _build_tree(items)
    behaviors = _behaviors_for_document(db, document_id)
    assign_numbers(tree, behaviors)
    return tree


@router.get("/projects/{project_id}/items", response_model=list[ItemRead])
def list_project_items(
    project_id: uuid.UUID,
    item_type_id: uuid.UUID | None = None,
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
    items = query.all()

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
        tree = _build_tree(by_document[document.id])
        assign_numbers(tree, behaviors)
        result.extend(_flatten_tree(tree))
    return result


@router.post("/documents/{document_id}/items", response_model=ItemRead, status_code=201)
def create_item(
    document_id: uuid.UUID,
    payload: ItemCreate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    _require_editor(db, document.project_id, user)

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

    attributes = _default_required_enums(item_type.attributes, payload.attributes)

    try:
        validate_attributes(item_type.attributes, attributes)
    except AttributeValidationError as e:
        raise HTTPException(422, str(e))

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
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    sync_item(db, document.project, item)
    sync_parameter_links(db, document.project_id, item.id, item.description_md)
    return _to_item_read(item)


@router.get("/items/{item_id}", response_model=ItemRead)
def get_item(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _require_content_read(db, item.document.project_id, user)
    return _to_item_read(item)


@router.patch("/items/{item_id}", response_model=ItemRead)
def update_item(
    item_id: uuid.UUID,
    payload: ItemUpdate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _require_editor(db, item.document.project_id, user)

    data = payload.model_dump(exclude_unset=True)

    if "parent_id" in data:
        new_parent = db.get(Item, data["parent_id"]) if data["parent_id"] else None
        if data["parent_id"] and not new_parent:
            raise HTTPException(404, "Parent item not found")
        if data["parent_id"] == item.id:
            raise HTTPException(422, "An item cannot be its own parent.")
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

    if "attributes" in data:
        try:
            validate_attributes(item.item_type.attributes, data["attributes"])
        except AttributeValidationError as e:
            raise HTTPException(422, str(e))
        try:
            assert_not_gated_transition(item.item_type, item.attributes, data["attributes"])
        except WorkflowError as e:
            raise HTTPException(422, str(e))

    new_status = data.get("attributes", {}).get("status")

    for field, value in data.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    sync_item(db, item.document.project, item)
    if "description_md" in data:
        sync_parameter_links(db, item.document.project_id, item.id, item.description_md)
    if new_status:
        notify_review_requested(db, item, new_status, user.username if user else "someone")
    return _to_item_read(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _require_editor(db, item.document.project_id, user)
    project, document_name = item.document.project, item.document.name
    item_key, item_id = item.key, item.id
    db.delete(item)
    db.commit()
    # Note: cascading deletes of a Section's descendants (§4.3) only remove
    # this item's own file — orphaned child YAML files are a known gap in
    # this local-only sync, same class of limitation as the rest of §7.
    sync_item_delete(project, document_name, item_key, item_id)
