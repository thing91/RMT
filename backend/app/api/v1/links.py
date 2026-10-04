import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_project_read
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.link import Link, LinkType
from app.models.project import Project
from app.models.user import User
from app.schemas.link import LinkCreate, LinkRead
from app.services.link_validation import LinkValidationError, validate_link_types
from app.services.permissions import can_read, has_role_at_least

router = APIRouter(tags=["links"])


@router.get("/projects/{project_id}/links", response_model=list[LinkRead])
def list_project_links(project: Project = Depends(require_project_read), db: Session = Depends(get_db)):
    """Bulk fetch for the Table View's Links column (ReqView shows this per
    row rather than requiring a click into each item) — one query instead
    of one `/items/{id}/links` call per row."""
    item_ids = (
        db.query(Item.id)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project.id)
        .subquery()
    )
    return (
        db.query(Link)
        .filter(or_(Link.source_item_id.in_(item_ids), Link.target_item_id.in_(item_ids)))
        .all()
    )


@router.post("/links", response_model=LinkRead, status_code=201)
def create_link(
    payload: LinkCreate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    link_type = db.get(LinkType, payload.link_type_id)
    if not link_type:
        raise HTTPException(404, "Link type not found")

    source = db.get(Item, payload.source_item_id)
    target = db.get(Item, payload.target_item_id)
    if not source or not target:
        raise HTTPException(404, "Source or target item not found")
    if source.id == target.id:
        raise HTTPException(422, "An item cannot link to itself.")

    duplicate = (
        db.query(Link)
        .filter(
            Link.source_item_id == payload.source_item_id,
            Link.target_item_id == payload.target_item_id,
            Link.link_type_id == payload.link_type_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(409, f"A '{link_type.name}' link between these two items already exists.")

    # A link spans two items that must each already be readable to this
    # caller; editor role is required on both projects when they differ.
    for item in (source, target):
        project_id = item.document.project_id
        if user is None or not has_role_at_least(db, project_id, user.id, "editor"):
            raise HTTPException(403, "Requires at least 'editor' role on this project.")

    def type_names(ids: list) -> list[str]:
        if not ids:
            return []
        uuids = [uuid.UUID(str(x)) for x in ids]
        types = db.query(ItemType).filter(ItemType.id.in_(uuids)).all()
        return [t.name for t in types]

    try:
        validate_link_types(
            link_type,
            source.item_type,
            target.item_type,
            type_names(link_type.allowed_source_types),
            type_names(link_type.allowed_target_types),
        )
    except LinkValidationError as e:
        raise HTTPException(422, str(e))

    link = Link(
        source_item_id=payload.source_item_id,
        target_item_id=payload.target_item_id,
        link_type_id=payload.link_type_id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.get("/items/{item_id}/links", response_model=list[LinkRead])
def get_item_links(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if not can_read(db, item.document.project, user.id if user else None):
        raise HTTPException(404, "Item not found")
    return (
        db.query(Link)
        .filter(or_(Link.source_item_id == item_id, Link.target_item_id == item_id))
        .all()
    )


@router.delete("/links/{link_id}", status_code=204)
def delete_link(
    link_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    link = db.get(Link, link_id)
    if not link:
        raise HTTPException(404, "Link not found")
    project_id = link.source_item.document.project_id
    if user is None or not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    db.delete(link)
    db.commit()
