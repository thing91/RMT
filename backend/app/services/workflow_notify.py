"""Wires the pure workflow logic (app/services/workflow.py) to outgoing
email (app/services/email.py) — kept separate so workflow.py stays a plain
function library without DB-session/email side effects baked in."""

import uuid

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.user import User
from app.services import email as mail
from app.services.workflow import (
    WORKFLOW_ROLES_ALL,
    label_for_value,
    notify_values,
    workflow_users,
)


def notify_review_requested(db: Session, item: Item, new_status_value: str, changed_by: str) -> None:
    if new_status_value not in notify_values(item.item_type):
        return
    recipients = workflow_users(db, item.document_id, WORKFLOW_ROLES_ALL)
    emails = [u.email for u in recipients if u.email]
    if not emails:
        return
    label = label_for_value(item.item_type, new_status_value)
    html = mail.render_review_requested_email(
        item_key=item.key or str(item.id)[:8],
        item_title=item.title,
        project_name=item.document.project.name,
        document_name=item.document.name,
        status_label=label,
        changed_by=changed_by,
        url=mail.item_url(item.document.project_id, item.document_id, item.id),
    )
    mail.send_email(emails, f"[RMT] Review requested: {item.key or item.title}", html)


def notify_item_approved(
    db: Session, item: Item, status_value: str, approved_by_name: str, note: str | None
) -> None:
    label = label_for_value(item.item_type, status_value)
    recipients = set(u.email for u in workflow_users(db, item.document_id, WORKFLOW_ROLES_ALL) if u.email)
    if item.updated_by:
        editor = db.query(User).filter(User.username == item.updated_by).first()
        if editor and editor.email:
            recipients.add(editor.email)
    html = mail.render_item_approved_email(
        item_key=item.key or str(item.id)[:8],
        item_title=item.title,
        project_name=item.document.project.name,
        document_name=item.document.name,
        status_label=label,
        approved_by=approved_by_name,
        note=note,
        url=mail.item_url(item.document.project_id, item.document_id, item.id),
    )
    if recipients:
        mail.send_email(list(recipients), f"[RMT] {item.key or item.title} approved", html)


def notify_document_approved(
    db: Session,
    document,
    status_value: str,
    approved_by_name: str,
    approved_count: int,
    note: str | None,
    sample_item_type,
) -> None:
    if approved_count == 0:
        return
    label = label_for_value(sample_item_type, status_value) if sample_item_type else status_value
    recipients = set(u.email for u in workflow_users(db, document.id, WORKFLOW_ROLES_ALL) if u.email)
    if not recipients:
        return
    html = mail.render_document_approved_email(
        document_name=document.name,
        project_name=document.project.name,
        status_label=label,
        approved_by=approved_by_name,
        approved_count=approved_count,
        note=note,
        url=mail.document_url(document.project_id, document.id),
    )
    mail.send_email(list(recipients), f"[RMT] {document.name} approved", html)
