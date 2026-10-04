"""Status-approval workflow (§ user request, not in the original brief —
inspired by how DOORS/Polarion gate a requirement's status behind a
reviewer/approver sign-off).

Convention (kept deliberately simple rather than building a fully generic
workflow engine): the gated attribute is whichever `enum` attribute on an
item type is keyed exactly `"status"` — matching how every seeded content
type already defines one. An enum option flagged `requires_approval` can
only be reached via `approve_item`/`approve_document` in
app/api/v1/workflow.py, never a plain PATCH; an option flagged
`notify_reviewers` fires a "review requested" email on a normal transition
into it.
"""

import uuid

from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.user import User
from app.models.workflow import DocumentWorkflowRole
from sqlalchemy.orm import Session

STATUS_ATTRIBUTE_KEY = "status"
WORKFLOW_ROLES_ALL = ("reviewer", "approver")


class WorkflowError(ValueError):
    pass


def status_attribute(item_type: ItemType) -> ItemTypeAttribute | None:
    return next(
        (a for a in item_type.attributes if a.key == STATUS_ATTRIBUTE_KEY and a.data_type == "enum"),
        None,
    )


def _flagged_values(item_type: ItemType, flag: str) -> set[str]:
    attr = status_attribute(item_type)
    if not attr or not attr.enum_options:
        return set()
    return {o["value"] for o in attr.enum_options if o.get(flag)}


def gated_values(item_type: ItemType) -> set[str]:
    """Status values that require going through the approve endpoints."""
    return _flagged_values(item_type, "requires_approval")


def notify_values(item_type: ItemType) -> set[str]:
    """Status values whose plain-edit transition should email reviewers."""
    return _flagged_values(item_type, "notify_reviewers")


def assert_not_gated_transition(item_type: ItemType, old_attributes: dict, new_attributes: dict) -> None:
    """Raise if a plain PATCH is trying to move `status` into a value that
    requires going through the Approve action instead."""
    new_value = new_attributes.get(STATUS_ATTRIBUTE_KEY)
    if new_value is None:
        return
    old_value = old_attributes.get(STATUS_ATTRIBUTE_KEY)
    if new_value == old_value:
        return  # unchanged — just carried forward alongside some other edit
    if new_value in gated_values(item_type):
        attr = status_attribute(item_type)
        label = next(
            (o["label"] for o in (attr.enum_options or []) if o["value"] == new_value), new_value
        )
        raise WorkflowError(
            f"'{label}' requires approval — use the Approve action instead of editing Status directly."
        )


def label_for_value(item_type: ItemType, value: str) -> str:
    attr = status_attribute(item_type)
    if not attr or not attr.enum_options:
        return value
    return next((o["label"] for o in attr.enum_options if o["value"] == value), value)


def workflow_users(db: Session, document_id: uuid.UUID, roles: tuple[str, ...] = WORKFLOW_ROLES_ALL) -> list[User]:
    rows = (
        db.query(User)
        .join(DocumentWorkflowRole, DocumentWorkflowRole.user_id == User.id)
        .filter(DocumentWorkflowRole.document_id == document_id, DocumentWorkflowRole.role.in_(roles))
        .distinct()
        .all()
    )
    return rows


def is_approver(db: Session, document_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return (
        db.query(DocumentWorkflowRole)
        .filter(
            DocumentWorkflowRole.document_id == document_id,
            DocumentWorkflowRole.user_id == user_id,
            DocumentWorkflowRole.role == "approver",
        )
        .first()
        is not None
    )
