import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.link import LinkType
from app.schemas.link import LinkTypeCreate, LinkTypeRead, LinkTypeUpdate

router = APIRouter(tags=["link-types"])


@router.get("/organizations/{org_id}/link-types", response_model=list[LinkTypeRead])
def list_link_types(org_id: uuid.UUID, db: Session = Depends(get_db)):
    return db.query(LinkType).filter(LinkType.org_id == org_id).order_by(LinkType.name).all()


@router.post("/organizations/{org_id}/link-types", response_model=LinkTypeRead, status_code=201)
def create_link_type(org_id: uuid.UUID, payload: LinkTypeCreate, db: Session = Depends(get_db)):
    exists = (
        db.query(LinkType)
        .filter(LinkType.org_id == org_id, LinkType.key == payload.key)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Link type with key '{payload.key}' already exists.")

    data = payload.model_dump()
    data["allowed_source_types"] = [str(x) for x in payload.allowed_source_types]
    data["allowed_target_types"] = [str(x) for x in payload.allowed_target_types]
    link_type = LinkType(org_id=org_id, **data)
    db.add(link_type)
    db.commit()
    db.refresh(link_type)
    return link_type


@router.patch("/link-types/{link_type_id}", response_model=LinkTypeRead)
def update_link_type(
    link_type_id: uuid.UUID, payload: LinkTypeUpdate, db: Session = Depends(get_db)
):
    link_type = db.get(LinkType, link_type_id)
    if not link_type:
        raise HTTPException(404, "Link type not found")
    data = payload.model_dump(exclude_unset=True)
    if "allowed_source_types" in data and data["allowed_source_types"] is not None:
        data["allowed_source_types"] = [str(x) for x in data["allowed_source_types"]]
    if "allowed_target_types" in data and data["allowed_target_types"] is not None:
        data["allowed_target_types"] = [str(x) for x in data["allowed_target_types"]]
    for field, value in data.items():
        setattr(link_type, field, value)
    db.commit()
    db.refresh(link_type)
    return link_type


@router.delete("/link-types/{link_type_id}", status_code=204)
def delete_link_type(link_type_id: uuid.UUID, db: Session = Depends(get_db)):
    link_type = db.get(LinkType, link_type_id)
    if not link_type:
        raise HTTPException(404, "Link type not found")
    db.delete(link_type)
    db.commit()
