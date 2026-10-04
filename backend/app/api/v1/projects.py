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
from app.models.document import Document
from app.models.document_group import DocumentGroup
from app.models.project import Project
from app.models.project_access import ROLES, ProjectAccess
from app.models.user import User
from app.schemas.project import (
    DocumentCreate,
    DocumentGroupCreate,
    DocumentGroupRead,
    DocumentGroupUpdate,
    DocumentRead,
    DocumentUpdate,
    ProjectCreate,
    ProjectRead,
)
from app.schemas.user import ProjectAccessCreate, ProjectAccessRead
from app.services.permissions import can_read, has_role_at_least

router = APIRouter(tags=["projects"])


@router.get("/organizations/{org_id}/projects", response_model=list[ProjectRead])
def list_projects(
    org_id: uuid.UUID,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # §13.4: private projects with no access for this caller aren't listed
    # at all — not even their existence is disclosed.
    projects = db.query(Project).filter(Project.org_id == org_id).order_by(Project.name).all()
    return [p for p in projects if can_read(db, p, user.id if user else None)]


@router.post("/organizations/{org_id}/projects", response_model=ProjectRead, status_code=201)
def create_project(
    org_id: uuid.UUID,
    payload: ProjectCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    project = Project(org_id=org_id, **payload.model_dump())
    db.add(project)
    db.flush()
    # The creator is granted admin on their own new project — otherwise
    # nobody could manage access on it afterward (§13.5's admin-approval
    # queue is Phase 3; Phase 1 still needs *someone* to hold admin).
    db.add(ProjectAccess(project_id=project.id, subject_type="user", subject_id=user.id, role="admin"))
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project: Project = Depends(require_project_read)):
    return project


@router.get("/projects/{project_id}/documents", response_model=list[DocumentRead])
def list_documents(project: Project = Depends(require_project_read), db: Session = Depends(get_db)):
    return (
        db.query(Document)
        .filter(Document.project_id == project.id)
        .order_by(Document.order)
        .all()
    )


@router.post("/projects/{project_id}/documents", response_model=DocumentRead, status_code=201)
def create_document(
    payload: DocumentCreate,
    project: Project = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
):
    document = Document(project_id=project.id, **payload.model_dump())
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.patch("/documents/{document_id}", response_model=DocumentRead)
def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    if not has_role_at_least(db, document.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")

    data = payload.model_dump(exclude_unset=True)
    if "group_id" in data and data["group_id"] is not None:
        group = db.get(DocumentGroup, data["group_id"])
        if not group or group.project_id != document.project_id:
            raise HTTPException(404, "Document group not found in this project.")

    for key, value in data.items():
        setattr(document, key, value)
    db.commit()
    db.refresh(document)
    return document


@router.get("/projects/{project_id}/document-groups", response_model=list[DocumentGroupRead])
def list_document_groups(project: Project = Depends(require_project_read), db: Session = Depends(get_db)):
    return (
        db.query(DocumentGroup)
        .filter(DocumentGroup.project_id == project.id)
        .order_by(DocumentGroup.order)
        .all()
    )


@router.post("/projects/{project_id}/document-groups", response_model=DocumentGroupRead, status_code=201)
def create_document_group(
    payload: DocumentGroupCreate,
    project: Project = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
):
    group = DocumentGroup(project_id=project.id, **payload.model_dump())
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.patch("/document-groups/{group_id}", response_model=DocumentGroupRead)
def update_document_group(
    group_id: uuid.UUID,
    payload: DocumentGroupUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    group = db.get(DocumentGroup, group_id)
    if not group:
        raise HTTPException(404, "Document group not found")
    if not has_role_at_least(db, group.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, key, value)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/document-groups/{group_id}", status_code=204)
def delete_document_group(
    group_id: uuid.UUID,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    group = db.get(DocumentGroup, group_id)
    if not group:
        raise HTTPException(404, "Document group not found")
    if not has_role_at_least(db, group.project_id, user.id, "editor"):
        raise HTTPException(403, "Requires at least 'editor' role on this project.")
    # Ungroup its documents rather than relying only on the DB's ON DELETE
    # SET NULL — this commits in the same transaction as the group's
    # deletion either way, but stays correct even if the FK was created
    # before `ondelete` existed on an already-running dev database.
    db.query(Document).filter(Document.group_id == group_id).update({"group_id": None})
    db.delete(group)
    db.commit()


@router.get("/projects/{project_id}/access", response_model=list[ProjectAccessRead])
def list_project_access(
    project: Project = Depends(require_project_read), db: Session = Depends(get_db)
):
    return db.query(ProjectAccess).filter(ProjectAccess.project_id == project.id).all()


@router.post("/projects/{project_id}/access", response_model=ProjectAccessRead, status_code=201)
def grant_project_access(
    payload: ProjectAccessCreate,
    project: Project = Depends(require_project_role("admin")),
    db: Session = Depends(get_db),
):
    if payload.role not in ROLES:
        raise HTTPException(422, f"Role must be one of: {', '.join(ROLES)}.")
    grant = ProjectAccess(project_id=project.id, **payload.model_dump())
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant


@router.delete("/project-access/{grant_id}", status_code=204)
def revoke_project_access(
    grant_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    grant = db.get(ProjectAccess, grant_id)
    if not grant:
        raise HTTPException(404, "Access grant not found")
    if not has_role_at_least(db, grant.project_id, user.id, "admin"):
        raise HTTPException(403, "Requires 'admin' role on this project.")
    db.delete(grant)
    db.commit()
