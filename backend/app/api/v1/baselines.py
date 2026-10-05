import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_project_read, require_project_role
from app.models.baseline import Baseline
from app.models.document import Document
from app.models.item import Item
from app.models.link import Link
from app.models.project import Project
from app.models.user import User
from app.schemas.baseline import BaselineCreate, BaselineDetail, BaselineRead
from app.services import audit
from app.services.permissions import can_read, has_permission

router = APIRouter(tags=["baselines"])


def _applicability_snapshot(db: Session, project_id) -> list[dict]:
    from app.models.library import ApplicabilityRecord

    rows = db.query(ApplicabilityRecord).filter(ApplicabilityRecord.project_id == project_id).all()
    return [
        {
            "source_item_id": str(r.source_item_id),
            "source_version": r.source_version,
            "release": r.release.name,
            "status": r.status,
            "rationale": r.rationale,
            "modified_item_id": str(r.modified_item_id) if r.modified_item_id else None,
            "decided_by": r.decided_by.display_name if r.decided_by else None,
            "approved_by": r.approved_by.display_name if r.approved_by else None,
        }
        for r in rows
    ]


def _parameter_snapshot(db: Session, project_id) -> list[dict]:
    from app.models.parameter import Parameter
    from app.services.parameters import compute_all_values

    try:
        params = db.query(Parameter).filter(Parameter.project_id == project_id).all()
        values = compute_all_values(params)
    except Exception:  # noqa: BLE001 — never block a baseline on a broken formula
        return []
    return [
        {"key": p.key, "value": values.get(p.key), "unit": getattr(p, "unit", None)}
        for p in params
    ]


def _item_snapshot(i: Item) -> dict:
    return {
        "id": str(i.id),
        "document_id": str(i.document_id),
        "parent_id": str(i.parent_id) if i.parent_id else None,
        "item_type_id": str(i.item_type_id),
        "key": i.key,
        "title": i.title,
        "description_md": i.description_md,
        "attributes": i.attributes,
        "order": i.order,
        "version": i.version,
        "obsolete": i.obsolete_at is not None,
    }


def _schema_snapshot(db: Session, items: list[Item], links: list[Link]) -> dict:
    """The item types and link types as they were — so a baseline still
    reads correctly after attributes or names change."""
    from app.models.item_type import ItemType
    from app.models.link import LinkType

    type_ids = {i.item_type_id for i in items}
    item_types = db.query(ItemType).filter(ItemType.id.in_(type_ids)).all() if type_ids else []
    link_type_ids = {link.link_type_id for link in links}
    link_types = db.query(LinkType).filter(LinkType.id.in_(link_type_ids)).all() if link_type_ids else []
    return {
        "item_types": {
            str(t.id): {
                "name": t.name,
                "behavior": t.behavior,
                "color": t.color,
                "attributes": [
                    {"key": a.key, "label": a.label, "data_type": a.data_type, "enum_options": a.enum_options,
                     "unit": a.unit, "order": a.order}
                    for a in sorted(t.attributes, key=lambda a: a.order)
                ],
            }
            for t in item_types
        },
        "link_types": {str(t.id): {"name": t.name, "inverse_name": t.inverse_name} for t in link_types},
    }


def _to_read(baseline: Baseline) -> BaselineRead:
    return BaselineRead(
        id=baseline.id,
        project_id=baseline.project_id,
        document_id=baseline.document_id,
        document_name=baseline.snapshot.get("document", {}).get("name"),
        name=baseline.name,
        git_commit_sha=baseline.git_commit_sha,
        created_by=baseline.created_by,
        created_at=baseline.created_at,
        item_count=len(baseline.snapshot.get("items", [])),
        description=baseline.description,
        locks_items=baseline.locks_items,
    )


@router.get("/projects/{project_id}/baselines", response_model=list[BaselineRead])
def list_baselines(
    project: Project = Depends(require_project_read), db: Session = Depends(get_db)
):
    baselines = (
        db.query(Baseline)
        .filter(Baseline.project_id == project.id)
        .order_by(Baseline.created_at.desc())
        .all()
    )
    return [_to_read(b) for b in baselines]


@router.post("/projects/{project_id}/baselines", response_model=BaselineRead, status_code=201)
def create_baseline(
    payload: BaselineCreate,
    project: Project = Depends(require_project_read),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project_id = project.id
    if user is None or not has_permission(db, project_id, user, "baseline.create"):
        raise HTTPException(403, "Requires the 'baseline.create' permission on this project.")
    if payload.locks_items and not has_permission(db, project_id, user, "project.admin"):
        raise HTTPException(403, "Only a project admin can create a locking (milestone) baseline.")
    items = (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project_id)
        .all()
    )
    item_ids = [i.id for i in items]
    links = (
        db.query(Link)
        .filter(Link.source_item_id.in_(item_ids), Link.target_item_id.in_(item_ids))
        .all()
        if item_ids
        else []
    )

    snapshot = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "items": [_item_snapshot(i) for i in items],
        # Frozen alongside the items so an export "as of this baseline"
        # can show the parameter values that were true at the time.
        "parameters": _parameter_snapshot(db, project_id),
        # The approved applicability matrix is part of the project baseline.
        "applicability": _applicability_snapshot(db, project_id),
        "links": [
            {
                "id": str(link.id),
                "source_item_id": str(link.source_item_id),
                "target_item_id": str(link.target_item_id),
                "link_type_id": str(link.link_type_id),
            }
            for link in links
        ],
    }

    baseline = Baseline(
        project_id=project_id,
        name=payload.name,
        created_by=user.username,
        description=payload.description,
        locks_items=payload.locks_items,
        snapshot=snapshot,
        item_versions={str(i.id): i.version for i in items if i.obsolete_at is None},
    )
    db.add(baseline)
    db.flush()
    audit.log(
        db,
        action="baseline.create",
        subject_type="baseline",
        subject_id=baseline.id,
        actor=user,
        project_id=project_id,
        summary=f"Baseline '{payload.name}' created ({len(items)} items"
        + (", locking" if payload.locks_items else "")
        + ")",
    )
    db.commit()
    db.refresh(baseline)
    return _to_read(baseline)


@router.get("/documents/{document_id}/baselines", response_model=list[BaselineRead])
def list_document_baselines(
    document_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = db.get(Document, document_id)
    if not doc or not can_read(db, doc.project, user.id if user else None):
        raise HTTPException(404, "Document not found")
    baselines = (
        db.query(Baseline).filter(Baseline.document_id == document_id).order_by(Baseline.created_at.desc()).all()
    )
    return [_to_read(b) for b in baselines]


@router.post("/documents/{document_id}/baselines", response_model=BaselineRead, status_code=201)
def create_document_baseline(
    document_id: uuid.UUID,
    payload: BaselineCreate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Freeze one document as it is now — e.g. the version that went to a
    System Requirements Review. Read-only forever; the live document keeps
    changing."""
    doc = db.get(Document, document_id)
    if not doc or not can_read(db, doc.project, user.id if user else None):
        raise HTTPException(404, "Document not found")
    project_id = doc.project_id
    if user is None or not has_permission(db, project_id, user, "baseline.create"):
        raise HTTPException(403, "Requires the 'baseline.create' permission on this project.")
    if payload.locks_items and not has_permission(db, project_id, user, "project.admin"):
        raise HTTPException(403, "Only a project admin can create a locking (milestone) baseline.")
    if not payload.name.strip():
        raise HTTPException(422, "Give the baseline a name.")

    items = db.query(Item).filter(Item.document_id == document_id).all()
    item_ids = [i.id for i in items]
    links = (
        db.query(Link)
        .filter((Link.source_item_id.in_(item_ids)) | (Link.target_item_id.in_(item_ids)))
        .all()
        if item_ids
        else []
    )
    # Items at the far end of links that leave this document — key/title as
    # they were, so the frozen links stay readable.
    inside = set(item_ids)
    outside_ids = {lnk.target_item_id for lnk in links} | {lnk.source_item_id for lnk in links}
    outside_ids -= inside
    outside = db.query(Item).filter(Item.id.in_(outside_ids)).all() if outside_ids else []

    snapshot = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "document": {"id": str(doc.id), "name": doc.name},
        "items": [_item_snapshot(i) for i in items],
        "links": [
            {
                "id": str(link.id),
                "source_item_id": str(link.source_item_id),
                "target_item_id": str(link.target_item_id),
                "link_type_id": str(link.link_type_id),
            }
            for link in links
        ],
        "external_items": {
            str(i.id): {"key": i.key, "title": i.title, "document": i.document.name} for i in outside
        },
        **_schema_snapshot(db, items, links),
    }
    baseline = Baseline(
        project_id=project_id,
        document_id=document_id,
        name=payload.name.strip(),
        created_by=user.username,
        description=payload.description,
        locks_items=payload.locks_items,
        snapshot=snapshot,
        item_versions={str(i.id): i.version for i in items if i.obsolete_at is None},
    )
    db.add(baseline)
    db.flush()
    audit.log(
        db,
        action="baseline.create",
        subject_type="baseline",
        subject_id=baseline.id,
        actor=user,
        project_id=project_id,
        summary=f"Baseline '{baseline.name}' of document '{doc.name}' created ({len(items)} items)",
    )
    db.commit()
    db.refresh(baseline)
    return _to_read(baseline)


@router.get("/baselines/{baseline_id}", response_model=BaselineDetail)
def get_baseline(
    baseline_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    baseline = db.get(Baseline, baseline_id)
    if not baseline:
        raise HTTPException(404, "Baseline not found")
    project = db.get(Project, baseline.project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Baseline not found")
    return BaselineDetail(**_to_read(baseline).model_dump(), snapshot=baseline.snapshot)


@router.delete("/baselines/{baseline_id}", status_code=204)
def delete_baseline(
    baseline_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    baseline = db.get(Baseline, baseline_id)
    if not baseline:
        raise HTTPException(404, "Baseline not found")
    needed = "project.admin" if baseline.locks_items else "baseline.create"
    if user is None or not has_permission(db, baseline.project_id, user, needed):
        raise HTTPException(403, f"Requires the '{needed}' permission on this project.")
    audit.log(
        db,
        action="baseline.delete",
        subject_type="baseline",
        subject_id=baseline.id,
        actor=user,
        project_id=baseline.project_id,
        summary=f"Baseline '{baseline.name}' deleted",
    )
    db.delete(baseline)
    db.commit()
