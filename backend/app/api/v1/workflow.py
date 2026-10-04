import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_user
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.user import User
from app.models.workflow import WORKFLOW_ROLES, DocumentWorkflowRole
from app.schemas.item import ItemRead
from app.schemas.workflow import (
    ApproveRequest,
    DocumentApproveResult,
    WorkflowRoleCreate,
    WorkflowRoleRead,
)
from app.services.git_sync import sync_item
from app.services.permissions import has_role_at_least
from app.services.workflow import gated_values, is_approver, status_attribute
from app.services.workflow_notify import notify_document_approved, notify_item_approved

router = APIRouter(tags=["workflow"])


def _document_or_404(db: Session, document_id: uuid.UUID) -> Document:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    return document


def _require_editor(db: Session, project_id: uuid.UUID, user: User) -> None:
    if not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")


def _require_approver(db: Session, document: Document, user: User) -> None:
    """An assigned approver for this document, or a project admin as a
    fallback so nobody is ever locked out before assignments exist."""
    if is_approver(db, document.id, user.id):
        return
    if has_role_at_least(db, document.project_id, user.id, "admin"):
        return
    raise HTTPException(
        403, "Only an approver assigned to this document (or a project admin) can approve it."
    )


def _to_role_read(role: DocumentWorkflowRole) -> WorkflowRoleRead:
    return WorkflowRoleRead(
        id=role.id,
        document_id=role.document_id,
        user_id=role.user_id,
        role=role.role,
        username=role.user.username,
        display_name=role.user.display_name,
    )


@router.get("/documents/{document_id}/workflow-roles", response_model=list[WorkflowRoleRead])
def list_workflow_roles(document_id: uuid.UUID, db: Session = Depends(get_db)):
    _document_or_404(db, document_id)
    roles = (
        db.query(DocumentWorkflowRole).filter(DocumentWorkflowRole.document_id == document_id).all()
    )
    return [_to_role_read(r) for r in roles]


@router.post(
    "/documents/{document_id}/workflow-roles", response_model=WorkflowRoleRead, status_code=201
)
def assign_workflow_role(
    document_id: uuid.UUID,
    payload: WorkflowRoleCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    document = _document_or_404(db, document_id)
    _require_editor(db, document.project_id, user)

    if payload.role not in WORKFLOW_ROLES:
        raise HTTPException(422, f"role must be one of {WORKFLOW_ROLES}")
    target_user = db.get(User, payload.user_id)
    if not target_user:
        raise HTTPException(404, "User not found")

    existing = (
        db.query(DocumentWorkflowRole)
        .filter(
            DocumentWorkflowRole.document_id == document_id,
            DocumentWorkflowRole.user_id == payload.user_id,
            DocumentWorkflowRole.role == payload.role,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, f"{target_user.display_name} is already a {payload.role} on this document.")

    role = DocumentWorkflowRole(document_id=document_id, user_id=payload.user_id, role=payload.role)
    db.add(role)
    db.commit()
    db.refresh(role)
    return _to_role_read(role)


@router.delete("/workflow-roles/{role_id}", status_code=204)
def revoke_workflow_role(
    role_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    role = db.get(DocumentWorkflowRole, role_id)
    if not role:
        raise HTTPException(404, "Assignment not found")
    _require_editor(db, role.document.project_id, user)
    db.delete(role)
    db.commit()


@router.post("/items/{item_id}/approve", response_model=ItemRead)
def approve_item(
    item_id: uuid.UUID,
    payload: ApproveRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _require_approver(db, item.document, user)

    attr = status_attribute(item.item_type)
    if not attr:
        raise HTTPException(422, "This item type has no status workflow attribute.")
    valid_values = {o["value"] for o in (attr.enum_options or [])}
    if payload.status_value not in valid_values:
        raise HTTPException(422, f"'{payload.status_value}' is not a valid status for this item type.")
    if payload.status_value not in gated_values(item.item_type):
        raise HTTPException(
            422,
            f"'{payload.status_value}' doesn't require approval — edit the Status attribute directly.",
        )

    now = datetime.now(timezone.utc)
    item.attributes = {**item.attributes, "status": payload.status_value}
    item.approved_by_id = user.id
    item.approved_at = now
    item.updated_by = user.username
    # `updated_at`'s own onupdate default would otherwise be evaluated a
    # few microseconds after `now` above (a separate call to the same
    # clock, at flush time) — always just barely later, which made every
    # freshly-approved item register as "stale" the moment you looked at
    # it again. Setting it explicitly to the same instant as approved_at
    # makes "stale" mean what it's supposed to: edited *after* approval.
    item.updated_at = now
    db.commit()
    db.refresh(item)
    sync_item(db, item.document.project, item)
    notify_item_approved(db, item, payload.status_value, user.display_name, payload.note)
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
        approved_by=item.approved_by.display_name if item.approved_by else None,
        approved_at=item.approved_at,
        approval_stale=False,
    )


@router.post("/documents/{document_id}/approve", response_model=DocumentApproveResult)
def approve_document(
    document_id: uuid.UUID,
    payload: ApproveRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    document = _document_or_404(db, document_id)
    _require_approver(db, document, user)

    items = (
        db.query(Item)
        .join(ItemType, Item.item_type_id == ItemType.id)
        .filter(Item.document_id == document_id, ItemType.behavior == "content")
        .all()
    )

    now = datetime.now(timezone.utc)
    approved_items: list[Item] = []
    skipped = 0
    sample_type = None
    for item in items:
        attr = status_attribute(item.item_type)
        if not attr:
            skipped += 1
            continue
        valid_values = {o["value"] for o in (attr.enum_options or [])}
        if payload.status_value not in valid_values or payload.status_value not in gated_values(
            item.item_type
        ):
            skipped += 1
            continue
        item.attributes = {**item.attributes, "status": payload.status_value}
        item.approved_by_id = user.id
        item.approved_at = now
        item.updated_by = user.username
        item.updated_at = now  # see approve_item's comment on why this matters
        sample_type = item.item_type
        approved_items.append(item)

    db.commit()
    for item in approved_items:
        sync_item(db, document.project, item)
    approved = len(approved_items)

    notify_document_approved(
        db, document, payload.status_value, user.display_name, approved, payload.note, sample_type
    )
    return DocumentApproveResult(approved_count=approved, skipped_count=skipped)
