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


def _to_read(baseline: Baseline) -> BaselineRead:
    return BaselineRead(
        id=baseline.id,
        project_id=baseline.project_id,
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
        "items": [
            {
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
            for i in items
        ],
        # Frozen alongside the items so an export "as of this baseline"
        # can show the parameter values that were true at the time.
        "parameters": _parameter_snapshot(db, project_id),
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
