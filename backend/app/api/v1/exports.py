import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.document import Document
from app.models.glossary import GlossaryTerm
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.parameter import Parameter
from app.models.project import Project
from app.models.reference import ReferenceSource
from app.models.user import User
from app.services.export_html import build_document_html
from app.services.export_xlsx import build_document_workbook
from app.services.permissions import can_read

router = APIRouter(tags=["exports"])


def _load_export_data(db: Session, document_id: uuid.UUID, user: User | None):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    project = db.get(Project, document.project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Document not found")

    items = db.query(Item).filter(Item.document_id == document_id).all()
    item_types = db.query(ItemType).filter(ItemType.org_id == project.org_id).all()
    return document, items, item_types


@router.get("/documents/{document_id}/export.xlsx")
def export_document_xlsx(
    document_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document, items, item_types = _load_export_data(db, document_id, user)
    buffer = build_document_workbook(db, document.name, items, item_types)
    filename = f"{document.name.replace(' ', '_')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/documents/{document_id}/export.html")
def export_document_html(
    document_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document, items, item_types = _load_export_data(db, document_id, user)
    project = db.get(Project, document.project_id)
    glossary_terms = db.query(GlossaryTerm).filter(GlossaryTerm.org_id == project.org_id).all()
    reference_sources = (
        db.query(ReferenceSource)
        .filter(
            (ReferenceSource.scope == "standard") & (ReferenceSource.org_id == project.org_id)
            | (ReferenceSource.scope == "project_reference") & (ReferenceSource.project_id == project.id)
        )
        .all()
    )
    parameters = db.query(Parameter).filter(Parameter.project_id == project.id).all()
    content = build_document_html(
        db, document.name, items, item_types, glossary_terms, reference_sources, parameters
    )
    filename = f"{document.name.replace(' ', '_')}.html"
    return Response(
        content,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/documents/{document_id}/export.reqif")
def export_document_reqif(
    document_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.reqif import document_reqif

    document, items, item_types = _load_export_data(db, document_id, user)
    items = [i for i in items if i.obsolete_at is None]
    filename = f"{document.name.replace(' ', '_')}.reqif"
    return Response(
        document_reqif(document, items, item_types),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/documents/{document_id}/import.reqif")
async def import_document_reqif(
    document_id: uuid.UUID,
    file: UploadFile,
    item_type_id: uuid.UUID = Form(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Append a ReqIF specification to this document: hierarchy nodes with
    children become Sections, leaves become items of `item_type_id`.
    Attributes are matched to the item type's attributes by label or key;
    keys are minted fresh (the source ID is kept in the version note)."""
    from app.services.reqif import ReqIFError, parse_reqif

    data = await file.read()
    return await run_in_threadpool(_import_reqif, db, document_id, item_type_id, data, user, parse_reqif, ReqIFError)


def _import_reqif(db, document_id, item_type_id, data, user, parse_reqif, ReqIFError):
    from app.api.v1.items import _next_key
    from app.services.attribute_validation import AttributeValidationError, validate_attributes
    from app.services.permissions import has_permission
    from app.services.versioning import bump_structure, record_version
    from app.services.workflow_engine import STATUS_KEY, initial_state, resolve_item_definition

    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    project = db.get(Project, document.project_id)
    for perm in ("item.edit", "structure.edit"):
        if not has_permission(db, project.id, user, perm):
            raise HTTPException(403, f"Requires the '{perm}' permission on this project.")
    leaf_type = db.get(ItemType, item_type_id)
    if not leaf_type or leaf_type.org_id != project.org_id or leaf_type.behavior != "content":
        raise HTTPException(422, "Choose a content item type for the imported requirements.")
    section_type = (
        db.query(ItemType).filter(ItemType.org_id == project.org_id, ItemType.behavior == "structural").first()
    )
    try:
        nodes = parse_reqif(data)
    except ReqIFError as e:
        raise HTTPException(422, str(e))

    by_label = {}
    for a in leaf_type.attributes:
        by_label[a.label.lower()] = a
        by_label[a.key.lower()] = a
    definition = resolve_item_definition(db, project.id, leaf_type.id)
    start_state = initial_state({"states": definition.states}) if definition else None

    def attrs_for(raw: dict) -> dict:
        out = {}
        for name, value in raw.items():
            attr = by_label.get(name.lower())
            if attr is None or attr.key == STATUS_KEY or value in ("", None):
                continue
            if attr.data_type == "enum":
                match = next((o["value"] for o in attr.enum_options or []
                              if value.lower() in (o["value"].lower(), o["label"].lower())), None)
                if match is None:
                    continue
                out[attr.key] = match
            elif attr.data_type == "multi_enum":
                picks = [o["value"] for o in attr.enum_options or []
                         for v in value.split(",") if v.strip().lower() in (o["value"].lower(), o["label"].lower())]
                if picks:
                    out[attr.key] = picks
            elif attr.data_type == "number":
                try:
                    out[attr.key] = float(value)
                except ValueError:
                    continue
            elif attr.data_type == "boolean":
                out[attr.key] = value.strip().lower() in ("true", "yes", "1")
            else:
                out[attr.key] = value
        if start_state:
            out[STATUS_KEY] = start_state
        try:
            validate_attributes(leaf_type.attributes, out)
        except AttributeValidationError:
            # Fill required enums the import couldn't map with their first option.
            for a in leaf_type.attributes:
                if a.required and a.key not in out and a.enum_options:
                    out[a.key] = a.enum_options[0]["value"]
        return out

    counts = {"sections": 0, "items": 0, "skipped_attributes": 0}
    top_order = (db.query(func.max(Item.order)).filter(Item.document_id == document_id, Item.parent_id.is_(None))
                 .scalar() or 0)

    def create(node, parent_id, order):
        is_section = bool(node["children"]) and section_type is not None
        item_type = section_type if is_section else leaf_type
        item = Item(
            document_id=document_id,
            parent_id=parent_id,
            item_type_id=item_type.id,
            title=node["title"][:1000],
            description_md=node["text"] or None,
            attributes={} if is_section else attrs_for(node["attributes"]),
            order=order,
            key=_next_key(db, project.id, item_type),
            updated_by=user.username,
        )
        db.add(item)
        record_version(db, item, changed_by=user, reason="import", initial=True,
                       note=f"Imported from ReqIF{(' (' + node['foreign_id'] + ')') if node.get('foreign_id') else ''}")
        counts["sections" if is_section else "items"] += 1
        # Content items can't have children: a leaf-type node's children
        # are flattened next to it.
        child_parent = item.id if is_section else parent_id
        for i, child in enumerate(node["children"], start=1):
            create(child, child_parent, i if is_section else order + i)

    for i, node in enumerate(nodes, start=1):
        create(node, None, top_order + i)
    bump_structure(db, document_id)
    db.commit()
    return counts
