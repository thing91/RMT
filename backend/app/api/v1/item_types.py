import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.item_type import ItemType, ItemTypeAttribute
from app.schemas.item_type import (
    ItemTypeAttributeCreate,
    ItemTypeAttributeRead,
    ItemTypeAttributeUpdate,
    ItemTypeCreate,
    ItemTypeRead,
    ItemTypeUpdate,
)

router = APIRouter(tags=["item-types"])


@router.get("/organizations/{org_id}/item-types", response_model=list[ItemTypeRead])
def list_item_types(org_id: uuid.UUID, db: Session = Depends(get_db)):
    return db.query(ItemType).filter(ItemType.org_id == org_id).order_by(ItemType.name).all()


@router.post("/organizations/{org_id}/item-types", response_model=ItemTypeRead, status_code=201)
def create_item_type(org_id: uuid.UUID, payload: ItemTypeCreate, db: Session = Depends(get_db)):
    exists = (
        db.query(ItemType)
        .filter(ItemType.org_id == org_id, ItemType.key == payload.key)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Item type with key '{payload.key}' already exists.")
    item_type = ItemType(org_id=org_id, is_system=False, **payload.model_dump())
    db.add(item_type)
    db.flush()
    # Every content type gets the org's default workflow straight away
    # (adjustable afterwards under Workflows).
    from app.services.bootstrap import ensure_default_workflow

    ensure_default_workflow(db, item_type)
    db.commit()
    db.refresh(item_type)
    return item_type


@router.patch("/item-types/{item_type_id}", response_model=ItemTypeRead)
def update_item_type(
    item_type_id: uuid.UUID, payload: ItemTypeUpdate, db: Session = Depends(get_db)
):
    item_type = db.get(ItemType, item_type_id)
    if not item_type:
        raise HTTPException(404, "Item type not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item_type, field, value)
    db.commit()
    db.refresh(item_type)
    return item_type


@router.delete("/item-types/{item_type_id}", status_code=204)
def delete_item_type(item_type_id: uuid.UUID, db: Session = Depends(get_db)):
    item_type = db.get(ItemType, item_type_id)
    if not item_type:
        raise HTTPException(404, "Item type not found")
    if item_type.is_system:
        raise HTTPException(400, "Built-in item types cannot be deleted.")
    db.delete(item_type)
    db.commit()


@router.post(
    "/item-types/{item_type_id}/attributes",
    response_model=ItemTypeAttributeRead,
    status_code=201,
)
def create_attribute(
    item_type_id: uuid.UUID, payload: ItemTypeAttributeCreate, db: Session = Depends(get_db)
):
    item_type = db.get(ItemType, item_type_id)
    if not item_type:
        raise HTTPException(404, "Item type not found")
    exists = any(a.key == payload.key for a in item_type.attributes)
    if exists:
        raise HTTPException(409, f"Attribute with key '{payload.key}' already exists on this type.")

    attribute = ItemTypeAttribute(
        item_type_id=item_type_id, is_system=False, **payload.model_dump()
    )
    db.add(attribute)
    db.commit()
    db.refresh(attribute)
    return attribute


@router.patch(
    "/item-types/{item_type_id}/attributes/{attribute_id}",
    response_model=ItemTypeAttributeRead,
)
def update_attribute(
    item_type_id: uuid.UUID,
    attribute_id: uuid.UUID,
    payload: ItemTypeAttributeUpdate,
    db: Session = Depends(get_db),
):
    attribute = db.get(ItemTypeAttribute, attribute_id)
    if not attribute or attribute.item_type_id != item_type_id:
        raise HTTPException(404, "Attribute not found")

    # §4.5: data_type changes are not allowed in-place — only a new attribute
    # (plus an optional bulk migration) may change how a field is typed.
    data = payload.model_dump(exclude_unset=True)
    if attribute.key == "status" and "enum_options" in data:
        from app.models.workflow_def import WorkflowDefinition

        if db.query(WorkflowDefinition).filter_by(item_type_id=item_type_id).first():
            raise HTTPException(
                422,
                "Status values are defined by this type's workflow — change the workflow instead.",
            )
    for field, value in data.items():
        setattr(attribute, field, value)
    db.commit()
    db.refresh(attribute)
    return attribute


@router.delete("/item-types/{item_type_id}/attributes/{attribute_id}", status_code=204)
def delete_attribute(
    item_type_id: uuid.UUID, attribute_id: uuid.UUID, db: Session = Depends(get_db)
):
    attribute = db.get(ItemTypeAttribute, attribute_id)
    if not attribute or attribute.item_type_id != item_type_id:
        raise HTTPException(404, "Attribute not found")
    if attribute.is_system:
        raise HTTPException(400, "Built-in attributes cannot be deleted, only deprecated.")
    db.delete(attribute)
    db.commit()
