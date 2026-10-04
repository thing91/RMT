"""Roadmap: improvement ideas, votes, official replies, release notes."""

import difflib
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_user
from app.models.idea import IDEA_CATEGORIES, IDEA_HORIZONS, Idea, IdeaComment, IdeaVote, ReleaseNote
from app.models.notification import Subscription
from app.models.user import User
from app.services import audit
from app.services import ideas as svc
from app.services import workflow_engine as wf
from app.services.notifications import is_watching, notify, unwatch, watch, watcher_count, watchers
from app.services.workflow_templates import SYSTEM_WORKFLOWS

router = APIRouter(prefix="/roadmap", tags=["roadmap"])
SPEC = SYSTEM_WORKFLOWS["idea"]


class IdeaCreate(BaseModel):
    title: str
    description: str = ""
    category: str = "Other"


class IdeaUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    horizon: str | None = None
    priority: str | None = None
    effort: str | None = None
    internal_note: str | None = None


class IdeaRead(BaseModel):
    id: uuid.UUID
    number: int
    key: str
    title: str
    description: str
    category: str
    status: str
    status_label: str
    horizon: str | None
    votes: int
    comments: int
    voted: bool
    watching: bool
    mine: bool
    author: str
    organization: str
    created_at: datetime
    updated_at: datetime
    status_changed_at: datetime
    duplicate_of: dict | None = None
    release: dict | None = None
    # Product team only:
    priority: str | None = None
    effort: str | None = None
    internal_note: str | None = None


class IdeaDetail(IdeaRead):
    watchers: int
    timeline: list[dict]
    can_manage: bool
    can_edit: bool


class CommentIn(BaseModel):
    body: str
    official: bool = False
    parent_id: uuid.UUID | None = None


class CommentRead(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    author: str
    official: bool
    body: str
    created_at: datetime
    mine: bool


class ReleaseNoteIn(BaseModel):
    version: str
    title: str
    body: str | None = None


class ReleaseNoteRead(BaseModel):
    id: uuid.UUID
    version: str
    title: str
    body: str | None
    released_at: datetime
    ideas: list[dict] = []


def _counts(db: Session, ids: list[uuid.UUID]) -> tuple[dict, dict]:
    if not ids:
        return {}, {}
    votes = dict(
        db.query(IdeaVote.idea_id, func.count(IdeaVote.id)).filter(IdeaVote.idea_id.in_(ids)).group_by(IdeaVote.idea_id).all()
    )
    comments = dict(
        db.query(IdeaComment.idea_id, func.count(IdeaComment.id))
        .filter(IdeaComment.idea_id.in_(ids))
        .group_by(IdeaComment.idea_id)
        .all()
    )
    return votes, comments


def _read(db: Session, idea: Idea, user: User, votes: dict, comments: dict, my_votes: set, my_watch: set) -> IdeaRead:
    manager = svc.is_manager(db, user)
    visible = svc.can_see_origin(db, user, idea)
    return IdeaRead(
        id=idea.id,
        number=idea.number,
        key=f"IDEA-{idea.number}",
        title=idea.title,
        description=idea.description,
        category=idea.category,
        status=idea.status,
        status_label=wf.state_label(SPEC, idea.status),
        horizon=idea.horizon,
        votes=votes.get(idea.id, 0),
        comments=comments.get(idea.id, 0),
        voted=idea.id in my_votes,
        watching=idea.id in my_watch,
        mine=idea.author_id == user.id,
        author=idea.author.display_name if visible else "A user",
        organization=idea.organization.name if visible else svc.HIDDEN_ORG,
        created_at=idea.created_at,
        updated_at=idea.updated_at,
        status_changed_at=idea.status_changed_at,
        duplicate_of=(
            {"id": str(idea.duplicate_of.id), "key": f"IDEA-{idea.duplicate_of.number}", "title": idea.duplicate_of.title}
            if idea.duplicate_of
            else None
        ),
        release=(
            {"id": str(idea.release_note.id), "version": idea.release_note.version, "title": idea.release_note.title}
            if idea.release_note
            else None
        ),
        priority=idea.priority if manager else None,
        effort=idea.effort if manager else None,
        internal_note=idea.internal_note if manager else None,
    )


def _mine(db: Session, user: User) -> tuple[set, set]:
    my_votes = {v for (v,) in db.query(IdeaVote.idea_id).filter(IdeaVote.user_id == user.id).all()}
    my_watch = {
        s for (s,) in db.query(Subscription.subject_id).filter_by(user_id=user.id, subject_type="idea").all()
    }
    return my_votes, my_watch


def _read_many(db: Session, ideas: list[Idea], user: User) -> list[IdeaRead]:
    votes, comments = _counts(db, [i.id for i in ideas])
    my_votes, my_watch = _mine(db, user)
    return [_read(db, i, user, votes, comments, my_votes, my_watch) for i in ideas]


def _idea(db: Session, idea_id: uuid.UUID) -> Idea:
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    return idea


@router.get("/meta")
def meta(user: User = Depends(require_user), db: Session = Depends(get_db)):
    return {
        "categories": list(IDEA_CATEGORIES),
        "horizons": list(IDEA_HORIZONS),
        "states": SPEC["states"],
        "can_manage": svc.is_manager(db, user),
    }


@router.get("/ideas")
def list_ideas(
    status: str | None = None,
    category: str | None = None,
    q: str | None = None,
    mine: bool = False,
    watched: bool = False,
    sort: str = "votes",
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """List with status facets (counts reflect every filter except status)."""
    base = db.query(Idea)
    if category:
        base = base.filter(Idea.category == category)
    if mine:
        base = base.filter(Idea.author_id == user.id)
    if watched:
        _, my_watch = _mine(db, user)
        base = base.filter(Idea.id.in_(my_watch or [uuid.uuid4()]))
    if q and q.strip():
        tsq = func.plainto_tsquery("simple", q.strip())
        doc = func.to_tsvector("simple", func.coalesce(Idea.title, "") + " " + func.coalesce(Idea.description, ""))
        base = base.filter(or_(doc.op("@@")(tsq), Idea.title.ilike(f"%{q.strip()}%")))
    facets = dict(base.with_entities(Idea.status, func.count(Idea.id)).group_by(Idea.status).all())
    rows = base.filter(Idea.status.in_(status.split(","))).all() if status else base.all()
    items = _read_many(db, rows, user)
    key = {
        "votes": lambda i: (-i.votes, -i.created_at.timestamp()),
        "new": lambda i: -i.created_at.timestamp(),
        "updated": lambda i: -i.updated_at.timestamp(),
    }.get(sort, lambda i: -i.votes)
    items.sort(key=key)
    return {
        "items": items,
        "facets": [
            {"status": s["key"], "label": s["label"], "count": facets.get(s["key"], 0)} for s in SPEC["states"]
        ],
    }


@router.get("/board")
def board(category: str | None = None, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Kanban: Planned / In progress / Released, each idea tagged Now/Next/Later."""
    q = db.query(Idea).filter(Idea.status.in_(("planned", "in_progress", "released")))
    if category:
        q = q.filter(Idea.category == category)
    items = _read_many(db, q.all(), user)
    order = {"now": 0, "next": 1, "later": 2, None: 3}
    columns = {}
    for status in ("planned", "in_progress", "released"):
        col = [i for i in items if i.status == status]
        col.sort(key=lambda i: (order.get(i.horizon, 3), -i.votes) if status != "released" else -i.status_changed_at.timestamp())
        columns[status] = col
    return columns


@router.get("/ideas/similar", response_model=list[IdeaRead])
def similar(title: str, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Existing ideas whose title resembles what's being typed — offered
    as "vote for this instead" before a duplicate gets created."""
    words = {w for w in re.findall(r"\w{3,}", title.lower())}
    if not words:
        return []
    candidates = db.query(Idea).filter(Idea.status != "duplicate").all()
    scored = []
    for idea in candidates:
        t = idea.title.lower()
        overlap = len(words & set(re.findall(r"\w{3,}", t))) / len(words)
        ratio = difflib.SequenceMatcher(a=title.lower(), b=t).ratio()
        score = max(overlap, ratio)
        if score >= 0.45:
            scored.append((score, idea))
    scored.sort(key=lambda x: -x[0])
    return _read_many(db, [i for _, i in scored[:5]], user)


@router.post("/ideas", response_model=IdeaRead, status_code=201)
def create_idea(payload: IdeaCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    title = payload.title.strip()
    if len(title) < 5:
        raise HTTPException(422, "Give the idea a descriptive title (at least 5 characters).")
    if payload.category not in IDEA_CATEGORIES:
        raise HTTPException(422, f"category must be one of {IDEA_CATEGORIES}")
    idea = Idea(
        number=svc.next_number(db),
        title=title,
        description=payload.description.strip(),
        category=payload.category,
        status=wf.initial_state(SPEC),
        author_id=user.id,
        org_id=user.org_id,
    )
    db.add(idea)
    db.flush()
    watch(db, user, "idea", idea.id)
    audit.log(db, action="idea.create", subject_type="idea", subject_id=idea.id, actor=user,
              summary=f"IDEA-{idea.number} submitted")
    managers = [u for u in db.query(User).all() if svc.is_manager(db, u)]
    notify(db, managers, kind="idea.new", title=f"New idea IDEA-{idea.number}: {title[:80]}",
           body=payload.description[:300], url=f"/roadmap/ideas/{idea.id}", actor=user,
           subject_type="idea", subject_id=idea.id, email=False)
    db.commit()
    db.refresh(idea)
    return _read_many(db, [idea], user)[0]


@router.get("/ideas/{idea_id}", response_model=IdeaDetail)
def get_idea(idea_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    base = _read_many(db, [idea], user)[0]
    timeline = []
    for e in wf.history(db, "idea", idea.id):
        p = e.payload or {}
        timeline.append(
            {
                "at": e.created_at,
                "actor": (e.actor.display_name if e.actor else "System")
                if (e.actor is None or svc.can_see_origin(db, user, idea) or svc.is_manager(db, e.actor))
                else "A user",
                "from": p.get("from_label"),
                "to": p.get("to_label"),
                "comment": p.get("comment"),
                "notes": p.get("notes") or {},
            }
        )
    manager = svc.is_manager(db, user)
    return IdeaDetail(
        **base.model_dump(),
        watchers=watcher_count(db, "idea", idea.id),
        timeline=[{"at": idea.created_at, "actor": base.author, "from": None, "to": "Submitted",
                   "comment": None, "notes": {}}] + timeline,
        can_manage=manager,
        can_edit=manager or (idea.author_id == user.id and idea.status in ("submitted", "needs_info")),
    )


@router.patch("/ideas/{idea_id}", response_model=IdeaDetail)
def update_idea(idea_id: uuid.UUID, payload: IdeaUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    manager = svc.is_manager(db, user)
    data = payload.model_dump(exclude_unset=True)
    internal = {"horizon", "priority", "effort", "internal_note"}
    if internal & data.keys() and not manager:
        raise HTTPException(403, "Only the product team can set horizon, priority, effort or internal notes.")
    if {"title", "description", "category"} & data.keys():
        if not (manager or (idea.author_id == user.id and idea.status in ("submitted", "needs_info"))):
            raise HTTPException(403, "Only the author (before review) or the product team can edit the idea.")
    if data.get("category") and data["category"] not in IDEA_CATEGORIES:
        raise HTTPException(422, "Unknown category.")
    if "horizon" in data and data["horizon"] not in (None, *IDEA_HORIZONS):
        raise HTTPException(422, "horizon must be now, next or later.")
    for k, v in data.items():
        setattr(idea, k, v.strip() if isinstance(v, str) and k in ("title", "description") else v)
    db.commit()
    return get_idea(idea_id, user, db)


@router.post("/ideas/{idea_id}/vote", response_model=IdeaRead)
def vote(idea_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    if idea.status in ("duplicate", "declined", "released"):
        raise HTTPException(409, "Voting is closed for this idea.")
    if not db.query(IdeaVote).filter_by(idea_id=idea.id, user_id=user.id).first():
        db.add(IdeaVote(idea_id=idea.id, user_id=user.id))
        watch(db, user, "idea", idea.id)  # voting follows the idea (can be turned off)
    db.commit()
    return _read_many(db, [idea], user)[0]


@router.delete("/ideas/{idea_id}/vote", response_model=IdeaRead)
def unvote(idea_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    db.query(IdeaVote).filter_by(idea_id=idea.id, user_id=user.id).delete()
    db.commit()
    return _read_many(db, [idea], user)[0]


@router.post("/ideas/{idea_id}/watch", response_model=IdeaRead)
def toggle_watch(idea_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    if is_watching(db, user, "idea", idea.id):
        unwatch(db, user, "idea", idea.id)
    else:
        watch(db, user, "idea", idea.id)
    db.commit()
    return _read_many(db, [idea], user)[0]


@router.get("/ideas/{idea_id}/comments", response_model=list[CommentRead])
def list_comments(idea_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    rows = db.query(IdeaComment).filter_by(idea_id=idea.id).order_by(IdeaComment.created_at).all()
    out = []
    for c in rows:
        visible = c.official or c.author.org_id == user.org_id or svc.is_manager(db, user)
        out.append(
            CommentRead(
                id=c.id, parent_id=c.parent_id, official=c.official, body=c.body, created_at=c.created_at,
                author=("Product team · " if c.official else "") + (c.author.display_name if visible else "A user"),
                mine=c.author_id == user.id,
            )
        )
    return out


@router.post("/ideas/{idea_id}/comments", response_model=CommentRead, status_code=201)
def add_comment(idea_id: uuid.UUID, payload: CommentIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    idea = _idea(db, idea_id)
    body = payload.body.strip()
    if not body:
        raise HTTPException(422, "Comment can't be empty.")
    if payload.official and not svc.is_manager(db, user):
        raise HTTPException(403, "Only the product team can post an official reply.")
    if payload.parent_id:
        parent = db.get(IdeaComment, payload.parent_id)
        if not parent or parent.idea_id != idea.id or parent.parent_id is not None:
            raise HTTPException(422, "Reply to a top-level comment of this idea.")
    c = IdeaComment(idea_id=idea.id, parent_id=payload.parent_id, author_id=user.id, body=body, official=payload.official)
    db.add(c)
    db.flush()
    if payload.official:
        svc.notify_official_reply(db, idea, user, body)
    else:
        notify(db, watchers(db, "idea", idea.id), kind="idea.comment",
               title=f"New comment on IDEA-{idea.number}", body=body[:300], url=f"/roadmap/ideas/{idea.id}",
               actor=user, subject_type="idea", subject_id=idea.id, email=False)
    watch(db, user, "idea", idea.id)
    # The submitter answering a "needs info" question sends it back to review.
    if idea.status == "needs_info" and idea.author_id == user.id:
        wf.execute(db, svc.IdeaSubject(db, idea), "info_provided", user, comment=body, system=True)
    db.commit()
    db.refresh(c)
    return CommentRead(id=c.id, parent_id=c.parent_id, official=c.official, body=c.body, created_at=c.created_at,
                       author=("Product team · " if c.official else "") + user.display_name, mine=True)


@router.get("/release-notes", response_model=list[ReleaseNoteRead])
def release_notes(user: User = Depends(require_user), db: Session = Depends(get_db)):
    notes = db.query(ReleaseNote).order_by(ReleaseNote.released_at.desc()).all()
    out = []
    for n in notes:
        ideas = db.query(Idea).filter(Idea.release_note_id == n.id).all()
        out.append(ReleaseNoteRead(
            id=n.id, version=n.version, title=n.title, body=n.body, released_at=n.released_at,
            ideas=[{"id": str(i.id), "key": f"IDEA-{i.number}", "title": i.title} for i in ideas],
        ))
    return out


@router.post("/release-notes", response_model=ReleaseNoteRead, status_code=201)
def add_release_note(payload: ReleaseNoteIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if not svc.is_manager(db, user):
        raise HTTPException(403, "Only the product team can publish release notes.")
    n = ReleaseNote(version=payload.version.strip(), title=payload.title.strip(), body=payload.body, created_by_id=user.id)
    db.add(n)
    db.commit()
    db.refresh(n)
    return ReleaseNoteRead(id=n.id, version=n.version, title=n.title, body=n.body, released_at=n.released_at)
