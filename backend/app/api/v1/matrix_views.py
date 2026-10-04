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
from app.models.matrix_view import MatrixView
from app.models.project import Project
from app.models.user import User
from app.schemas.matrix_view import MatrixViewCreate, MatrixViewRead, MatrixViewUpdate
from app.services.permissions import has_role_at_least

router = APIRouter(tags=["matrix-views"])


def _unset_other_defaults(db: Session, project_id: uuid.UUID, except_id: uuid.UUID | None) -> None:
    query = db.query(MatrixView).filter(
        MatrixView.project_id == project_id, MatrixView.is_default.is_(True)
    )
    if except_id:
        query = query.filter(MatrixView.id != except_id)
    query.update({"is_default": False})


@router.get("/projects/{project_id}/matrix-views", response_model=list[MatrixViewRead])
def list_matrix_views(
    project: Project = Depends(require_project_read),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(MatrixView).filter(MatrixView.project_id == project.id)
    owner_id = str(user.id) if user else None
    if owner_id:
        query = query.filter((MatrixView.scope == "shared") | (MatrixView.owner_id == owner_id))
    else:
        query = query.filter(MatrixView.scope == "shared")
    return query.order_by(MatrixView.name).all()


@router.post("/projects/{project_id}/matrix-views", response_model=MatrixViewRead, status_code=201)
def create_matrix_view(
    payload: MatrixViewCreate,
    user: User = Depends(require_user),
    project: Project = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    data["owner_id"] = str(user.id) if payload.scope == "personal" else None
    data["created_by"] = user.username

    view = MatrixView(project_id=project.id, **data)
    db.add(view)
    if payload.is_default:
        db.flush()
        _unset_other_defaults(db, project.id, view.id)
    db.commit()
    db.refresh(view)
    return view


@router.patch("/matrix-views/{view_id}", response_model=MatrixViewRead)
def update_matrix_view(
    view_id: uuid.UUID,
    payload: MatrixViewUpdate,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(MatrixView, view_id)
    if not view:
        raise HTTPException(404, "Matrix view not found")
    if user is None or not has_role_at_least(db, view.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(view, field, value)
    if payload.is_default:
        _unset_other_defaults(db, view.project_id, view.id)

    db.commit()
    db.refresh(view)
    return view


@router.delete("/matrix-views/{view_id}", status_code=204)
def delete_matrix_view(
    view_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(MatrixView, view_id)
    if not view:
        raise HTTPException(404, "Matrix view not found")
    if user is None or not has_role_at_least(db, view.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    db.delete(view)
    db.commit()
