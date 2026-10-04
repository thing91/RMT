"""Roadmap ideas as a workflow subject (+ duplicate merging, release-note
linking, visibility rules)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.idea import Idea, IdeaVote, ReleaseNote
from app.models.user import User
from app.services import workflow_engine as wf
from app.services.notifications import move_watchers, notify, watch, watchers
from app.services.permissions import has_org_permission
from app.services.workflow_templates import SYSTEM_WORKFLOWS

HIDDEN_ORG = "Organization hidden"


def is_manager(db: Session, user: User | None) -> bool:
    return has_org_permission(db, user, "roadmap.manage")


def can_see_origin(db: Session, user: User | None, idea: Idea) -> bool:
    return bool(user and (user.org_id == idea.org_id or is_manager(db, user)))


def next_number(db: Session) -> int:
    return (db.query(func.max(Idea.number)).scalar() or 0) + 1


class IdeaSubject(wf.Subject):
    def __init__(self, db: Session, idea: Idea):
        super().__init__(kind="idea", obj=idea, db=db)

    @property
    def idea(self) -> Idea:
        return self.obj

    @property
    def project_id(self):
        return None

    @property
    def org_id(self):
        return self.idea.org_id

    @property
    def label(self) -> str:
        return f"IDEA-{self.idea.number} {self.idea.title[:60]}"

    @property
    def url(self) -> str:
        return f"/roadmap/ideas/{self.idea.id}"

    def workflow(self) -> dict:
        return SYSTEM_WORKFLOWS["idea"]

    def author_ids(self) -> set[uuid.UUID]:
        return {self.idea.author_id}

    def can_read(self, user: User | None) -> bool:
        return user is not None

    def after_transition(self, ctx: wf.Context) -> None:
        self.idea.status_changed_at = datetime.now(timezone.utc)
        if ctx.to_state in ("planned", "in_progress") and not self.idea.horizon:
            self.idea.horizon = "now" if ctx.to_state == "in_progress" else "next"


@wf.register_subject("idea")
def _load(db: Session, subject_id: uuid.UUID):
    idea = db.get(Idea, subject_id)
    return IdeaSubject(db, idea) if idea else None


def _duplicate_pre(db, subject, cfg, ctx):
    target_id = ctx.payload.get("duplicate_of_id")
    try:
        target = db.get(Idea, uuid.UUID(str(target_id)))
    except (ValueError, TypeError):
        target = None
    if target is None or target.id == subject.id:
        raise wf.WorkflowError("Pick the idea this one duplicates.", reasons=["duplicate_target_required"])
    if target.status == "duplicate":
        raise wf.WorkflowError("The target is itself a duplicate — pick the original.")


@wf.action("merge_duplicate", pre=_duplicate_pre)
def _merge_duplicate(db, subject, cfg, ctx):
    """Votes and watchers move to the original idea."""
    idea: Idea = subject.obj
    target = db.get(Idea, uuid.UUID(str(ctx.payload["duplicate_of_id"])))
    idea.duplicate_of_id = target.id
    existing = {v.user_id for v in db.query(IdeaVote).filter_by(idea_id=target.id).all()}
    moved = 0
    for vote in db.query(IdeaVote).filter_by(idea_id=idea.id).all():
        if vote.user_id not in existing:
            db.add(IdeaVote(idea_id=target.id, user_id=vote.user_id))
            moved += 1
        db.delete(vote)
    move_watchers(db, "idea", idea.id, target.id)
    watch(db, idea.author_id, "idea", target.id)
    ctx.notes["merged_into"] = f"IDEA-{target.number}"
    ctx.notes["votes_moved"] = moved
    db.flush()


def _release_pre(db, subject, cfg, ctx):
    try:
        note = db.get(ReleaseNote, uuid.UUID(str(ctx.payload.get("release_note_id"))))
    except (ValueError, TypeError):
        note = None
    if note is None:
        raise wf.WorkflowError("Link the release-notes entry that shipped this.", reasons=["release_note_required"])


@wf.action("link_release_note", pre=_release_pre)
def _link_release_note(db, subject, cfg, ctx):
    subject.obj.release_note_id = uuid.UUID(str(ctx.payload["release_note_id"]))
    note = db.get(ReleaseNote, subject.obj.release_note_id)
    ctx.notes["release"] = note.version


def notify_official_reply(db: Session, idea: Idea, author: User, body: str) -> None:
    notify(
        db,
        watchers(db, "idea", idea.id) + [idea.author],
        kind="idea.official_reply",
        title=f"IDEA-{idea.number}: official reply from the product team",
        body=body[:500],
        url=f"/roadmap/ideas/{idea.id}",
        actor=author,
        subject_type="idea",
        subject_id=idea.id,
        badge="Roadmap",
    )
