import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import assert_org_admin, get_db, require_user
from app.models.document import Document
from app.models.glossary import GlossaryTerm
from app.models.item import Item
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User
from app.schemas.glossary import (
    GlossaryConsistencyReport,
    GlossaryImportResult,
    GlossaryTermCreate,
    GlossaryTermRead,
    GlossaryTermUpdate,
)
from app.services.glossary import extract_glossary_refs
from app.services.glossary_io import (
    GlossaryImportError,
    build_glossary_html,
    build_glossary_workbook,
    parse_glossary_workbook,
)

router = APIRouter(tags=["glossary"])


@router.get("/organizations/{org_id}/glossary", response_model=list[GlossaryTermRead])
def list_glossary_terms(org_id: uuid.UUID, db: Session = Depends(get_db)):
    # §13.3: always fully readable, logged in or not — schema/reference
    # material, not project data.
    return (
        db.query(GlossaryTerm)
        .filter(GlossaryTerm.org_id == org_id)
        .order_by(GlossaryTerm.abbreviation)
        .all()
    )


@router.post("/organizations/{org_id}/glossary", response_model=GlossaryTermRead, status_code=201)
def create_glossary_term(
    org_id: uuid.UUID,
    payload: GlossaryTermCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    assert_org_admin(db, user, org_id)
    exists = (
        db.query(GlossaryTerm)
        .filter(GlossaryTerm.org_id == org_id, GlossaryTerm.abbreviation == payload.abbreviation)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Term '{payload.abbreviation}' already exists.")
    term = GlossaryTerm(org_id=org_id, **payload.model_dump())
    db.add(term)
    db.commit()
    db.refresh(term)
    return term


@router.patch("/glossary/{term_id}", response_model=GlossaryTermRead)
def update_glossary_term(
    term_id: uuid.UUID,
    payload: GlossaryTermUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    term = db.get(GlossaryTerm, term_id)
    if not term:
        raise HTTPException(404, "Glossary term not found")
    assert_org_admin(db, user, term.org_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(term, field, value)
    db.commit()
    db.refresh(term)
    return term


@router.delete("/glossary/{term_id}", status_code=204)
def delete_glossary_term(
    term_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    term = db.get(GlossaryTerm, term_id)
    if not term:
        raise HTTPException(404, "Glossary term not found")
    assert_org_admin(db, user, term.org_id)
    db.delete(term)
    db.commit()


@router.get(
    "/organizations/{org_id}/glossary/consistency-report",
    response_model=GlossaryConsistencyReport,
)
def glossary_consistency_report(org_id: uuid.UUID, db: Session = Depends(get_db)):
    """§5.2: "low effort, high value" — unused terms and undefined
    abbreviations referenced in item content, scanned org-wide across every
    project's `description_md` and rich_text attribute values."""
    terms = db.query(GlossaryTerm).filter(GlossaryTerm.org_id == org_id).all()
    known = {t.abbreviation.lower() for t in terms}

    rich_text_keys = {
        a.key
        for a in (
            db.query(ItemTypeAttribute)
            .join(ItemType, ItemTypeAttribute.item_type_id == ItemType.id)
            .filter(ItemType.org_id == org_id)
            .all()
        )
        if a.data_type == "rich_text"
    }

    items = (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .join(Project, Document.project_id == Project.id)
        .filter(Project.org_id == org_id)
        .all()
    )

    referenced: set[str] = set()
    for item in items:
        referenced |= extract_glossary_refs(item.description_md)
        for key in rich_text_keys:
            value = item.attributes.get(key)
            if isinstance(value, str):
                referenced |= extract_glossary_refs(value)

    referenced_lower = {r.lower() for r in referenced}
    unused = sorted(t.abbreviation for t in terms if t.abbreviation.lower() not in referenced_lower)
    undefined = sorted(r for r in referenced if r.lower() not in known)

    return GlossaryConsistencyReport(unused_terms=unused, undefined_references=undefined)


@router.get("/organizations/{org_id}/glossary/export.xlsx")
def export_glossary_xlsx(org_id: uuid.UUID, db: Session = Depends(get_db)):
    terms = db.query(GlossaryTerm).filter(GlossaryTerm.org_id == org_id).all()
    buffer = build_glossary_workbook(terms)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="glossary.xlsx"'},
    )


@router.get("/organizations/{org_id}/glossary/export.html")
def export_glossary_html(org_id: uuid.UUID, db: Session = Depends(get_db)):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    terms = db.query(GlossaryTerm).filter(GlossaryTerm.org_id == org_id).all()
    content = build_glossary_html(org.name, terms)
    return Response(
        content,
        media_type="text/html",
        headers={"Content-Disposition": 'attachment; filename="glossary.html"'},
    )


@router.post("/organizations/{org_id}/glossary/import", response_model=GlossaryImportResult)
async def import_glossary(
    org_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Upserts by abbreviation (case-insensitive): an existing term gets its
    term/definition/category updated in place, a new abbreviation is
    created. Same "one row per entity" shape as the requirements XLSX
    export, so a glossary can round-trip through a spreadsheet the same way
    (§8's export pipeline, applied to the glossary rather than items)."""
    assert_org_admin(db, user, org_id)
    try:
        rows = parse_glossary_workbook(await file.read())
    except GlossaryImportError as e:
        raise HTTPException(422, str(e))

    existing = {
        t.abbreviation.lower(): t
        for t in db.query(GlossaryTerm).filter(GlossaryTerm.org_id == org_id).all()
    }

    created = 0
    updated = 0
    errors: list[str] = []
    seen_in_file: set[str] = set()
    for row in rows:
        key = row["abbreviation"].lower()
        if key in seen_in_file:
            errors.append(f"Duplicate abbreviation in file, skipped extra row: {row['abbreviation']}")
            continue
        seen_in_file.add(key)

        if not row["term"] or not row["definition"]:
            errors.append(f"Row for '{row['abbreviation']}' is missing Term or Definition, skipped.")
            continue

        if key in existing:
            term = existing[key]
            term.term = row["term"]
            term.definition = row["definition"]
            term.category = row["category"]
            term.updated_by = user.username
            updated += 1
        else:
            db.add(
                GlossaryTerm(
                    org_id=org_id,
                    abbreviation=row["abbreviation"],
                    term=row["term"],
                    definition=row["definition"],
                    category=row["category"],
                    updated_by=user.username,
                )
            )
            created += 1

    db.commit()
    return GlossaryImportResult(created=created, updated=updated, errors=errors)
