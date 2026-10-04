import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import assert_org_admin, get_db, require_project_read, require_user
from app.config import settings
from app.models.document import Document
from app.models.item import Item
from app.models.project import Project
from app.models.reference import ReferenceLocator, ReferenceSource
from app.models.user import User
from app.schemas.reference import (
    ReferenceConsistencyReport,
    ReferenceLocatorCreate,
    ReferenceLocatorRead,
    ReferenceSourceRead,
    ReferenceSourceUpdate,
)
from app.services.permissions import has_role_at_least
from app.services.references import extract_reference_refs

router = APIRouter(tags=["references"])


def _save_upload(file: UploadFile, source_id: uuid.UUID) -> str:
    directory = Path(settings.reference_files_dir)
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{source_id}.pdf"
    with (directory / filename).open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return filename


@router.get("/organizations/{org_id}/standards", response_model=list[ReferenceSourceRead])
def list_standards(org_id: uuid.UUID, db: Session = Depends(get_db)):
    # §13.3-style: open like the glossary — reference material, not project data.
    return (
        db.query(ReferenceSource)
        .filter(ReferenceSource.scope == "standard", ReferenceSource.org_id == org_id)
        .order_by(ReferenceSource.code)
        .all()
    )


@router.post("/organizations/{org_id}/standards", response_model=ReferenceSourceRead, status_code=201)
async def create_standard(
    org_id: uuid.UUID,
    code: str = Form(...),
    title: str = Form(...),
    version: str | None = Form(None),
    source_type: str = Form(...),
    external_url: str | None = Form(None),
    description: str | None = Form(None),
    file: UploadFile | None = File(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    assert_org_admin(db, user, org_id)
    if source_type == "pdf" and not file:
        raise HTTPException(422, "A PDF file is required when source_type is 'pdf'.")
    if source_type == "external_link" and not external_url:
        raise HTTPException(422, "external_url is required when source_type is 'external_link'.")

    source = ReferenceSource(
        scope="standard", org_id=org_id, code=code, title=title, version=version,
        source_type=source_type, external_url=external_url, description=description,
    )
    db.add(source)
    db.flush()
    if file:
        source.file_ref = _save_upload(file, source.id)
    db.commit()
    db.refresh(source)
    return source


@router.get("/projects/{project_id}/reference-documents", response_model=list[ReferenceSourceRead])
def list_reference_documents(project: Project = Depends(require_project_read), db: Session = Depends(get_db)):
    return (
        db.query(ReferenceSource)
        .filter(ReferenceSource.scope == "project_reference", ReferenceSource.project_id == project.id)
        .order_by(ReferenceSource.code)
        .all()
    )


@router.post(
    "/projects/{project_id}/reference-documents", response_model=ReferenceSourceRead, status_code=201
)
async def create_reference_document(
    project_id: uuid.UUID,
    code: str = Form(...),
    title: str = Form(...),
    version: str | None = Form(None),
    source_type: str = Form(...),
    external_url: str | None = Form(None),
    description: str | None = Form(None),
    file: UploadFile | None = File(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not has_role_at_least(db, project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")

    if source_type == "pdf" and not file:
        raise HTTPException(422, "A PDF file is required when source_type is 'pdf'.")
    if source_type == "external_link" and not external_url:
        raise HTTPException(422, "external_url is required when source_type is 'external_link'.")

    source = ReferenceSource(
        scope="project_reference", project_id=project_id, code=code, title=title, version=version,
        source_type=source_type, external_url=external_url, description=description,
    )
    db.add(source)
    db.flush()
    if file:
        source.file_ref = _save_upload(file, source.id)
    db.commit()
    db.refresh(source)
    return source


def _require_source_write(db: Session, source: ReferenceSource, user: User) -> None:
    if source.scope == "project_reference":
        if not has_role_at_least(db, source.project_id, user.id, "editor"):
            raise HTTPException(403, "Requires at least 'editor' role on this project.")
    else:
        assert_org_admin(db, user, source.org_id)


@router.patch("/reference-sources/{source_id}", response_model=ReferenceSourceRead)
def update_reference_source(
    source_id: uuid.UUID,
    payload: ReferenceSourceUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    source = db.get(ReferenceSource, source_id)
    if not source:
        raise HTTPException(404, "Reference source not found")
    _require_source_write(db, source, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


@router.delete("/reference-sources/{source_id}", status_code=204)
def delete_reference_source(
    source_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    source = db.get(ReferenceSource, source_id)
    if not source:
        raise HTTPException(404, "Reference source not found")
    _require_source_write(db, source, user)
    if source.file_ref:
        path = Path(settings.reference_files_dir) / source.file_ref
        path.unlink(missing_ok=True)
    db.delete(source)
    db.commit()


@router.get("/reference-sources/{source_id}/file")
def get_reference_file(source_id: uuid.UUID, db: Session = Depends(get_db)):
    source = db.get(ReferenceSource, source_id)
    if not source or not source.file_ref:
        raise HTTPException(404, "File not found")
    path = Path(settings.reference_files_dir) / source.file_ref
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="application/pdf")


@router.post(
    "/reference-sources/{source_id}/locators", response_model=ReferenceLocatorRead, status_code=201
)
def create_locator(
    source_id: uuid.UUID,
    payload: ReferenceLocatorCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    source = db.get(ReferenceSource, source_id)
    if not source:
        raise HTTPException(404, "Reference source not found")
    _require_source_write(db, source, user)
    locator = ReferenceLocator(source_id=source_id, **payload.model_dump())
    db.add(locator)
    db.commit()
    db.refresh(locator)
    return locator


@router.delete("/reference-locators/{locator_id}", status_code=204)
def delete_locator(locator_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    locator = db.get(ReferenceLocator, locator_id)
    if not locator:
        raise HTTPException(404, "Locator not found")
    _require_source_write(db, locator.source, user)
    db.delete(locator)
    db.commit()


@router.get(
    "/organizations/{org_id}/standards/consistency-report", response_model=ReferenceConsistencyReport
)
def standards_consistency_report(org_id: uuid.UUID, db: Session = Depends(get_db)):
    sources = db.query(ReferenceSource).filter(
        ReferenceSource.scope == "standard", ReferenceSource.org_id == org_id
    ).all()
    by_code = {s.code.lower(): s for s in sources}

    items = (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .join(Project, Document.project_id == Project.id)
        .filter(Project.org_id == org_id)
        .all()
    )
    cited_codes: set[str] = set()
    superseded_hits: set[str] = set()
    for item in items:
        for code, _label in extract_reference_refs(item.description_md):
            cited_codes.add(code.lower())
            src = by_code.get(code.lower())
            if src and src.superseded_by:
                superseded_hits.add(src.code)

    unused = sorted(s.code for s in sources if s.code.lower() not in cited_codes)
    return ReferenceConsistencyReport(
        unused_sources=unused, superseded_citations=sorted(superseded_hits)
    )
