"""Generic workflow engine (wymagania-wspolbieznosc-i-workflow.md, "Workflow
wymagań" FR1–2, reused by suggestions, applicability and the roadmap).

A workflow is a dict of `states` and `transitions` (see
app/services/workflow_templates.py for the shape). Each transition names
who may run it (`roles`), what must hold first (`conditions`) and what
happens afterwards (`actions`). Conditions and actions are plain Python
functions registered by name — adding a new kind is code, not data.

The engine works on a *subject* — a thin adapter around whatever object
carries the state (an Item, a Suggestion, an ApplicabilityRecord, an Idea)
— so every object type shares the same rules, history (audit_events with
action="workflow.transition") and notifications.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.config import settings
from app.models.audit import AuditEvent
from app.models.baseline import Baseline
from app.models.comment import ItemComment
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.item_version import ItemVersion
from app.models.link import Link, LinkType
from app.models.project import Project
from app.models.project_access import ProjectAccess
from app.models.user import GroupMember, User
from app.models.workflow import DocumentWorkflowRole
from app.models.workflow_def import ChangeRequest, ElectronicSignature, WorkflowDefinition
from app.services import audit
from app.services.notifications import item_route, notify, watch, watchers
from app.services.permissions import (
    has_org_permission,
    has_permission,
    has_role_at_least,
    is_org_admin,
)

STATUS_KEY = "status"


class WorkflowError(Exception):
    status_code = 422

    def __init__(self, message: str, reasons: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.reasons = reasons or []


class TransitionForbidden(WorkflowError):
    status_code = 403


class TransitionNotFound(WorkflowError):
    status_code = 404


# --------------------------------------------------------------------------
# Spec helpers


def state(spec: dict, key: str | None) -> dict | None:
    return next((s for s in spec["states"] if s["key"] == key), None)


def initial_state(spec: dict) -> str:
    for s in spec["states"]:
        if s.get("initial"):
            return s["key"]
    return spec["states"][0]["key"]


def state_label(spec: dict, key: str | None) -> str:
    s = state(spec, key)
    return s["label"] if s else (key or "—")


def transition(spec: dict, key: str) -> dict | None:
    return next((t for t in spec["transitions"] if t["key"] == key), None)


def validate_spec(spec: dict) -> list[str]:
    """Structural sanity checks for a user-edited workflow definition."""
    errors: list[str] = []
    keys = [s.get("key") for s in spec.get("states", [])]
    if not keys:
        errors.append("A workflow needs at least one state.")
    if len(keys) != len(set(keys)):
        errors.append("State keys must be unique.")
    if sum(1 for s in spec.get("states", []) if s.get("initial")) > 1:
        errors.append("Only one state can be the initial state.")
    tkeys = [t.get("key") for t in spec.get("transitions", [])]
    if len(tkeys) != len(set(tkeys)):
        errors.append("Transition keys must be unique.")
    for t in spec.get("transitions", []):
        for frm in t.get("from", []):
            if frm not in keys:
                errors.append(f"Transition '{t.get('key')}' starts from unknown state '{frm}'.")
        if t.get("to") not in keys:
            errors.append(f"Transition '{t.get('key')}' goes to unknown state '{t.get('to')}'.")
        for c in t.get("conditions", []):
            if c.get("type") not in CONDITIONS:
                errors.append(f"Unknown condition type '{c.get('type')}' in '{t.get('key')}'.")
        for a in t.get("actions", []):
            if a.get("type") not in ACTIONS:
                errors.append(f"Unknown action type '{a.get('type')}' in '{t.get('key')}'.")
    return errors


# --------------------------------------------------------------------------
# Subjects


@dataclass
class Subject:
    """Adapter the engine works on. Concrete subjects subclass this."""

    kind: str
    obj: Any
    db: Session

    @property
    def id(self) -> uuid.UUID:
        return self.obj.id

    @property
    def project_id(self) -> uuid.UUID | None:
        return getattr(self.obj, "project_id", None)

    @property
    def org_id(self) -> uuid.UUID | None:
        if self.project_id:
            return self.db.query(Project.org_id).filter(Project.id == self.project_id).scalar()
        return getattr(self.obj, "org_id", None)

    @property
    def label(self) -> str:
        return str(self.obj.id)[:8]

    @property
    def url(self) -> str | None:
        return None

    def workflow(self) -> dict:
        raise NotImplementedError

    def get_state(self) -> str | None:
        return self.obj.status

    def set_state(self, value: str, ctx: "Context") -> None:
        self.obj.status = value

    def author_ids(self) -> set[uuid.UUID]:
        author = getattr(self.obj, "author_id", None)
        return {author} if author else set()

    def owner_usernames(self) -> set[str]:
        return set()

    def field_value(self, name: str) -> Any:
        return getattr(self.obj, name, None)

    def setting(self, name: str, default: Any = None) -> Any:
        return getattr(settings, name, default)

    def after_transition(self, ctx: "Context") -> None:
        pass


class ItemSubject(Subject):
    def __init__(self, db: Session, item: Item):
        super().__init__(kind="item", obj=item, db=db)
        self._spec: dict | None = None
        self._definition: WorkflowDefinition | None = None

    @property
    def item(self) -> Item:
        return self.obj

    @property
    def project_id(self) -> uuid.UUID:
        return self.item.document.project_id

    @property
    def label(self) -> str:
        return self.item.key or self.item.title[:60]

    @property
    def url(self) -> str:
        return item_route(self.project_id, self.item.document_id, self.item.id)

    def definition(self) -> WorkflowDefinition | None:
        if self._definition is None:
            self._definition = resolve_item_definition(self.db, self.project_id, self.item.item_type_id)
        return self._definition

    def workflow(self) -> dict:
        d = self.definition()
        if d is None:
            raise WorkflowError("This item type has no workflow.")
        return {"states": d.states, "transitions": d.transitions, "settings": d.settings or {}}

    def get_state(self) -> str | None:
        return (self.item.attributes or {}).get(STATUS_KEY)

    def set_state(self, value: str, ctx: "Context") -> None:
        self.item.attributes = {**(self.item.attributes or {}), STATUS_KEY: value}
        target = state(ctx.spec, value) or {}
        if target.get("is_obsolete"):
            self.item.obsolete_at = self.item.obsolete_at or datetime.now(timezone.utc)
        else:
            self.item.obsolete_at = None
        self.item.updated_by = ctx.user.username if ctx.user else "system"

    def author_ids(self) -> set[uuid.UUID]:
        return content_authors_since_last_lock(self.db, self.item, self.workflow())

    def owner_usernames(self) -> set[str]:
        owner = (self.item.attributes or {}).get("owner")
        return {owner} if isinstance(owner, str) and owner else set()

    def field_value(self, name: str) -> Any:
        if name in ("title", "description_md"):
            return getattr(self.item, name)
        return (self.item.attributes or {}).get(name)

    def setting(self, name: str, default: Any = None) -> Any:
        d = self.definition()
        if d and name in (d.settings or {}):
            return d.settings[name]
        return super().setting(name, default)

    def after_transition(self, ctx: "Context") -> None:
        from app.services.versioning import record_version

        record_version(
            self.db,
            self.item,
            changed_by=ctx.user,
            reason="transition",
            note=ctx.comment,
            source_ref=ctx.transition["key"],
        )
        for hook in ITEM_TRANSITION_HOOKS:
            hook(self.db, self, ctx)


# Called after an item's transition is recorded: fn(db, ItemSubject, Context).
# Used e.g. to apply suggestions accepted while the item was read-only once
# it becomes editable again.
ITEM_TRANSITION_HOOKS: list[Callable] = []


# Subject factories registered by other modules (suggestions, ideas, ...).
SUBJECT_LOADERS: dict[str, Callable[[Session, uuid.UUID], Subject | None]] = {}


def register_subject(kind: str):
    def deco(fn):
        SUBJECT_LOADERS[kind] = fn
        return fn

    return deco


@register_subject("item")
def _load_item(db: Session, subject_id: uuid.UUID) -> Subject | None:
    item = db.get(Item, subject_id)
    return ItemSubject(db, item) if item else None


# --------------------------------------------------------------------------
# Item workflow resolution


def resolve_item_definition(
    db: Session, project_id: uuid.UUID, item_type_id: uuid.UUID
) -> WorkflowDefinition | None:
    """Project override first, then the org-level definition."""
    override = (
        db.query(WorkflowDefinition)
        .filter_by(project_id=project_id, item_type_id=item_type_id)
        .first()
    )
    if override:
        return override
    org_id = db.query(Project.org_id).filter(Project.id == project_id).scalar()
    return (
        db.query(WorkflowDefinition)
        .filter(
            WorkflowDefinition.org_id == org_id,
            WorkflowDefinition.project_id.is_(None),
            WorkflowDefinition.item_type_id == item_type_id,
        )
        .first()
    )


def item_has_workflow(db: Session, item: Item) -> bool:
    return resolve_item_definition(db, item.document.project_id, item.item_type_id) is not None


def item_state(db: Session, item: Item) -> dict | None:
    d = resolve_item_definition(db, item.document.project_id, item.item_type_id)
    if d is None:
        return None
    return state({"states": d.states}, (item.attributes or {}).get(STATUS_KEY))


def locked_baseline_names(db: Session, item: Item) -> list[str]:
    """Locked baselines (milestones) that froze this exact item."""
    rows = (
        db.query(Baseline)
        .filter(Baseline.project_id == item.document.project_id, Baseline.locks_items.is_(True))
        .all()
    )
    return [b.name for b in rows if str(item.id) in (b.item_versions or {})]


def read_only_reason(db: Session, item: Item) -> str | None:
    """Why the item's content can't be edited right now, or None.

    Workflow locks are separate from edit locks: they're lifted only by a
    workflow transition (e.g. Request change → Draft), never by hand.
    """
    st = item_state(db, item)
    if st and st.get("read_only"):
        return f"'{st['label']}' items are read-only — run a workflow transition (e.g. request a change) to edit."
    if st is not None and st.get("category") != "draft":
        names = locked_baseline_names(db, item)
        if names:
            return f"Frozen by baseline '{names[0]}' — request a change to edit."
    return None


def content_authors_since_last_lock(db: Session, item: Item, spec: dict) -> set[uuid.UUID]:
    """Everyone who authored this item's content since it last left a
    read-only state (i.e. since the last approval) — used by "author can't
    approve their own requirement"."""
    read_only = {s["key"] for s in spec["states"] if s.get("read_only")}
    versions = (
        db.query(ItemVersion)
        .filter(ItemVersion.item_id == item.id)
        .order_by(ItemVersion.version.desc())
        .all()
    )
    authors: set[uuid.UUID] = set()
    for v in versions:
        if v.reason == "transition" and (v.snapshot.get("attributes") or {}).get(STATUS_KEY) in read_only:
            break
        if v.reason in ("create", "edit", "suggestion", "revert", "import") and v.author_id:
            authors.add(v.author_id)
    return authors


def sync_status_enum(db: Session, item_type_id: uuid.UUID) -> None:
    """Keep the item type's `status` enum options in line with the states
    of every workflow defined for it, so tables/exports/filters that read
    `attributes.status` keep working unchanged. States missing from every
    workflow are kept but flagged deprecated (existing data stays valid)."""
    item_type = db.get(ItemType, item_type_id)
    defs = db.query(WorkflowDefinition).filter_by(item_type_id=item_type_id).all()
    ordered: list[dict] = []
    seen: set[str] = set()
    for d in sorted(defs, key=lambda d: d.project_id is not None):
        for s in d.states:
            if s["key"] not in seen:
                seen.add(s["key"])
                ordered.append(
                    {"value": s["key"], "label": s["label"], "deprecated": False, "color": s.get("color")}
                )
    attr = next((a for a in item_type.attributes if a.key == STATUS_KEY), None)
    if attr is None:
        attr = ItemTypeAttribute(
            item_type_id=item_type.id,
            key=STATUS_KEY,
            label="Status",
            data_type="enum",
            required=True,
            order=-1,
            is_system=True,
        )
        db.add(attr)
        old_options: list[dict] = []
    else:
        old_options = attr.enum_options or []
    for o in old_options:
        if o["value"] not in seen:
            ordered.append({**o, "deprecated": True})
    attr.data_type = "enum"
    attr.enum_options = ordered
    db.flush()


# --------------------------------------------------------------------------
# Execution context, roles, conditions, actions


@dataclass
class Context:
    spec: dict
    transition: dict
    from_state: str | None
    to_state: str
    user: User | None
    comment: str | None
    payload: dict = field(default_factory=dict)
    system: bool = False
    notes: dict = field(default_factory=dict)


def _token_ok(db: Session, subject: Subject, token: str, user: User) -> bool:
    pid = subject.project_id
    if token == "any":
        return True
    if token == "author":
        return user.id in subject.author_ids() or user.id == getattr(subject.obj, "author_id", None)
    if token == "owner":
        return user.username in subject.owner_usernames()
    if token.startswith("role:"):
        return bool(pid) and has_role_at_least(db, pid, user.id, token[5:])
    if token.startswith("perm:"):
        perm = token[5:]
        if pid:
            return has_permission(db, pid, user, perm)
        return has_org_permission(db, user, perm)
    if token in ("doc:reviewer", "doc:approver") and isinstance(subject, ItemSubject):
        return (
            db.query(DocumentWorkflowRole)
            .filter_by(document_id=subject.item.document_id, user_id=user.id, role=token[4:])
            .first()
            is not None
        )
    return False


def role_check(db: Session, subject: Subject, t: dict, user: User | None, system: bool) -> bool:
    tokens = t.get("roles") or []
    if system:
        return True
    if user is None or "system" in tokens and len(tokens) == 1:
        return False
    if not tokens:
        pid = subject.project_id
        return bool(pid) and has_permission(db, pid, user, "workflow.transition")
    return any(_token_ok(db, subject, tok, user) for tok in tokens if tok != "system")


ConditionFn = Callable[[Session, Subject, dict, Context], str | None]
ActionFn = Callable[[Session, Subject, dict, Context], None]

CONDITIONS: dict[str, ConditionFn] = {}
ACTIONS: dict[str, ActionFn] = {}
PRE_ACTIONS: dict[str, ActionFn] = {}


def condition(name: str):
    def deco(fn):
        CONDITIONS[name] = fn
        return fn

    return deco


def action(name: str, *, pre: ActionFn | None = None):
    def deco(fn):
        ACTIONS[name] = fn
        if pre is not None:
            PRE_ACTIONS[name] = pre
        return fn

    return deco


@condition("required_fields")
def _c_required_fields(db, subject, cfg, ctx):
    missing = []
    for f in cfg.get("fields", []):
        v = ctx.payload.get(f, subject.field_value(f))
        if v is None or (isinstance(v, str) and not v.strip()) or v == []:
            missing.append(f)
    if missing:
        return "Required field(s) missing: " + ", ".join(missing)
    return None


@condition("has_link")
def _c_has_link(db, subject, cfg, ctx):
    if subject.kind != "item":
        return None
    q = db.query(Link).join(LinkType, Link.link_type_id == LinkType.id)
    if cfg.get("link_type"):
        q = q.filter(LinkType.key == cfg["link_type"])
    direction = cfg.get("direction", "any")
    if direction == "out":
        q = q.filter(Link.source_item_id == subject.id)
    elif direction == "in":
        q = q.filter(Link.target_item_id == subject.id)
    else:
        q = q.filter((Link.source_item_id == subject.id) | (Link.target_item_id == subject.id))
    if q.first() is None:
        return f"Needs at least one '{cfg.get('link_type') or 'any'}' link."
    return None


@condition("no_open_comments")
def _c_no_open_comments(db, subject, cfg, ctx):
    if subject.kind != "item":
        return None
    n = (
        db.query(ItemComment)
        .filter(
            ItemComment.item_id == subject.id,
            ItemComment.parent_comment_id.is_(None),
            ItemComment.resolved.is_(False),
        )
        .count()
    )
    return f"{n} comment thread(s) still open — resolve them first." if n else None


@condition("author_cannot_execute")
def _c_author_cannot_execute(db, subject, cfg, ctx):
    if ctx.system or ctx.user is None:
        return None
    if cfg.get("setting") and subject.setting(cfg["setting"], False):
        return None  # explicitly allowed by configuration
    if ctx.user.id in subject.author_ids():
        return "You authored this — someone else has to do this step."
    return None


@condition("linked_tests_passed")
def _c_linked_tests_passed(db, subject, cfg, ctx):
    if subject.kind != "item":
        return None
    q = db.query(Link).join(LinkType, Link.link_type_id == LinkType.id).filter(
        (Link.source_item_id == subject.id) | (Link.target_item_id == subject.id)
    )
    if cfg.get("link_type"):
        q = q.filter(LinkType.key == cfg["link_type"])
    links = q.all()
    if not links:
        return "No linked verification/test items."
    attr = cfg.get("result_attribute", "result")
    expected = cfg.get("pass_value", "pass")
    failing = []
    for link in links:
        other = link.source_item if link.target_item_id == subject.id else link.target_item
        if (other.attributes or {}).get(attr) != expected:
            failing.append(other.key or other.title[:30])
    if failing:
        return "Linked test(s) not passed: " + ", ".join(failing)
    return None


# ---- recipients


def users_with_permission(db: Session, project_id: uuid.UUID, perm: str) -> list[User]:
    org_id = db.query(Project.org_id).filter(Project.id == project_id).scalar()
    candidates: dict[uuid.UUID, User] = {}
    for grant in db.query(ProjectAccess).filter_by(project_id=project_id).all():
        if grant.subject_type == "user":
            u = db.get(User, grant.subject_id)
            if u:
                candidates[u.id] = u
        else:
            for gm in db.query(GroupMember).filter_by(group_id=grant.subject_id).all():
                u = db.get(User, gm.user_id)
                if u:
                    candidates[u.id] = u
    for u in db.query(User).filter(User.org_id == org_id, User.org_role == "admin").all():
        candidates[u.id] = u
    return [u for u in candidates.values() if has_permission(db, project_id, u, perm)]


def resolve_targets(db: Session, subject: Subject, targets: list[str]) -> list[User]:
    users: list[User] = []
    for t in targets:
        if t == "watchers":
            users += watchers(db, subject.kind, subject.id)
        elif t == "author":
            users += [db.get(User, uid) for uid in subject.author_ids()]
            if getattr(subject.obj, "author_id", None):
                users.append(db.get(User, subject.obj.author_id))
        elif t == "owner":
            names = subject.owner_usernames()
            if names:
                users += db.query(User).filter(User.username.in_(names)).all()
        elif t in ("doc_reviewers", "doc_approvers") and isinstance(subject, ItemSubject):
            role = "reviewer" if t == "doc_reviewers" else "approver"
            users += (
                db.query(User)
                .join(DocumentWorkflowRole, DocumentWorkflowRole.user_id == User.id)
                .filter(
                    DocumentWorkflowRole.document_id == subject.item.document_id,
                    DocumentWorkflowRole.role == role,
                )
                .all()
            )
        elif t.startswith("permission:") and subject.project_id:
            users += users_with_permission(db, subject.project_id, t.split(":", 1)[1])
        elif t.startswith("permission:"):
            perm = t.split(":", 1)[1]
            org_id = subject.org_id
            users += [
                u
                for u in db.query(User).filter(User.org_id == org_id).all()
                if has_org_permission(db, u, perm)
            ]
    return [u for u in users if u is not None]


@action("notify")
def _a_notify(db, subject, cfg, ctx):
    users = resolve_targets(db, subject, cfg.get("targets", ["watchers"]))
    to_label = state_label(ctx.spec, ctx.to_state)
    who = ctx.user.display_name if ctx.user else "System"
    body = f"{who}: {state_label(ctx.spec, ctx.from_state)} → {to_label}."
    if ctx.comment:
        body += f"\n\n{ctx.comment}"
    notify(
        db,
        users,
        kind=f"{subject.kind}.transition",
        title=f"{subject.label}: {to_label}",
        body=body,
        url=subject.url,
        actor=ctx.user,
        subject_type=subject.kind,
        subject_id=subject.id,
        badge=to_label,
    )


@action("stamp_approval")
def _a_stamp_approval(db, subject, cfg, ctx):
    if isinstance(subject, ItemSubject) and ctx.user:
        now = datetime.now(timezone.utc)
        subject.item.approved_by_id = ctx.user.id
        subject.item.approved_at = now
        subject.item.updated_at = now


def _open_change_request(db: Session, item_id: uuid.UUID, statuses: tuple[str, ...]) -> ChangeRequest | None:
    return (
        db.query(ChangeRequest)
        .filter(ChangeRequest.item_id == item_id, ChangeRequest.status.in_(statuses))
        .order_by(ChangeRequest.created_at.desc())
        .first()
    )


def impact_analysis(db: Session, item: Item) -> list[dict]:
    """Everything that may be affected by changing `item`: linked items in
    both directions plus descendants in the document tree."""
    impact: list[dict] = []
    seen: set[uuid.UUID] = set()
    links = (
        db.query(Link)
        .filter((Link.source_item_id == item.id) | (Link.target_item_id == item.id))
        .all()
    )
    for link in links:
        outgoing = link.source_item_id == item.id
        other = link.target_item if outgoing else link.source_item
        if other.id in seen:
            continue
        seen.add(other.id)
        impact.append(
            {
                "item_id": str(other.id),
                "key": other.key,
                "title": other.title,
                "item_type": other.item_type.name,
                "relation": link.link_type.name if outgoing else link.link_type.inverse_name,
                "link_id": str(link.id),
            }
        )
    stack = list(item.children)
    while stack:
        child = stack.pop()
        if child.id not in seen and child.item_type.behavior == "content":
            seen.add(child.id)
            impact.append(
                {
                    "item_id": str(child.id),
                    "key": child.key,
                    "title": child.title,
                    "item_type": child.item_type.name,
                    "relation": "Child",
                    "link_id": None,
                }
            )
        stack.extend(child.children)
    return impact


@action("create_change_request")
def _a_create_change_request(db, subject, cfg, ctx):
    from app.services.keys import next_key

    if not isinstance(subject, ItemSubject):
        return
    item = subject.item
    cr = ChangeRequest(
        project_id=subject.project_id,
        key=next_key(db, subject.project_id, "CR"),
        item_id=item.id,
        base_version=item.version,
        status="open",
        reason=ctx.comment or "",
        impact=impact_analysis(db, item),
        requested_by_id=ctx.user.id if ctx.user else None,
    )
    db.add(cr)
    db.flush()
    ctx.notes["change_request"] = cr.key
    if ctx.user:
        watch(db, ctx.user, "item", item.id)


@action("change_request_status")
def _a_change_request_status(db, subject, cfg, ctx):
    if not isinstance(subject, ItemSubject):
        return
    new_status = cfg["status"]
    source = {"accepted": ("open",), "rejected": ("open",), "implemented": ("accepted",)}[new_status]
    cr = _open_change_request(db, subject.id, source)
    if cr is None:
        return
    cr.status = new_status
    if new_status in ("accepted", "rejected"):
        cr.decided_by_id = ctx.user.id if ctx.user else None
        cr.decided_at = datetime.now(timezone.utc)
    if new_status == "implemented":
        cr.implemented_version = subject.item.version + 1  # the version this transition is about to write
    ctx.notes["change_request"] = cr.key


@action("mark_suspect")
def _a_mark_suspect(db, subject, cfg, ctx):
    if not isinstance(subject, ItemSubject):
        return
    item = subject.item
    cr = _open_change_request(db, item.id, ("accepted",))
    if cfg.get("only_after_change_request") and cr is None:
        return
    reason = f"{subject.label} changed"
    if cr is not None:
        reason += f" ({cr.key}, v{cr.base_version} → v{item.version + 1})"
    now = datetime.now(timezone.utc)
    links = (
        db.query(Link)
        .filter((Link.source_item_id == item.id) | (Link.target_item_id == item.id))
        .all()
    )
    affected: list[Item] = []
    for link in links:
        link.suspect = True
        link.suspect_reason = reason
        link.suspect_since = now
        link.suspect_item_id = item.id
        affected.append(link.target_item if link.source_item_id == item.id else link.source_item)
    ctx.notes["suspect_links"] = len(links)
    for other in affected:
        other_subject = ItemSubject(db, other)
        recipients = watchers(db, "item", other.id) + resolve_targets(db, other_subject, ["owner"])
        notify(
            db,
            recipients,
            kind="item.suspect",
            title=f"{other.key or other.title[:40]} is suspect",
            body=f"{reason} — re-verify the relationship to {subject.label}.",
            url=other_subject.url,
            actor=ctx.user,
            subject_type="item",
            subject_id=other.id,
            badge="Suspect",
        )


def _signature_pre(db, subject, cfg, ctx):
    from app.services.auth import AuthError, authenticate

    password = ctx.payload.get("password")
    if ctx.user is None:
        raise WorkflowError("An electronic signature needs a signed-in user.")
    if not password:
        raise WorkflowError(
            "This step requires an electronic signature — re-enter your password.",
            reasons=["signature_required"],
        )
    try:
        profile = authenticate(ctx.user.username, password)
    except AuthError:
        raise TransitionForbidden("Signature failed: wrong password.", reasons=["signature_failed"])
    if profile.username != ctx.user.username:
        raise TransitionForbidden("Signature failed: identity mismatch.", reasons=["signature_failed"])


@action("require_signature", pre=_signature_pre)
def _a_require_signature(db, subject, cfg, ctx):
    content = {}
    version = None
    if isinstance(subject, ItemSubject):
        from app.services.versioning import snapshot

        content = snapshot(subject.item)
        version = subject.item.version + 1
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest()
    db.add(
        ElectronicSignature(
            subject_type=subject.kind,
            subject_id=subject.id,
            subject_version=version,
            user_id=ctx.user.id,
            meaning=cfg.get("meaning", "approval"),
            content_hash=digest,
            transition_key=ctx.transition["key"],
        )
    )
    ctx.notes["signed"] = True


# --------------------------------------------------------------------------
# Public API


@dataclass
class TransitionOption:
    key: str
    label: str
    to: str
    to_label: str
    requires_comment: bool
    requires_signature: bool
    allowed: bool
    reasons: list[str]

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _conditions_failures(db: Session, subject: Subject, t: dict, ctx: Context) -> list[str]:
    failures = []
    for cfg in t.get("conditions", []):
        fn = CONDITIONS.get(cfg.get("type"))
        if fn is None:
            continue
        msg = fn(db, subject, cfg, ctx)
        if msg:
            failures.append(msg)
    return failures


def available_transitions(db: Session, subject: Subject, user: User | None) -> list[TransitionOption]:
    spec = subject.workflow()
    current = subject.get_state()
    options = []
    for t in spec["transitions"]:
        if current not in t["from"]:
            continue
        tokens = t.get("roles") or []
        if tokens == ["system"]:
            continue  # system-only transitions never show up as buttons
        ctx = Context(spec, t, current, t["to"], user, None)
        reasons: list[str] = []
        if not role_check(db, subject, t, user, False):
            reasons.append("You don't have a role that may do this.")
        reasons += _conditions_failures(db, subject, t, ctx)
        options.append(
            TransitionOption(
                key=t["key"],
                label=t["label"],
                to=t["to"],
                to_label=state_label(spec, t["to"]),
                requires_comment=bool(t.get("requires_comment")),
                requires_signature=any(a.get("type") == "require_signature" for a in t.get("actions", [])),
                allowed=not reasons,
                reasons=reasons,
            )
        )
    return options


def execute(
    db: Session,
    subject: Subject,
    transition_key: str,
    user: User | None,
    *,
    comment: str | None = None,
    payload: dict | None = None,
    system: bool = False,
) -> Context:
    """Run one transition. Adds everything to the session; the caller
    commits. Raises WorkflowError subclasses on any refusal."""
    spec = subject.workflow()
    t = transition(spec, transition_key)
    if t is None:
        raise TransitionNotFound(f"Unknown transition '{transition_key}'.")
    current = subject.get_state()
    if current not in t["from"]:
        raise WorkflowError(
            f"'{t['label']}' isn't possible from '{state_label(spec, current)}'.", reasons=["wrong_state"]
        )
    if not role_check(db, subject, t, user, system):
        raise TransitionForbidden(f"You aren't allowed to '{t['label']}'.")
    comment = (comment or "").strip() or None
    if t.get("requires_comment") and not comment and not system:
        raise WorkflowError(f"'{t['label']}' needs a comment/justification.", reasons=["comment_required"])
    ctx = Context(spec, t, current, t["to"], user, comment, dict(payload or {}), system)
    failures = _conditions_failures(db, subject, t, ctx)
    if failures:
        raise WorkflowError(f"Can't '{t['label']}' yet.", reasons=failures)
    for cfg in t.get("actions", []):
        pre = PRE_ACTIONS.get(cfg.get("type"))
        if pre:
            pre(db, subject, cfg, ctx)

    # Actions that describe the state being *entered* run before the
    # version snapshot so it captures them (e.g. approval stamps).
    subject.set_state(t["to"], ctx)
    for cfg in t.get("actions", []):
        if cfg.get("type") == "notify":
            continue
        fn = ACTIONS.get(cfg.get("type"))
        if fn:
            fn(db, subject, cfg, ctx)
    subject.after_transition(ctx)

    audit.log(
        db,
        action="workflow.transition",
        subject_type=subject.kind,
        subject_id=subject.id,
        actor=user,
        project_id=subject.project_id,
        org_id=subject.org_id,
        summary=f"{state_label(spec, current)} → {state_label(spec, t['to'])}",
        payload={
            "transition": t["key"],
            "transition_label": t["label"],
            "from": current,
            "to": t["to"],
            "from_label": state_label(spec, current),
            "to_label": state_label(spec, t["to"]),
            "comment": comment,
            "notes": ctx.notes,
            "version": getattr(subject.obj, "version", None),
        },
    )
    for cfg in t.get("actions", []):
        if cfg.get("type") == "notify":
            ACTIONS["notify"](db, subject, cfg, ctx)
    db.flush()
    return ctx


def history(db: Session, subject_type: str, subject_id: uuid.UUID) -> list[AuditEvent]:
    return (
        db.query(AuditEvent)
        .filter(
            AuditEvent.subject_type == subject_type,
            AuditEvent.subject_id == subject_id,
            AuditEvent.action == "workflow.transition",
        )
        .order_by(AuditEvent.created_at)
        .all()
    )


def can_configure(db: Session, user: User | None, project_id: uuid.UUID | None) -> bool:
    if user is None:
        return False
    if project_id is None:
        return is_org_admin(user) or has_org_permission(db, user, "workflow.configure_org")
    return has_permission(db, project_id, user, "workflow.configure")


def apply_template(
    db: Session,
    *,
    org_id: uuid.UUID,
    item_type_id: uuid.UUID,
    template: dict,
    project_id: uuid.UUID | None = None,
) -> WorkflowDefinition:
    import copy

    d = (
        db.query(WorkflowDefinition)
        .filter_by(org_id=org_id, project_id=project_id, item_type_id=item_type_id)
        .first()
    )
    if d is None:
        d = WorkflowDefinition(org_id=org_id, project_id=project_id, item_type_id=item_type_id)
        db.add(d)
    d.name = template["name"]
    d.variant = template.get("variant", "custom")
    d.states = copy.deepcopy(template["states"])
    d.transitions = copy.deepcopy(template["transitions"])
    d.settings = copy.deepcopy(template.get("settings", {}))
    db.flush()
    sync_status_enum(db, item_type_id)
    return d
