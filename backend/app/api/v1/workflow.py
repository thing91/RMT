"""Workflow API: document review/approval role assignments, configurable
workflow definitions, running transitions (on items and on any other
workflow subject), change requests, suspect links and e-signatures."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.api.v1.items import ReadContext, to_item_read
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.link import Link
from app.models.project import Project
from app.models.user import User
from app.models.workflow import WORKFLOW_ROLES, DocumentWorkflowRole
from app.models.workflow_def import ChangeRequest, ElectronicSignature, WorkflowDefinition
from app.schemas.item import ItemRead
from app.schemas.workflow import (
    BulkTransitionRequest,
    BulkTransitionResult,
    BulkTransitionSkip,
    ChangeRequestRead,
    HistoryEntryRead,
    SignatureRead,
    SubjectWorkflowRead,
    SuspectLinkRead,
    TransitionRequest,
    WorkflowDefinitionRead,
    WorkflowRoleCreate,
    WorkflowRoleRead,
    WorkflowSpecIn,
    WorkflowTemplateRead,
)
from app.services import audit
from app.services import workflow_engine as wf
from app.services.concurrency import require_item_version, set_item_etag
from app.services.git_sync import sync_item
from app.services.permissions import can_read, has_permission, has_role_at_least
from app.services.workflow_templates import ITEM_TEMPLATES

router = APIRouter(tags=["workflow"])


def _document_or_404(db: Session, document_id: uuid.UUID) -> Document:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    return document


def _require_editor(db: Session, project_id: uuid.UUID, user: User) -> None:
    if not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")


def _workflow_http_error(e: wf.WorkflowError) -> HTTPException:
    return HTTPException(e.status_code, {"code": "workflow", "message": e.message, "reasons": e.reasons})


# ---- document review/approval roles --------------------------------------


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
    audit.log(
        db,
        action="workflow.role_assigned",
        subject_type="document",
        subject_id=document_id,
        actor=user,
        project_id=document.project_id,
        summary=f"{target_user.display_name} assigned as {payload.role} on {document.name}",
    )
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
    audit.log(
        db,
        action="workflow.role_revoked",
        subject_type="document",
        subject_id=role.document_id,
        actor=user,
        project_id=role.document.project_id,
        summary=f"{role.user.display_name} removed as {role.role} on {role.document.name}",
    )
    db.delete(role)
    db.commit()


# ---- workflow definitions ---------------------------------------------------


def _def_read(d: WorkflowDefinition) -> WorkflowDefinitionRead:
    return WorkflowDefinitionRead(
        id=d.id,
        org_id=d.org_id,
        project_id=d.project_id,
        item_type_id=d.item_type_id,
        item_type_name=d.item_type.name,
        name=d.name,
        variant=d.variant,
        states=d.states,
        transitions=d.transitions,
        settings=d.settings or {},
        is_override=d.project_id is not None,
        updated_at=d.updated_at,
    )


@router.get("/workflow-templates", response_model=list[WorkflowTemplateRead])
def list_templates():
    return [
        WorkflowTemplateRead(
            key=k, name=t["name"], variant=t["variant"], states=t["states"], transitions=t["transitions"]
        )
        for k, t in ITEM_TEMPLATES.items()
    ]


@router.get("/workflow-catalog")
def workflow_catalog():
    """What the workflow editor can offer: condition/action types and role
    tokens."""
    return {
        "conditions": sorted(wf.CONDITIONS),
        "actions": sorted(wf.ACTIONS),
        "role_tokens": [
            "role:viewer", "role:reviewer", "role:editor", "role:admin",
            "doc:reviewer", "doc:approver", "author", "owner", "any",
        ],
        "notify_targets": ["watchers", "author", "owner", "doc_reviewers", "doc_approvers", "permission:<name>"],
    }


@router.get("/organizations/{org_id}/workflows", response_model=list[WorkflowDefinitionRead])
def list_org_workflows(org_id: uuid.UUID, db: Session = Depends(get_db)):
    defs = (
        db.query(WorkflowDefinition)
        .filter(WorkflowDefinition.org_id == org_id, WorkflowDefinition.project_id.is_(None))
        .all()
    )
    return [_def_read(d) for d in defs]


@router.get("/projects/{project_id}/workflows", response_model=list[WorkflowDefinitionRead])
def list_project_workflows(
    project_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Effective workflow per item type for this project (override if any,
    else the org default)."""
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    result = []
    for item_type in db.query(ItemType).filter(ItemType.org_id == project.org_id).all():
        d = wf.resolve_item_definition(db, project_id, item_type.id)
        if d:
            result.append(_def_read(d))
    return result


def _spec_from_payload(payload: WorkflowSpecIn) -> dict:
    if payload.template:
        template = ITEM_TEMPLATES.get(payload.template)
        if template is None:
            raise HTTPException(422, f"Unknown template '{payload.template}'.")
        spec = {**template}
        if payload.name:
            spec["name"] = payload.name
        spec["settings"] = payload.settings or template.get("settings", {})
        return spec
    if payload.states is None or payload.transitions is None:
        raise HTTPException(422, "Provide either 'template' or both 'states' and 'transitions'.")
    spec = {
        "name": payload.name or "Custom workflow",
        "variant": "custom",
        "states": [s.model_dump() for s in payload.states],
        "transitions": [t.model_dump(by_alias=True) for t in payload.transitions],
        "settings": payload.settings,
    }
    for t in spec["transitions"]:
        t["conditions"] = [c for c in t["conditions"]]
        t["actions"] = [a for a in t["actions"]]
    errors = wf.validate_spec(spec)
    if errors:
        raise HTTPException(422, {"code": "invalid_workflow", "message": "Invalid workflow.", "reasons": errors})
    return spec


def _check_states_still_valid(db: Session, item_type_id: uuid.UUID, project_id: uuid.UUID | None, spec: dict):
    """Refuse a definition that would strand existing items in a state that
    no longer exists."""
    keys = {s["key"] for s in spec["states"]}
    q = db.query(Item).join(Document, Item.document_id == Document.id).filter(Item.item_type_id == item_type_id)
    if project_id:
        q = q.filter(Document.project_id == project_id)
    used = {(i.attributes or {}).get(wf.STATUS_KEY) for i in q.all()} - {None}
    missing = used - keys
    if missing:
        raise HTTPException(
            422,
            {
                "code": "states_in_use",
                "message": "Existing items are in states this workflow removes: " + ", ".join(sorted(missing)),
                "reasons": sorted(missing),
            },
        )


@router.put("/item-types/{item_type_id}/workflow", response_model=WorkflowDefinitionRead)
def put_org_workflow(
    item_type_id: uuid.UUID,
    payload: WorkflowSpecIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item_type = db.get(ItemType, item_type_id)
    if not item_type:
        raise HTTPException(404, "Item type not found")
    if not wf.can_configure(db, user, None) or user.org_id != item_type.org_id:
        raise HTTPException(403, "Only an organization admin can change org-wide workflows.")
    if item_type.behavior != "content":
        raise HTTPException(422, "Only content item types have a workflow.")
    spec = _spec_from_payload(payload)
    _check_states_still_valid(db, item_type_id, None, spec)
    d = wf.apply_template(db, org_id=item_type.org_id, item_type_id=item_type_id, template=spec)
    audit.log(
        db,
        action="workflow.configured",
        subject_type="item_type",
        subject_id=item_type_id,
        actor=user,
        org_id=item_type.org_id,
        summary=f"Org workflow for {item_type.name} set to '{d.name}'",
    )
    db.commit()
    db.refresh(d)
    return _def_read(d)


@router.put(
    "/projects/{project_id}/item-types/{item_type_id}/workflow", response_model=WorkflowDefinitionRead
)
def put_project_workflow(
    project_id: uuid.UUID,
    item_type_id: uuid.UUID,
    payload: WorkflowSpecIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    item_type = db.get(ItemType, item_type_id)
    if not project or not item_type:
        raise HTTPException(404, "Not found")
    if not wf.can_configure(db, user, project_id):
        raise HTTPException(403, "Requires the 'workflow.configure' permission on this project.")
    if item_type.behavior != "content":
        raise HTTPException(422, "Only content item types have a workflow.")
    spec = _spec_from_payload(payload)
    _check_states_still_valid(db, item_type_id, project_id, spec)
    d = wf.apply_template(
        db, org_id=project.org_id, item_type_id=item_type_id, template=spec, project_id=project_id
    )
    audit.log(
        db,
        action="workflow.configured",
        subject_type="item_type",
        subject_id=item_type_id,
        actor=user,
        project_id=project_id,
        summary=f"Project workflow for {item_type.name} overridden with '{d.name}'",
    )
    db.commit()
    db.refresh(d)
    return _def_read(d)


@router.delete("/projects/{project_id}/item-types/{item_type_id}/workflow", status_code=204)
def delete_project_workflow(
    project_id: uuid.UUID,
    item_type_id: uuid.UUID,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if not wf.can_configure(db, user, project_id):
        raise HTTPException(403, "Requires the 'workflow.configure' permission on this project.")
    d = db.query(WorkflowDefinition).filter_by(project_id=project_id, item_type_id=item_type_id).first()
    if not d:
        raise HTTPException(404, "This project has no override for that item type.")
    org_def = (
        db.query(WorkflowDefinition)
        .filter(WorkflowDefinition.item_type_id == item_type_id, WorkflowDefinition.project_id.is_(None))
        .first()
    )
    if org_def:
        _check_states_still_valid(db, item_type_id, project_id, {"states": org_def.states})
    db.delete(d)
    audit.log(
        db,
        action="workflow.override_removed",
        subject_type="item_type",
        subject_id=item_type_id,
        actor=user,
        project_id=project_id,
        summary="Project workflow override removed — back to the org workflow",
    )
    db.flush()
    wf.sync_status_enum(db, item_type_id)
    db.commit()


# ---- running transitions ----------------------------------------------------


def _load_subject(db: Session, kind: str, subject_id: uuid.UUID) -> wf.Subject:
    loader = wf.SUBJECT_LOADERS.get(kind)
    subject = loader(db, subject_id) if loader else None
    if subject is None:
        raise HTTPException(404, "Not found")
    return subject


def _require_subject_read(db: Session, subject: wf.Subject, user: User | None) -> None:
    pid = subject.project_id
    if pid:
        project = db.get(Project, pid)
        if not project or not can_read(db, project, user.id if user else None):
            raise HTTPException(404, "Not found")
    elif hasattr(subject, "can_read") and not subject.can_read(user):
        raise HTTPException(404, "Not found")


def _history(db: Session, kind: str, subject_id: uuid.UUID) -> list[HistoryEntryRead]:
    out = []
    for e in wf.history(db, kind, subject_id):
        p = e.payload or {}
        out.append(
            HistoryEntryRead(
                id=e.id,
                at=e.created_at,
                actor=e.actor.display_name if e.actor else "System",
                transition=p.get("transition"),
                transition_label=p.get("transition_label"),
                from_state=p.get("from"),
                from_label=p.get("from_label"),
                to_state=p.get("to"),
                to_label=p.get("to_label"),
                comment=p.get("comment"),
                notes=p.get("notes") or {},
                version=p.get("version"),
            )
        )
    return out


def subject_workflow_read(db: Session, subject: wf.Subject, user: User | None) -> SubjectWorkflowRead:
    spec = subject.workflow()
    current = subject.get_state()
    read_only = None
    if isinstance(subject, wf.ItemSubject):
        read_only = ReadContext(db, subject.project_id, [subject.item]).read_only_reason(subject.item)
    return SubjectWorkflowRead(
        state=current,
        state_label=wf.state_label(spec, current),
        states=spec["states"],
        transitions=[o.as_dict() for o in wf.available_transitions(db, subject, user)],
        history=_history(db, subject.kind, subject.id),
        read_only_reason=read_only,
    )


@router.get("/workflow/{kind}/{subject_id}", response_model=SubjectWorkflowRead)
def get_subject_workflow(
    kind: str,
    subject_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subject = _load_subject(db, kind, subject_id)
    _require_subject_read(db, subject, user)
    try:
        return subject_workflow_read(db, subject, user)
    except wf.WorkflowError as e:
        raise _workflow_http_error(e)


def _after_item_transition(db: Session, item: Item) -> None:
    sync_item(db, item.document.project, item)


@router.post("/workflow/{kind}/{subject_id}/transitions/{transition_key}", response_model=SubjectWorkflowRead)
def run_subject_transition(
    kind: str,
    subject_id: uuid.UUID,
    transition_key: str,
    payload: TransitionRequest,
    if_match: str | None = Header(default=None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    subject = _load_subject(db, kind, subject_id)
    _require_subject_read(db, subject, user)
    if isinstance(subject, wf.ItemSubject):
        require_item_version(db, subject.item, if_match)
    try:
        wf.execute(
            db, subject, transition_key, user, comment=payload.comment,
            payload={**payload.payload, "password": payload.password},
        )
    except wf.WorkflowError as e:
        db.rollback()
        raise _workflow_http_error(e)
    db.commit()
    if isinstance(subject, wf.ItemSubject):
        _after_item_transition(db, subject.item)
    subject = _load_subject(db, kind, subject_id)
    return subject_workflow_read(db, subject, user)


@router.post("/items/{item_id}/transitions/{transition_key}", response_model=ItemRead)
def run_item_transition(
    item_id: uuid.UUID,
    transition_key: str,
    payload: TransitionRequest,
    response: Response,
    if_match: str | None = Header(default=None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    subject = wf.ItemSubject(db, item)
    _require_subject_read(db, subject, user)
    require_item_version(db, item, if_match)
    try:
        wf.execute(
            db, subject, transition_key, user, comment=payload.comment,
            payload={**payload.payload, "password": payload.password},
        )
    except wf.WorkflowError as e:
        db.rollback()
        raise _workflow_http_error(e)
    db.commit()
    db.refresh(item)
    _after_item_transition(db, item)
    set_item_etag(response, item)
    return to_item_read(item, db=db)


@router.post("/documents/{document_id}/transitions/{transition_key}", response_model=BulkTransitionResult)
def run_document_transition(
    document_id: uuid.UUID,
    transition_key: str,
    payload: BulkTransitionRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Run one transition on every eligible content item in a document (or
    the given subset) — e.g. approve a whole reviewed document at once.
    Each item is checked individually; refusals are reported, not fatal."""
    document = _document_or_404(db, document_id)
    if not can_read(db, document.project, user.id):
        raise HTTPException(404, "Document not found")
    q = db.query(Item).filter(Item.document_id == document_id, Item.obsolete_at.is_(None))
    if payload.item_ids:
        q = q.filter(Item.id.in_(payload.item_ids))
    items = sorted(q.all(), key=lambda i: (i.key or "", i.order))
    applied: list[str] = []
    skipped: list[BulkTransitionSkip] = []
    signature_checked = False
    for item in items:
        if item.item_type.behavior != "content":
            continue
        subject = wf.ItemSubject(db, item)
        if subject.definition() is None:
            continue
        spec = subject.workflow()
        t = wf.transition(spec, transition_key)
        if t is None or subject.get_state() not in t["from"]:
            if payload.item_ids:
                skipped.append(BulkTransitionSkip(item_id=item.id, key=item.key, reason="Not available in this state."))
            continue
        try:
            with db.begin_nested():
                wf.execute(
                    db, subject, transition_key, user, comment=payload.comment,
                    payload={**payload.payload, "password": payload.password},
                )
            applied.append(item.key or str(item.id))
            signature_checked = True
        except wf.WorkflowError as e:
            reason = "; ".join(e.reasons) if e.reasons and e.reasons[0] not in (
                "signature_required", "signature_failed", "comment_required", "wrong_state"
            ) else e.message
            skipped.append(BulkTransitionSkip(item_id=item.id, key=item.key, reason=reason))
            if not signature_checked and e.reasons and e.reasons[0] in ("signature_required", "signature_failed"):
                # Wrong/missing password fails every item identically — stop early.
                db.rollback()
                raise _workflow_http_error(e)
    db.commit()
    for item in items:
        if (item.key or str(item.id)) in applied:
            _after_item_transition(db, item)
    return BulkTransitionResult(applied=applied, skipped=skipped)


# ---- change requests, suspect links, signatures ------------------------------


def _cr_read(cr: ChangeRequest) -> ChangeRequestRead:
    return ChangeRequestRead(
        id=cr.id,
        key=cr.key,
        project_id=cr.project_id,
        item_id=cr.item_id,
        item_key=cr.item.key,
        item_title=cr.item.title,
        base_version=cr.base_version,
        implemented_version=cr.implemented_version,
        status=cr.status,
        reason=cr.reason,
        impact=cr.impact,
        requested_by=cr.requested_by.display_name if cr.requested_by else None,
        decided_by=cr.decided_by.display_name if cr.decided_by else None,
        decided_at=cr.decided_at,
        created_at=cr.created_at,
    )


@router.get("/projects/{project_id}/change-requests", response_model=list[ChangeRequestRead])
def list_change_requests(
    project_id: uuid.UUID,
    status: str | None = None,
    item_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    q = db.query(ChangeRequest).filter(ChangeRequest.project_id == project_id)
    if status:
        q = q.filter(ChangeRequest.status == status)
    if item_id:
        q = q.filter(ChangeRequest.item_id == item_id)
    return [_cr_read(cr) for cr in q.order_by(ChangeRequest.created_at.desc()).all()]


def _suspect_read(link: Link) -> SuspectLinkRead:
    return SuspectLinkRead(
        id=link.id,
        link_type=link.link_type.name,
        source_item_id=link.source_item_id,
        source_key=link.source_item.key,
        source_title=link.source_item.title,
        target_item_id=link.target_item_id,
        target_key=link.target_item.key,
        target_title=link.target_item.title,
        changed_item_id=link.suspect_item_id,
        reason=link.suspect_reason,
        since=link.suspect_since,
    )


@router.get("/projects/{project_id}/suspect-links", response_model=list[SuspectLinkRead])
def list_suspect_links(
    project_id: uuid.UUID,
    item_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    q = (
        db.query(Link)
        .join(Item, Link.source_item_id == Item.id)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project_id, Link.suspect.is_(True))
    )
    if item_id:
        q = q.filter((Link.source_item_id == item_id) | (Link.target_item_id == item_id))
    return [_suspect_read(link) for link in q.order_by(Link.suspect_since.desc()).all()]


@router.post("/links/{link_id}/clear-suspect", response_model=SuspectLinkRead)
def clear_suspect(
    link_id: uuid.UUID,
    payload: TransitionRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    link = db.get(Link, link_id)
    if not link:
        raise HTTPException(404, "Link not found")
    project_id = link.source_item.document.project_id
    if not has_permission(db, project_id, user, "item.edit"):
        raise HTTPException(403, "Requires the 'item.edit' permission on this project.")
    if not link.suspect:
        raise HTTPException(409, "This link isn't suspect.")
    audit.log(
        db,
        action="link.suspect_cleared",
        subject_type="link",
        subject_id=link.id,
        actor=user,
        project_id=project_id,
        summary=(
            f"Suspect cleared on {link.source_item.key or link.source_item.title[:30]} → "
            f"{link.target_item.key or link.target_item.title[:30]}"
        ),
        payload={"reason": link.suspect_reason, "comment": payload.comment},
    )
    link.suspect = False
    link.suspect_reason = None
    link.suspect_since = None
    link.suspect_item_id = None
    db.commit()
    db.refresh(link)
    return _suspect_read(link)


@router.get("/items/{item_id}/signatures", response_model=list[SignatureRead])
def list_signatures(
    item_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if not item or not can_read(db, item.document.project, user.id if user else None):
        raise HTTPException(404, "Item not found")
    rows = (
        db.query(ElectronicSignature)
        .filter_by(subject_type="item", subject_id=item_id)
        .order_by(ElectronicSignature.signed_at)
        .all()
    )
    return [
        SignatureRead(
            id=s.id,
            user=s.user.display_name,
            meaning=s.meaning,
            subject_version=s.subject_version,
            content_hash=s.content_hash,
            transition_key=s.transition_key,
            signed_at=s.signed_at,
        )
        for s in rows
    ]
