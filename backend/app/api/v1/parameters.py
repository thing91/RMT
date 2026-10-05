import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_project_read, require_user
from app.models.item import Item
from app.models.parameter import Parameter, ParameterLink
from app.models.project import Project
from app.models.user import User
from app.schemas.parameter import ParameterCreate, ParameterRead, ParameterUpdate, ParameterUsage
from app.services.parameters import ParameterError, compute_all_values, validate_parameters
from app.services.permissions import has_role_at_least

router = APIRouter(tags=["parameters"])


def _require_editor(db: Session, project_id: uuid.UUID, user: User) -> None:
    if not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")


def _to_read(param: Parameter, computed: dict[str, float | None], used_in: dict[uuid.UUID, int]) -> ParameterRead:
    return ParameterRead(
        id=param.id, project_id=param.project_id, key=param.key, name=param.name,
        value=param.value, computed_value=computed.get(param.key), unit=param.unit,
        data_type=param.data_type, formula=param.formula, source=param.source,
        min=param.min, max=param.max, tolerance=param.tolerance, updated_by=param.updated_by,
        description=param.description, created_at=param.created_at, updated_at=param.updated_at,
        used_in_count=used_in.get(param.id, 0),
    )


@router.get("/projects/{project_id}/parameters", response_model=list[ParameterRead])
def list_parameters(project: Project = Depends(require_project_read), db: Session = Depends(get_db)):
    params = db.query(Parameter).filter(Parameter.project_id == project.id).order_by(Parameter.key).all()
    computed = compute_all_values(params)
    counts = dict(
        db.query(ParameterLink.parameter_id, func.count())
        .filter(ParameterLink.parameter_id.in_([p.id for p in params]))
        .group_by(ParameterLink.parameter_id)
        .all()
    ) if params else {}
    return [_to_read(p, computed, counts) for p in params]


@router.post("/projects/{project_id}/parameters", response_model=ParameterRead, status_code=201)
def create_parameter(
    project_id: uuid.UUID,
    payload: ParameterCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    _require_editor(db, project_id, user)

    exists = (
        db.query(Parameter)
        .filter(Parameter.project_id == project_id, Parameter.key == payload.key)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Parameter key '{payload.key}' already exists in this project.")
    if payload.data_type == "derived" and not payload.formula:
        raise HTTPException(422, "A derived parameter needs a formula.")

    param = Parameter(project_id=project_id, updated_by=user.username, **payload.model_dump())
    others = db.query(Parameter).filter(Parameter.project_id == project_id).all()
    try:
        validate_parameters([*others, param], param)
    except (ParameterError, ZeroDivisionError) as e:
        raise HTTPException(422, str(e))
    db.add(param)
    db.commit()
    db.refresh(param)
    all_params = db.query(Parameter).filter(Parameter.project_id == project_id).all()
    return _to_read(param, compute_all_values(all_params), {})


@router.patch("/parameters/{parameter_id}", response_model=ParameterRead)
def update_parameter(
    parameter_id: uuid.UUID,
    payload: ParameterUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    param = db.get(Parameter, parameter_id)
    if not param:
        raise HTTPException(404, "Parameter not found")
    _require_editor(db, param.project_id, user)

    data = payload.model_dump(exclude_unset=True)
    if data.get("data_type") == "derived" and not (data.get("formula") or param.formula):
        raise HTTPException(422, "A derived parameter needs a formula.")
    for field, value in data.items():
        setattr(param, field, value)
    param.updated_by = user.username
    all_params = db.query(Parameter).filter(Parameter.project_id == param.project_id).all()
    try:
        validate_parameters(all_params, param)
    except (ParameterError, ZeroDivisionError) as e:
        db.rollback()
        raise HTTPException(422, str(e))
    db.commit()
    db.refresh(param)
    return _to_read(param, compute_all_values(all_params), {})


@router.delete("/parameters/{parameter_id}", status_code=204)
def delete_parameter(parameter_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    param = db.get(Parameter, parameter_id)
    if not param:
        raise HTTPException(404, "Parameter not found")
    _require_editor(db, param.project_id, user)
    db.delete(param)
    db.commit()


@router.get("/parameters/{parameter_id}/usages", response_model=list[ParameterUsage])
def list_parameter_usages(parameter_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = (
        db.query(Item)
        .join(ParameterLink, ParameterLink.item_id == Item.id)
        .filter(ParameterLink.parameter_id == parameter_id)
        .all()
    )
    return [ParameterUsage(item_id=i.id, item_key=i.key, item_title=i.title) for i in rows]
