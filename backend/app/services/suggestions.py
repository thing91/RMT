"""Change suggestions (komentarze i sugestie zmian FR2–7): field access,
the workflow subject, applying an accepted suggestion as a normal
versioned item write, and auto-outdating when the item changes.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.link import Link, LinkType
from app.models.suggestion import Suggestion
from app.models.user import User
from app.services import locks
from app.services import workflow_engine as wf
from app.services.notifications import item_route, notify, watch, watchers
from app.services.suggestion_hooks import register as register_content_hook
from app.services.versioning import record_version
from app.services.workflow_templates import SYSTEM_WORKFLOWS

LINK_FIELDS = ("links.add", "links.remove")


class SuggestionError(ValueError):
    pass


def validate_target(item: Item, field: str, value: Any) -> None:
    if field in ("title", "description_md"):
        if value is not None and not isinstance(value, str):
            raise SuggestionError(f"'{field}' expects text.")
        if field == "title" and not (value or "").strip():
            raise SuggestionError("A title can't be empty.")
        return
    if field.startswith("attributes."):
        key = field.split(".", 1)[1]
        if key == wf.STATUS_KEY:
            raise SuggestionError("Status is controlled by the workflow, not by suggestions.")
        attr = next((a for a in item.item_type.attributes if a.key == key), None)
        if attr is None:
            raise SuggestionError(f"'{key}' isn't an attribute of {item.item_type.name}.")
        from app.services.attribute_validation import AttributeValidationError, validate_attributes

        try:
            validate_attributes(item.item_type.attributes, {**(item.attributes or {}), key: value})
        except AttributeValidationError as e:
            raise SuggestionError(str(e))
        return
    if field in LINK_FIELDS:
        if not isinstance(value, dict) or not value.get("link_type_id") or not value.get("other_item_id"):
            raise SuggestionError("A link suggestion needs link_type_id and other_item_id.")
        if value.get("direction", "out") not in ("out", "in"):
            raise SuggestionError("direction must be 'out' or 'in'.")
        return
    raise SuggestionError(f"Unknown target field '{field}'.")


def current_value(db: Session, item: Item, field: str) -> Any:
    if field in ("title", "description_md"):
        return getattr(item, field)
    if field.startswith("attributes."):
        return (item.attributes or {}).get(field.split(".", 1)[1])
    if field in LINK_FIELDS:
        # The "value" of the link set, for outdating purposes: sorted ids.
        links = (
            db.query(Link)
            .filter((Link.source_item_id == item.id) | (Link.target_item_id == item.id))
            .all()
        )
        return sorted(str(link.id) for link in links)
    return None


def _link_endpoints(item: Item, value: dict) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    other = uuid.UUID(str(value["other_item_id"]))
    lt = uuid.UUID(str(value["link_type_id"]))
    if value.get("direction", "out") == "out":
        return item.id, other, lt
    return other, item.id, lt


def _write_value(db: Session, item: Item, field: str, value: Any) -> None:
    if field in ("title", "description_md"):
        setattr(item, field, value)
    elif field.startswith("attributes."):
        item.attributes = {**(item.attributes or {}), field.split(".", 1)[1]: value}
    elif field == "links.add":
        src, tgt, lt = _link_endpoints(item, value)
        link_type = db.get(LinkType, lt)
        other = db.get(Item, tgt if src == item.id else src)
        if link_type is None or other is None:
            raise wf.WorkflowError("The suggested link's type or item no longer exists.")
        exists = db.query(Link).filter_by(source_item_id=src, target_item_id=tgt, link_type_id=lt).first()
        if not exists:
            db.add(Link(source_item_id=src, target_item_id=tgt, link_type_id=lt))
    elif field == "links.remove":
        src, tgt, lt = _link_endpoints(item, value)
        db.query(Link).filter_by(source_item_id=src, target_item_id=tgt, link_type_id=lt).delete()


def apply(db: Session, s: Suggestion, actor: User | None) -> None:
    """Write the suggestion's final value to the item as a normal,
    versioned write attributed to the suggestion's author."""
    item = s.item
    if actor is not None:
        try:
            locks.assert_can_write(db, "item", item.id, actor)
        except locks.LockHeld as e:
            raise wf.WorkflowError(
                f"{locks.to_info(e.lock).user_name} is editing {item.key} right now — try again once they're done.",
                reasons=["locked"],
            )
    value = s.final_value if s.final_value is not None else s.proposed_value
    _write_value(db, item, s.target_field, value)
    item.updated_by = actor.username if actor else "system"
    record_version(
        db,
        item,
        changed_by=actor,
        author=s.author,
        reason="suggestion",
        note=s.rationale,
        source_ref=s.key,
    )
    s.applied_version = item.version
    s.apply_pending = False
    db.flush()
    outdate_changed(db, item, exclude_id=s.id)


# ---- workflow subject -------------------------------------------------------


class SuggestionSubject(wf.Subject):
    def __init__(self, db: Session, s: Suggestion):
        super().__init__(kind="suggestion", obj=s, db=db)

    @property
    def s(self) -> Suggestion:
        return self.obj

    @property
    def label(self) -> str:
        return f"{self.s.key} on {self.s.item.key or self.s.item.title[:40]}"

    @property
    def url(self) -> str:
        item = self.s.item
        return item_route(item.document.project_id, item.document_id, item.id) + f"&suggestion={self.s.id}"

    def workflow(self) -> dict:
        return SYSTEM_WORKFLOWS["suggestion"]

    def owner_usernames(self) -> set[str]:
        return wf.ItemSubject(self.db, self.s.item).owner_usernames()

    def setting(self, name, default=None):
        # The item type's workflow settings may override the global default.
        return wf.ItemSubject(self.db, self.s.item).setting(name, default)

    def after_transition(self, ctx: wf.Context) -> None:
        if ctx.to_state in ("accepted", "accepted_modified", "rejected"):
            self.s.resolved_by_id = ctx.user.id if ctx.user else None
            self.s.resolved_at = datetime.now(timezone.utc)
            self.s.resolution_text = ctx.comment


@wf.register_subject("suggestion")
def _load(db: Session, subject_id: uuid.UUID):
    s = db.get(Suggestion, subject_id)
    return SuggestionSubject(db, s) if s else None


def _apply_pre(db, subject, cfg, ctx):
    s: Suggestion = subject.obj
    if cfg.get("modified"):
        final = ctx.payload.get("final_value")
        if final is None:
            raise wf.WorkflowError(
                "'Accept with modification' needs the modified text (final_value).", reasons=["final_value_required"]
            )
        try:
            validate_target(s.item, s.target_field, final)
        except SuggestionError as e:
            raise wf.WorkflowError(str(e))
    expected = ctx.payload.get("item_version")
    if expected is not None and int(expected) != s.item.version:
        raise wf.WorkflowError(
            f"{s.item.key} changed meanwhile (now version {s.item.version}) — reload before resolving.",
            reasons=["version_conflict"],
        )


@wf.action("apply_suggestion", pre=_apply_pre)
def _apply_action(db, subject, cfg, ctx):
    s: Suggestion = subject.obj
    s.final_value = ctx.payload.get("final_value") if cfg.get("modified") else s.proposed_value
    item_subject = wf.ItemSubject(db, s.item)
    reason = None
    if item_subject.definition() is not None:
        from app.api.v1.items import ReadContext

        reason = ReadContext(db, item_subject.project_id, [s.item]).read_only_reason(s.item)
    if reason is None:
        apply(db, s, ctx.user)
        ctx.notes["applied_version"] = s.applied_version
        return
    # Item is read-only (e.g. Approved): accepting the suggestion raises a
    # change request; the content lands once the change is accepted.
    s.apply_pending = True
    spec = item_subject.workflow()
    current = item_subject.get_state()
    request = next(
        (t for t in spec["transitions"] if current in t["from"] and t["to"] == "change_requested"), None
    )
    if request is not None:
        wf.execute(
            db, item_subject, request["key"], ctx.user,
            comment=f"Change requested by accepting {s.key}: {s.rationale}",
            system=True,
        )
        ctx.notes["change_requested"] = True
    ctx.notes["apply_pending"] = True


def _apply_pending_on_unlock(db: Session, subject: wf.ItemSubject, ctx: wf.Context) -> None:
    target = wf.state(ctx.spec, ctx.to_state) or {}
    if target.get("read_only"):
        return
    pending = (
        db.query(Suggestion)
        .filter(Suggestion.item_id == subject.id, Suggestion.apply_pending.is_(True))
        .order_by(Suggestion.resolved_at)
        .all()
    )
    for s in pending:
        apply(db, s, ctx.user)


wf.ITEM_TRANSITION_HOOKS.append(_apply_pending_on_unlock)


@wf.condition("no_open_suggestions")
def _c_no_open_suggestions(db, subject, cfg, ctx):
    if subject.kind != "item":
        return None
    q = db.query(Suggestion).filter(
        Suggestion.item_id == subject.id, Suggestion.status.in_(("open", "outdated"))
    )
    if cfg.get("severity"):
        q = q.filter(Suggestion.severity == cfg["severity"])
    n = q.count()
    return f"{n} open suggestion(s) must be resolved first." if n else None


def outdate_changed(db: Session, item: Item, exclude_id: uuid.UUID | None = None) -> bool:
    """Open suggestions whose target field changed since they were made go
    Outdated (the author is told and can rebase). Doesn't commit."""
    open_ones = db.query(Suggestion).filter(Suggestion.item_id == item.id, Suggestion.status == "open").all()
    changed = False
    for s in open_ones:
        if s.id == exclude_id or s.target_field in LINK_FIELDS:
            continue
        if current_value(db, item, s.target_field) != s.base_value:
            wf.execute(db, SuggestionSubject(db, s), "mark_outdated", None, system=True,
                       comment=f"{item.key} changed to version {item.version}.")
            changed = True
    return changed


@register_content_hook
def _outdate_on_change(db: Session, item: Item, user: User | None) -> None:
    if outdate_changed(db, item):
        db.commit()


def create(
    db: Session,
    item: Item,
    author: User,
    *,
    target_field: str,
    proposed_value: Any,
    rationale: str,
    kind: str,
    severity: str,
    review_id: uuid.UUID | None = None,
    source_comment_id: uuid.UUID | None = None,
) -> Suggestion:
    from app.services.keys import next_key

    if not (rationale or "").strip():
        raise SuggestionError("A justification is required.")
    validate_target(item, target_field, proposed_value)
    base = current_value(db, item, target_field)
    if target_field not in LINK_FIELDS and base == proposed_value:
        raise SuggestionError("The proposed value is identical to the current one.")
    project_id = item.document.project_id
    s = Suggestion(
        project_id=project_id,
        key=next_key(db, project_id, "SUG", width=4),
        item_id=item.id,
        item_version=item.version,
        target_field=target_field,
        base_value=base,
        proposed_value=proposed_value,
        rationale=rationale.strip(),
        kind=kind,
        severity=severity,
        status="open",
        review_id=review_id,
        source_comment_id=source_comment_id,
        author_id=author.id,
    )
    db.add(s)
    db.flush()
    watch(db, author, "suggestion", s.id)
    subject = SuggestionSubject(db, s)
    recipients = watchers(db, "item", item.id) + wf.resolve_targets(db, subject, ["owner"])
    notify(
        db,
        recipients,
        kind="suggestion.created",
        title=f"{s.key}: new {severity} suggestion on {item.key or item.title[:40]}",
        body=f"{author.display_name} suggests changing {target_field}: {rationale.strip()[:300]}",
        url=subject.url,
        actor=author,
        subject_type="suggestion",
        subject_id=s.id,
        badge="Suggestion",
    )
    return s


def rebase(db: Session, s: Suggestion) -> None:
    s.base_value = current_value(db, s.item, s.target_field)
    s.item_version = s.item.version
