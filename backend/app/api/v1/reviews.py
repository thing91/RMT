"""Reviews as their own object (workflow FR5): status separate from the
items' statuses, many items per review (pinned to the reviewed version),
required reviewers with votes, configurable close conditions."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_user
from app.models.item import Item
from app.models.project import Project
from app.models.user import User
from app.models.workflow_def import REVIEW_VOTES, Review, ReviewItem, ReviewParticipant
from app.services import audit
from app.services import workflow_engine as wf
from app.services.git_sync import sync_item
from app.services.keys import next_key
from app.services.notifications import notify, watch, watchers
from app.services.permissions import can_read, has_permission

router = APIRouter(tags=["reviews"])


class ParticipantIn(BaseModel):
    user_id: uuid.UUID
    required: bool = True


class ReviewCreate(BaseModel):
    title: str
    description: str | None = None
    item_ids: list[uuid.UUID] = []
    participants: list[ParticipantIn] = []
    close_requires_resolved: str = "major"  # none | major | all
    require_all_votes: bool = True
    due_date: datetime | None = None


class ReviewUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    close_requires_resolved: str | None = None
    require_all_votes: bool | None = None
    due_date: datetime | None = None


class ItemIds(BaseModel):
    item_ids: list[uuid.UUID]


class VoteIn(BaseModel):
    vote: str
    comment: str | None = None


class CloseIn(BaseModel):
    outcome: str = "completed"  # completed | approved | rejected | ...
    comment: str | None = None
    # Optionally run this workflow transition on every reviewed item that
    # allows it (e.g. "approve") as part of closing.
    apply_transition: str | None = None
    password: str | None = None


class ReviewItemRead(BaseModel):
    item_id: uuid.UUID
    document_id: uuid.UUID
    key: str | None
    title: str
    reviewed_version: int
    current_version: int
    changed_since: bool
    status: str | None
    open_suggestions: int = 0


class ParticipantRead(BaseModel):
    user_id: uuid.UUID
    name: str
    required: bool
    vote: str | None
    vote_comment: str | None
    voted_at: datetime | None


class ReviewRead(BaseModel):
    id: uuid.UUID
    key: str
    project_id: uuid.UUID
    title: str
    description: str | None
    status: str
    outcome: str | None
    close_requires_resolved: str
    require_all_votes: bool
    created_by: str | None
    created_at: datetime
    closed_by: str | None
    closed_at: datetime | None
    due_date: datetime | None
    item_count: int
    votes_in: int
    votes_required: int


class ReviewDetail(ReviewRead):
    items: list[ReviewItemRead]
    participants: list[ParticipantRead]
    close_blockers: list[str]
    can_manage: bool
    my_vote: str | None
    i_am_participant: bool


class CloseResult(BaseModel):
    review: ReviewDetail
    applied: list[str] = []
    skipped: list[str] = []


def _project(db: Session, project_id: uuid.UUID, user: User | None) -> Project:
    project = db.get(Project, project_id)
    if not project or not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Project not found")
    return project


def _review(db: Session, review_id: uuid.UUID, user: User | None) -> Review:
    review = db.get(Review, review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    _project(db, review.project_id, user)
    return review


def _require_manage(db: Session, review: Review, user: User | None) -> User:
    if user is None or not (
        has_permission(db, review.project_id, user, "review.manage") or review.created_by_id == user.id
    ):
        raise HTTPException(403, "Requires the 'review.manage' permission on this project.")
    return user


def _open_suggestion_counts(db: Session, review: Review) -> dict[uuid.UUID, dict[str, int]]:
    """{item_id: {"major": n, "minor": n}} of still-open suggestions linked
    to this review (or, for items without review-linked ones, open on the
    item at all)."""
    try:
        from app.models.suggestion import Suggestion
    except ImportError:  # pragma: no cover — suggestions module not present
        return {}
    rows = (
        db.query(Suggestion)
        .filter(Suggestion.review_id == review.id, Suggestion.status.in_(("open", "outdated")))
        .all()
    )
    counts: dict[uuid.UUID, dict[str, int]] = {}
    for s in rows:
        c = counts.setdefault(s.item_id, {"major": 0, "minor": 0})
        c[s.severity] = c.get(s.severity, 0) + 1
    return counts


def close_blockers(db: Session, review: Review) -> list[str]:
    blockers: list[str] = []
    if review.require_all_votes:
        missing = [p.user.display_name for p in review.participants if p.required and not p.vote]
        if missing:
            blockers.append("Waiting for votes from: " + ", ".join(missing))
    if review.close_requires_resolved in ("major", "all"):
        counts = _open_suggestion_counts(db, review)
        major = sum(c.get("major", 0) for c in counts.values())
        minor = sum(c.get("minor", 0) for c in counts.values())
        if major:
            blockers.append(f"{major} open Major suggestion(s) must be resolved first.")
        if review.close_requires_resolved == "all" and minor:
            blockers.append(f"{minor} open Minor suggestion(s) must be resolved first.")
    return blockers


def _read(db: Session, review: Review) -> ReviewRead:
    required = [p for p in review.participants if p.required]
    return ReviewRead(
        id=review.id,
        key=review.key,
        project_id=review.project_id,
        title=review.title,
        description=review.description,
        status=review.status,
        outcome=review.outcome,
        close_requires_resolved=review.close_requires_resolved,
        require_all_votes=review.require_all_votes,
        created_by=review.created_by.display_name if review.created_by else None,
        created_at=review.created_at,
        closed_by=review.closed_by.display_name if review.closed_by else None,
        closed_at=review.closed_at,
        due_date=review.due_date,
        item_count=len(review.items),
        votes_in=sum(1 for p in required if p.vote),
        votes_required=len(required),
    )


def _detail(db: Session, review: Review, user: User | None) -> ReviewDetail:
    counts = _open_suggestion_counts(db, review)
    items = []
    for ri in sorted(review.items, key=lambda r: (r.item.key or "", r.item.title)):
        it = ri.item
        c = counts.get(it.id, {})
        items.append(
            ReviewItemRead(
                item_id=it.id,
                document_id=it.document_id,
                key=it.key,
                title=it.title,
                reviewed_version=ri.item_version,
                current_version=it.version,
                changed_since=it.version != ri.item_version,
                status=(it.attributes or {}).get("status"),
                open_suggestions=sum(c.values()),
            )
        )
    me = next((p for p in review.participants if user and p.user_id == user.id), None)
    return ReviewDetail(
        **_read(db, review).model_dump(),
        items=items,
        participants=[
            ParticipantRead(
                user_id=p.user_id,
                name=p.user.display_name,
                required=p.required,
                vote=p.vote,
                vote_comment=p.vote_comment,
                voted_at=p.voted_at,
            )
            for p in review.participants
        ],
        close_blockers=close_blockers(db, review) if review.status == "open" else [],
        can_manage=bool(
            user and (has_permission(db, review.project_id, user, "review.manage") or review.created_by_id == user.id)
        ),
        my_vote=me.vote if me else None,
        i_am_participant=me is not None,
    )


def _route(review: Review) -> str:
    return f"/projects/{review.project_id}/reviews/{review.id}"


def _add_items(db: Session, review: Review, item_ids: list[uuid.UUID]) -> None:
    existing = {ri.item_id for ri in review.items}
    for item_id in item_ids:
        if item_id in existing:
            continue
        item = db.get(Item, item_id)
        if not item or item.document.project_id != review.project_id:
            raise HTTPException(422, f"Item {item_id} isn't in this project.")
        review.items.append(ReviewItem(item_id=item.id, item_version=item.version))
        existing.add(item_id)


@router.get("/projects/{project_id}/reviews", response_model=list[ReviewRead])
def list_reviews(
    project_id: uuid.UUID,
    status: str | None = None,
    item_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project(db, project_id, user)
    q = db.query(Review).filter(Review.project_id == project_id)
    if status:
        q = q.filter(Review.status == status)
    if item_id:
        q = q.join(ReviewItem, ReviewItem.review_id == Review.id).filter(ReviewItem.item_id == item_id)
    return [_read(db, r) for r in q.order_by(Review.created_at.desc()).all()]


@router.post("/projects/{project_id}/reviews", response_model=ReviewDetail, status_code=201)
def create_review(
    project_id: uuid.UUID,
    payload: ReviewCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    _project(db, project_id, user)
    if not has_permission(db, project_id, user, "review.manage"):
        raise HTTPException(403, "Requires the 'review.manage' permission on this project.")
    if payload.close_requires_resolved not in ("none", "major", "all"):
        raise HTTPException(422, "close_requires_resolved must be none, major or all.")
    review = Review(
        project_id=project_id,
        key=next_key(db, project_id, "REV"),
        title=payload.title.strip() or "Review",
        description=payload.description,
        close_requires_resolved=payload.close_requires_resolved,
        require_all_votes=payload.require_all_votes,
        created_by_id=user.id,
        due_date=payload.due_date,
    )
    db.add(review)
    db.flush()
    _add_items(db, review, payload.item_ids)
    for p in payload.participants:
        if not db.get(User, p.user_id):
            raise HTTPException(404, "Participant not found")
        review.participants.append(ReviewParticipant(user_id=p.user_id, required=p.required))
        watch(db, p.user_id, "review", review.id)
    watch(db, user, "review", review.id)
    db.flush()
    audit.log(
        db, action="review.create", subject_type="review", subject_id=review.id, actor=user,
        project_id=project_id, summary=f"{review.key} '{review.title}' opened with {len(review.items)} item(s)",
    )
    notify(
        db,
        [p.user for p in review.participants],
        kind="review.invited",
        title=f"{review.key}: you're invited to review '{review.title}'",
        body=f"{user.display_name} asked you to review {len(review.items)} item(s)."
        + (f" Due {review.due_date:%Y-%m-%d}." if review.due_date else ""),
        url=_route(review),
        actor=user,
        subject_type="review",
        subject_id=review.id,
        badge="Review",
    )
    db.commit()
    db.refresh(review)
    return _detail(db, review, user)


@router.get("/reviews/{review_id}", response_model=ReviewDetail)
def get_review(review_id: uuid.UUID, user: User | None = Depends(get_current_user), db: Session = Depends(get_db)):
    return _detail(db, _review(db, review_id, user), user)


@router.patch("/reviews/{review_id}", response_model=ReviewDetail)
def update_review(
    review_id: uuid.UUID, payload: ReviewUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    data = payload.model_dump(exclude_unset=True)
    if data.get("close_requires_resolved") not in (None, "none", "major", "all"):
        raise HTTPException(422, "close_requires_resolved must be none, major or all.")
    for k, v in data.items():
        setattr(review, k, v)
    db.commit()
    return _detail(db, review, user)


@router.post("/reviews/{review_id}/items", response_model=ReviewDetail)
def add_review_items(
    review_id: uuid.UUID, payload: ItemIds, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    if review.status != "open":
        raise HTTPException(409, "This review is closed.")
    _add_items(db, review, payload.item_ids)
    db.commit()
    return _detail(db, review, user)


@router.delete("/reviews/{review_id}/items/{item_id}", response_model=ReviewDetail)
def remove_review_item(
    review_id: uuid.UUID, item_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    review.items = [ri for ri in review.items if ri.item_id != item_id]
    db.commit()
    return _detail(db, review, user)


@router.post("/reviews/{review_id}/participants", response_model=ReviewDetail)
def add_participant(
    review_id: uuid.UUID, payload: ParticipantIn, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    target = db.get(User, payload.user_id)
    if not target:
        raise HTTPException(404, "User not found")
    existing = next((p for p in review.participants if p.user_id == payload.user_id), None)
    if existing:
        existing.required = payload.required
    else:
        review.participants.append(ReviewParticipant(user_id=payload.user_id, required=payload.required))
        watch(db, target, "review", review.id)
        notify(
            db, [target], kind="review.invited",
            title=f"{review.key}: you're invited to review '{review.title}'",
            body=f"{user.display_name} added you as a reviewer.", url=_route(review), actor=user,
            subject_type="review", subject_id=review.id, badge="Review",
        )
    db.commit()
    return _detail(db, review, user)


@router.delete("/reviews/{review_id}/participants/{user_id}", response_model=ReviewDetail)
def remove_participant(
    review_id: uuid.UUID, user_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    review.participants = [p for p in review.participants if p.user_id != user_id]
    db.commit()
    return _detail(db, review, user)


@router.post("/reviews/{review_id}/vote", response_model=ReviewDetail)
def vote(review_id: uuid.UUID, payload: VoteIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    review = _review(db, review_id, user)
    if review.status != "open":
        raise HTTPException(409, "This review is closed.")
    if payload.vote not in REVIEW_VOTES:
        raise HTTPException(422, f"vote must be one of {REVIEW_VOTES}")
    me = next((p for p in review.participants if p.user_id == user.id), None)
    if me is None:
        raise HTTPException(403, "Only invited participants can vote on this review.")
    if payload.vote == "reject" and not (payload.comment or "").strip():
        raise HTTPException(422, "A 'reject' vote needs a comment.")
    me.vote = payload.vote
    me.vote_comment = payload.comment
    me.voted_at = datetime.now(timezone.utc)
    audit.log(
        db, action="review.vote", subject_type="review", subject_id=review.id, actor=user,
        project_id=review.project_id, summary=f"{user.display_name} voted '{payload.vote}' on {review.key}",
        payload={"comment": payload.comment},
    )
    notify(
        db, [review.created_by] + watchers(db, "review", review.id), kind="review.vote",
        title=f"{review.key}: {user.display_name} voted '{payload.vote.replace('_', ' ')}'",
        body=payload.comment, url=_route(review), actor=user, subject_type="review", subject_id=review.id,
        email=False,
    )
    db.commit()
    return _detail(db, review, user)


@router.post("/reviews/{review_id}/close", response_model=CloseResult)
def close_review(
    review_id: uuid.UUID, payload: CloseIn, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    if review.status != "open":
        raise HTTPException(409, "This review is already closed.")
    blockers = close_blockers(db, review)
    if blockers:
        raise HTTPException(422, {"code": "review_blocked", "message": "This review can't be closed yet.",
                                  "reasons": blockers})
    applied: list[str] = []
    skipped: list[str] = []
    touched: list[Item] = []
    if payload.apply_transition:
        for ri in review.items:
            subject = wf.ItemSubject(db, ri.item)
            if subject.definition() is None:
                continue
            t = wf.transition(subject.workflow(), payload.apply_transition)
            if t is None or subject.get_state() not in t["from"]:
                skipped.append(f"{ri.item.key}: not available in its current state")
                continue
            try:
                with db.begin_nested():
                    wf.execute(
                        db, subject, payload.apply_transition, user,
                        comment=payload.comment or f"Closed with {review.key}",
                        payload={"password": payload.password, "review": review.key},
                    )
                applied.append(ri.item.key or str(ri.item_id))
                touched.append(ri.item)
            except wf.WorkflowError as e:
                if e.reasons and e.reasons[0] in ("signature_required", "signature_failed"):
                    db.rollback()
                    raise HTTPException(e.status_code, {"code": "workflow", "message": e.message,
                                                        "reasons": e.reasons})
                skipped.append(f"{ri.item.key}: " + ("; ".join(e.reasons) or e.message))
    review.status = "closed"
    review.outcome = payload.outcome
    review.closed_by_id = user.id
    review.closed_at = datetime.now(timezone.utc)
    audit.log(
        db, action="review.close", subject_type="review", subject_id=review.id, actor=user,
        project_id=review.project_id, summary=f"{review.key} closed — {payload.outcome}",
        payload={"comment": payload.comment, "applied": applied, "skipped": skipped},
    )
    notify(
        db, watchers(db, "review", review.id), kind="review.closed",
        title=f"{review.key} '{review.title}' closed — {payload.outcome}",
        body=payload.comment, url=_route(review), actor=user, subject_type="review", subject_id=review.id,
        badge="Review closed",
    )
    db.commit()
    for item in touched:
        sync_item(db, item.document.project, item)
    return CloseResult(review=_detail(db, review, user), applied=applied, skipped=skipped)


@router.post("/reviews/{review_id}/cancel", response_model=ReviewDetail)
def cancel_review(review_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    review = _review(db, review_id, user)
    _require_manage(db, review, user)
    if review.status != "open":
        raise HTTPException(409, "This review is already closed.")
    review.status = "cancelled"
    review.closed_by_id = user.id
    review.closed_at = datetime.now(timezone.utc)
    audit.log(db, action="review.cancel", subject_type="review", subject_id=review.id, actor=user,
              project_id=review.project_id, summary=f"{review.key} cancelled")
    db.commit()
    return _detail(db, review, user)
