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
from app.services.permissions import can_read, has_role_at_least

router = APIRouter(tags=["baselines"])


def _to_read(baseline: Baseline) -> BaselineRead:
    return BaselineRead(
        id=baseline.id,
        project_id=baseline.project_id,
        name=baseline.name,
        git_commit_sha=baseline.git_commit_sha,
        created_by=baseline.created_by,
        created_at=baseline.created_at,
        item_count=len(baseline.snapshot.get("items", [])),
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
    project: Project = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
):
    project_id = project.id
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
            }
            for i in items
        ],
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
        created_by=payload.created_by,
        snapshot=snapshot,
    )
    db.add(baseline)
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
    if user is None or not has_role_at_least(db, baseline.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    db.delete(baseline)
    db.commit()
