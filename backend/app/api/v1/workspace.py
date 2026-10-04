"""Workspace endpoints behind the simplified UI: global search (Ctrl+K),
"my work" (what is waiting for the signed-in user) and a project overview
(document progress + recent activity)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.audit import AuditEvent
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.link import Link
from app.models.project import Project
from app.models.project_access import ProjectAccess
from app.models.suggestion import Suggestion
from app.models.user import User
from app.models.workflow import DocumentWorkflowRole
from app.models.workflow_def import ChangeRequest, Review, ReviewParticipant
from app.services import workflow_engine as wf
from app.services.permissions import can_read, get_effective_role, has_permission, is_org_admin

router = APIRouter(tags=["workspace"])


class SearchHit(BaseModel):
    kind: str  # item | document | review | suggestion | project
    id: uuid.UUID
    key: str | None
    title: str
    subtitle: str | None
    project_id: uuid.UUID
    document_id: uuid.UUID | None = None
    status: str | None = None


class WorkEntry(BaseModel):
    kind: str  # approve | vote | suggestion | reverify | change_request
    id: uuid.UUID
    key: str | None
    title: str
    detail: str | None
    project_id: uuid.UUID
    document_id: uuid.UUID | None = None
    item_id: uuid.UUID | None = None
    review_id: uuid.UUID | None = None
    since: datetime | None = None


class MyWork(BaseModel):
    counts: dict[str, int]
    entries: list[WorkEntry]


def _readable_projects(db: Session, user: User | None, project_id: uuid.UUID | None) -> list[Project]:
    q = db.query(Project)
    if project_id:
        q = q.filter(Project.id == project_id)
    elif user is not None:
        q = q.filter(Project.org_id == user.org_id)
    return [p for p in q.all() if can_read(db, p, user.id if user else None)]


@router.get("/search", response_model=list[SearchHit])
def search(
    q: str,
    project_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if len(term) < 2:
        return []
    projects = _readable_projects(db, user, project_id)
    if not projects:
        return []
    by_id = {p.id: p for p in projects}
    ids = list(by_id)
    like = f"%{term}%"
    hits: list[SearchHit] = []

    items = (
        db.query(Item, Document)
        .join(Document, Item.document_id == Document.id)
        .join(ItemType, Item.item_type_id == ItemType.id)
        .filter(Document.project_id.in_(ids), ItemType.behavior == "content", Item.obsolete_at.is_(None))
        .filter(or_(Item.key.ilike(like), Item.title.ilike(like), Item.description_md.ilike(like)))
        .order_by(
            # Exact key first, then key matches, then title matches.
            (func.lower(Item.key) == term.lower()).desc(),
            Item.key.ilike(like).desc(),
            Item.title.ilike(like).desc(),
            Item.key,
        )
        .limit(12)
        .all()
    )
    for item, doc in items:
        project = by_id[doc.project_id]
        hits.append(SearchHit(
            kind="item", id=item.id, key=item.key, title=item.title,
            subtitle=f"{doc.name}" + ("" if project_id else f" · {project.name}"),
            project_id=project.id, document_id=doc.id, status=(item.attributes or {}).get("status"),
        ))
    for doc in (db.query(Document).filter(Document.project_id.in_(ids), Document.name.ilike(like))
                .order_by(Document.name).limit(5).all()):
        hits.append(SearchHit(kind="document", id=doc.id, key=None, title=doc.name,
                              subtitle=by_id[doc.project_id].name, project_id=doc.project_id, document_id=doc.id))
    for r in (db.query(Review).filter(Review.project_id.in_(ids), or_(Review.key.ilike(like), Review.title.ilike(like)))
              .order_by(Review.created_at.desc()).limit(5).all()):
        hits.append(SearchHit(kind="review", id=r.id, key=r.key, title=r.title, subtitle=by_id[r.project_id].name,
                              project_id=r.project_id, status=r.status))
    for s in (db.query(Suggestion).filter(Suggestion.project_id.in_(ids),
                                          or_(Suggestion.key.ilike(like), Suggestion.rationale.ilike(like)))
              .order_by(Suggestion.created_at.desc()).limit(5).all()):
        hits.append(SearchHit(kind="suggestion", id=s.id, key=s.key, title=s.rationale[:120],
                              subtitle=f"{s.item.key or s.item.title[:40]}", project_id=s.project_id,
                              document_id=s.item.document_id, status=s.status))
    if not project_id:
        for p in projects:
            if term.lower() in p.name.lower():
                hits.append(SearchHit(kind="project", id=p.id, key=p.key_prefix, title=p.name,
                                      subtitle="library" if p.kind == "library" else None, project_id=p.id))
    return hits


def _my_work(db: Session, user: User, project: Project) -> list[WorkEntry]:
    entries: list[WorkEntry] = []
    pid = project.id
    role = get_effective_role(db, pid, user.id)
    if role is None and not is_org_admin(user):
        return entries

    # Requirements this user can approve right now.
    approver_docs = {
        d for (d,) in db.query(DocumentWorkflowRole.document_id)
        .filter(DocumentWorkflowRole.user_id == user.id, DocumentWorkflowRole.role == "approver").all()
    }
    is_admin = role == "admin" or is_org_admin(user)
    candidates = (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == pid, Item.obsolete_at.is_(None),
                Item.attributes["status"].astext.in_(("review",)))
        .all()
    )
    for item in candidates:
        if not (is_admin or item.document_id in approver_docs):
            continue
        subject = wf.ItemSubject(db, item)
        if subject.definition() is None:
            continue
        options = {o.key: o for o in wf.available_transitions(db, subject, user)}
        if "approve" in options and options["approve"].allowed:
            entries.append(WorkEntry(kind="approve", id=item.id, key=item.key, title=item.title,
                                     detail=item.document.name, project_id=pid, document_id=item.document_id,
                                     item_id=item.id, since=item.updated_at))

    # Open reviews waiting for my vote.
    for part, review in (
        db.query(ReviewParticipant, Review).join(Review, ReviewParticipant.review_id == Review.id)
        .filter(Review.project_id == pid, Review.status == "open", ReviewParticipant.user_id == user.id,
                ReviewParticipant.vote.is_(None)).all()
    ):
        entries.append(WorkEntry(kind="vote", id=review.id, key=review.key, title=review.title,
                                 detail=f"{len(review.items)} items", project_id=pid, review_id=review.id,
                                 since=review.created_at))

    # Suggestions I may resolve (owner of the requirement, or resolver permission), not my own.
    can_resolve_all = has_permission(db, pid, user, "suggestion.resolve")
    for s in (db.query(Suggestion).filter(Suggestion.project_id == pid,
                                          Suggestion.status.in_(("open", "outdated"))).all()):
        if s.author_id == user.id:
            continue
        owner = (s.item.attributes or {}).get("owner")
        if can_resolve_all or owner == user.username:
            entries.append(WorkEntry(kind="suggestion", id=s.id, key=s.key, title=s.rationale[:140],
                                     detail=s.item.key, project_id=pid, document_id=s.item.document_id,
                                     item_id=s.item_id, since=s.created_at))

    # Links to re-verify on requirements I own.
    links = (
        db.query(Link).join(Item, Link.source_item_id == Item.id).join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == pid, Link.suspect.is_(True)).all()
    )
    for link in links:
        other = link.target_item if link.suspect_item_id == link.source_item_id else link.source_item
        if (other.attributes or {}).get("owner") == user.username or is_admin:
            entries.append(WorkEntry(kind="reverify", id=link.id, key=other.key, title=other.title,
                                     detail=link.suspect_reason, project_id=pid, document_id=other.document_id,
                                     item_id=other.id, since=link.suspect_since))

    # Change requests waiting for a decision I can make.
    for cr in db.query(ChangeRequest).filter(ChangeRequest.project_id == pid, ChangeRequest.status == "open").all():
        if is_admin or cr.item.document_id in approver_docs:
            entries.append(WorkEntry(kind="change_request", id=cr.id, key=cr.key, title=cr.item.title,
                                     detail=cr.reason[:140], project_id=pid, document_id=cr.item.document_id,
                                     item_id=cr.item_id, since=cr.created_at))
    return entries


def _counts(entries: list[WorkEntry]) -> dict[str, int]:
    counts = {k: 0 for k in ("approve", "vote", "suggestion", "reverify", "change_request")}
    for e in entries:
        counts[e.kind] += 1
    return counts


@router.get("/projects/{project_id}/my-work", response_model=MyWork)
def project_my_work(project_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id):
        raise HTTPException(404, "Project not found")
    entries = _my_work(db, user, project)
    entries.sort(key=lambda e: e.since or datetime.min.replace(tzinfo=None), reverse=False)
    return MyWork(counts=_counts(entries), entries=entries)


@router.get("/me/work-summary")
def work_summary(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """{project_id: number of things waiting} for the projects list."""
    member_projects = {
        g.project_id for g in db.query(ProjectAccess).filter_by(subject_type="user", subject_id=user.id).all()
    }
    out: dict[str, int] = {}
    for p in db.query(Project).filter(Project.org_id == user.org_id).all():
        if p.id not in member_projects and not is_org_admin(user):
            continue
        n = len(_my_work(db, user, p))
        if n:
            out[str(p.id)] = n
    return out


@router.get("/projects/{project_id}/overview")
def project_overview(
    project_id: uuid.UUID, user: User | None = Depends(get_current_user), db: Session = Depends(get_db)
):
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    docs = db.query(Document).filter(Document.project_id == project_id).order_by(Document.order).all()
    rows = (
        db.query(Item.document_id, Item.attributes["status"].astext, func.count(Item.id))
        .join(ItemType, Item.item_type_id == ItemType.id)
        .join(Document, Item.document_id == Document.id)
        .filter(Document.project_id == project_id, ItemType.behavior == "content", Item.obsolete_at.is_(None))
        .group_by(Item.document_id, Item.attributes["status"].astext)
        .all()
    )
    by_doc: dict[uuid.UUID, dict[str, int]] = {}
    for doc_id, status, n in rows:
        by_doc.setdefault(doc_id, {})[status or "none"] = n
    activity = []
    if user is not None and has_permission(db, project_id, user, "audit.read"):
        for e in (db.query(AuditEvent).filter(AuditEvent.project_id == project_id)
                  .order_by(AuditEvent.created_at.desc()).limit(12).all()):
            activity.append({
                "at": e.created_at.isoformat(), "actor": e.actor.display_name if e.actor else None,
                "action": e.action, "summary": e.summary, "subject_type": e.subject_type,
                "subject_id": str(e.subject_id) if e.subject_id else None,
                "transition": (e.payload or {}).get("transition_label"),
                "to": (e.payload or {}).get("to_label"),
            })
    return {
        "documents": [
            {"id": str(d.id), "name": d.name, "group_id": str(d.group_id) if d.group_id else None,
             "statuses": by_doc.get(d.id, {}), "total": sum(by_doc.get(d.id, {}).values())}
            for d in docs
        ],
        "activity": activity,
    }
