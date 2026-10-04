import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_db,
    require_project_read,
    require_project_role,
    require_user,
)
from app.models.project import Project
from app.models.table_view import TableView
from app.models.user import User
from app.schemas.table_view import TableViewCreate, TableViewRead, TableViewUpdate
from app.services.permissions import has_role_at_least

router = APIRouter(tags=["table-views"])


def _unset_other_defaults(db: Session, project_id: uuid.UUID, except_id: uuid.UUID | None) -> None:
    query = db.query(TableView).filter(
        TableView.project_id == project_id, TableView.is_default.is_(True)
    )
    if except_id:
        query = query.filter(TableView.id != except_id)
    query.update({"is_default": False})


@router.get("/projects/{project_id}/table-views", response_model=list[TableViewRead])
def list_table_views(
    project: Project = Depends(require_project_read),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # A personal view is only ever visible to its own owner — everyone else
    # just sees the shared ones (§ known simplification, now closed: scope
    # existed in the API/model but the UI always saved "shared" and every
    # view was returned to every caller regardless).
    query = db.query(TableView).filter(TableView.project_id == project.id)
    owner_id = str(user.id) if user else None
    if owner_id:
        query = query.filter(
            (TableView.scope == "shared") | (TableView.owner_id == owner_id)
        )
    else:
        query = query.filter(TableView.scope == "shared")
    return query.order_by(TableView.name).all()


@router.post("/projects/{project_id}/table-views", response_model=TableViewRead, status_code=201)
def create_table_view(
    payload: TableViewCreate,
    user: User = Depends(require_user),
    project: Project = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    # Never trust a client-supplied owner_id — a personal view is always
    # owned by whoever is actually authenticated, not whoever the request
    # claims.
    data["owner_id"] = str(user.id) if payload.scope == "personal" else None
    data["created_by"] = user.username

    view = TableView(project_id=project.id, **data)
    db.add(view)
    if payload.is_default:
        db.flush()
        _unset_other_defaults(db, project.id, view.id)
    db.commit()
    db.refresh(view)
    return view


@router.patch("/table-views/{view_id}", response_model=TableViewRead)
def update_table_view(
    view_id: uuid.UUID,
    payload: TableViewUpdate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(TableView, view_id)
    if not view:
        raise HTTPException(404, "Table view not found")
    if user is None or not has_role_at_least(db, view.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(view, field, value)

    if payload.is_default:
        _unset_other_defaults(db, view.project_id, view.id)

    db.commit()
    db.refresh(view)
    return view


@router.delete("/table-views/{view_id}", status_code=204)
def delete_table_view(
    view_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(TableView, view_id)
    if not view:
        raise HTTPException(404, "Table view not found")
    if user is None or not has_role_at_least(db, view.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    db.delete(view)
    db.commit()
