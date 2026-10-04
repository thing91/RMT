import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
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
