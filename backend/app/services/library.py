"""Generic requirements library: releases, adoption into projects, the
applicability decision workflow, update diffs, parameter resolution and
rule-based suggestions. See app/models/library.py."""

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.item_version import ItemVersion
from app.models.library import ApplicabilityRecord, LibraryRelease, LibraryRule, ProjectLibrary
from app.models.parameter import Parameter
from app.models.project import Project
from app.models.user import User
from app.services import audit
from app.services import workflow_engine as wf
from app.services.notifications import notify
from app.services.parameters import compute_all_values
from app.services.versioning import diff_snapshots, record_version
from app.services.workflow_templates import SYSTEM_WORKFLOWS

STATUSES = [s["key"] for s in SYSTEM_WORKFLOWS["applicability"]["states"]]
DECIDED = {"applicable", "applicable_modified", "not_applicable"}


class LibraryError(ValueError):
    pass


# ---- releases --------------------------------------------------------------


def _content_items(db: Session, library_id: uuid.UUID) -> list[Item]:
    return (
        db.query(Item)
        .join(Document, Item.document_id == Document.id)
        .join(ItemType, Item.item_type_id == ItemType.id)
        .filter(Document.project_id == library_id, ItemType.behavior == "content", Item.obsolete_at.is_(None))
        .all()
    )


def latest_release(db: Session, library_id: uuid.UUID) -> LibraryRelease | None:
    return (
        db.query(LibraryRelease)
        .filter(LibraryRelease.library_id == library_id)
        .order_by(LibraryRelease.released_at.desc())
        .first()
    )


def create_release(db: Session, library: Project, name: str, notes: str | None, user: User) -> LibraryRelease:
    if library.kind != "library":
        raise LibraryError("Only a library project can be released.")
    if db.query(LibraryRelease).filter_by(library_id=library.id, name=name).first():
        raise LibraryError(f"A release named '{name}' already exists.")
    items = _content_items(db, library.id)
    if not items:
        raise LibraryError("The library has no requirements to release.")
    previous = latest_release(db, library.id)
    release = LibraryRelease(
        library_id=library.id,
        name=name,
        notes=notes,
        item_versions={str(i.id): i.version for i in items},
        subsystems={str(i.id): i.document.name for i in items},
        previous_release_id=previous.id if previous else None,
        released_by_id=user.id,
    )
    db.add(release)
    db.flush()
    audit.log(
        db, action="library.release", subject_type="library_release", subject_id=release.id, actor=user,
        project_id=library.id, summary=f"Released {name} ({len(items)} requirements)",
    )
    # Tell every subscribed project there's a new release to assess.
    subscribers = db.query(ProjectLibrary).filter_by(library_id=library.id).all()
    for sub in subscribers:
        from app.services.workflow_engine import users_with_permission

        notify(
            db,
            users_with_permission(db, sub.project_id, "project.admin"),
            kind="library.new_release",
            title=f"{library.name}: new release {name}",
            body="Review the differences and decide whether to adopt it.",
            url=f"/projects/{sub.project_id}/applicability?library={library.id}",
            actor=user,
            subject_type="library_release",
            subject_id=release.id,
            badge="Library",
        )
    return release


def snapshot_at(db: Session, item_id: uuid.UUID | str, version: int) -> dict | None:
    v = (
        db.query(ItemVersion)
        .filter(ItemVersion.item_id == uuid.UUID(str(item_id)), ItemVersion.version == version)
        .first()
    )
    return v.snapshot if v else None


def release_diff(db: Session, old: LibraryRelease | None, new: LibraryRelease) -> dict:
    """New / changed / removed requirements between two releases."""
    old_versions = old.item_versions if old else {}
    added, changed, removed = [], [], []
    for item_id, version in new.item_versions.items():
        snap = snapshot_at(db, item_id, version) or {}
        entry = {
            "item_id": item_id,
            "key": snap.get("key"),
            "title": snap.get("title"),
            "subsystem": new.subsystems.get(item_id, ""),
            "new_version": version,
        }
        if item_id not in old_versions:
            added.append(entry)
        elif old_versions[item_id] != version:
            before = snapshot_at(db, item_id, old_versions[item_id]) or {}
            changes = [c for c in diff_snapshots(before, snap) if c["field"] not in ("order", "parent_id")]
            # A version bump that only moved the item through its workflow
            # isn't a content change for consumers.
            changes = [c for c in changes if c["field"] != "attributes.status"]
            if changes:
                changed.append({**entry, "old_version": old_versions[item_id], "changes": changes})
    for item_id, version in old_versions.items():
        if item_id not in new.item_versions:
            snap = snapshot_at(db, item_id, version) or {}
            removed.append(
                {
                    "item_id": item_id,
                    "key": snap.get("key"),
                    "title": snap.get("title"),
                    "subsystem": old.subsystems.get(item_id, "") if old else "",
                    "old_version": version,
                }
            )
    return {"added": added, "changed": changed, "removed": removed}


# ---- adoption ----------------------------------------------------------------


def subscribe(
    db: Session,
    project: Project,
    library: Project,
    release: LibraryRelease,
    user: User,
    target_document_id: uuid.UUID | None = None,
) -> ProjectLibrary:
    if library.kind != "library" or release.library_id != library.id:
        raise LibraryError("That release doesn't belong to that library.")
    if project.kind == "library":
        raise LibraryError("A library can't import another library.")
    if db.query(ProjectLibrary).filter_by(project_id=project.id, library_id=library.id).first():
        raise LibraryError("This project already uses that library — adopt a newer release instead.")
    sub = ProjectLibrary(
        project_id=project.id, library_id=library.id, release_id=release.id, target_document_id=target_document_id
    )
    db.add(sub)
    for item_id, version in release.item_versions.items():
        db.add(
            ApplicabilityRecord(
                project_id=project.id,
                library_id=library.id,
                release_id=release.id,
                source_item_id=uuid.UUID(item_id),
                source_version=version,
                subsystem=release.subsystems.get(item_id, ""),
                status="to_be_assessed",
            )
        )
    db.flush()
    apply_rules(db, project)
    audit.log(
        db, action="library.import", subject_type="project_library", subject_id=sub.id, actor=user,
        project_id=project.id,
        summary=f"Imported {library.name} {release.name}: {len(release.item_versions)} applicability records",
    )
    return sub


def adopt(db: Session, project: Project, sub: ProjectLibrary, release: LibraryRelease, user: User) -> dict:
    """Move the project to a newer release: new requirements arrive as To be
    assessed, changed and removed ones become suspect."""
    if release.library_id != sub.library_id:
        raise LibraryError("That release belongs to a different library.")
    if release.id == sub.release_id:
        raise LibraryError("The project already uses this release.")
    current = db.get(LibraryRelease, sub.release_id)
    diff = release_diff(db, current, release)
    records = {
        str(r.source_item_id): r
        for r in db.query(ApplicabilityRecord).filter_by(project_id=project.id, library_id=sub.library_id).all()
    }
    for entry in diff["added"]:
        if entry["item_id"] in records:  # re-added after removal
            r = records[entry["item_id"]]
            r.removed_from_library = False
            r.source_version = entry["new_version"]
            r.suspect = True
            r.suspect_reason = f"Re-added in {release.name}."
            continue
        db.add(
            ApplicabilityRecord(
                project_id=project.id,
                library_id=sub.library_id,
                release_id=release.id,
                source_item_id=uuid.UUID(entry["item_id"]),
                source_version=entry["new_version"],
                subsystem=entry["subsystem"],
                status="to_be_assessed",
            )
        )
    for entry in diff["changed"]:
        r = records.get(entry["item_id"])
        if r is None:
            continue
        r.source_version = entry["new_version"]
        r.suspect = r.status != "to_be_assessed"
        r.suspect_reason = (
            f"Changed in {release.name} (v{entry['old_version']} → v{entry['new_version']}): "
            + ", ".join(c["field"].replace("attributes.", "") for c in entry["changes"])
        )
    for entry in diff["removed"]:
        r = records.get(entry["item_id"])
        if r is None:
            continue
        r.removed_from_library = True
        r.suspect = True
        r.suspect_reason = f"Removed from the library in {release.name}."
    for r in records.values():
        r.release_id = release.id
    previous_name = current.name if current else "—"
    sub.release_id = release.id
    sub.declined_release_id = None
    sub.declined_justification = None
    db.flush()
    apply_rules(db, project)
    audit.log(
        db, action="library.adopt", subject_type="project_library", subject_id=sub.id, actor=user,
        project_id=project.id,
        summary=f"Adopted {release.name} (from {previous_name}): {len(diff['added'])} new, "
        f"{len(diff['changed'])} changed, {len(diff['removed'])} removed",
    )
    return diff


def decline(db: Session, project: Project, sub: ProjectLibrary, release: LibraryRelease, justification: str, user: User):
    if not (justification or "").strip():
        raise LibraryError("Staying on the previous release needs a justification.")
    sub.declined_release_id = release.id
    sub.declined_justification = justification.strip()
    audit.log(
        db, action="library.decline", subject_type="project_library", subject_id=sub.id, actor=user,
        project_id=project.id, summary=f"Stayed on {sub.release.name}, did not adopt {release.name}",
        payload={"justification": justification.strip()},
    )


# ---- parameters & rules -------------------------------------------------------

_PARAM = re.compile(r"\{\{param:([A-Za-z0-9_]+)\}\}")


def parameter_values(db: Session, project_id: uuid.UUID) -> dict[str, tuple[Any, str | None]]:
    params = db.query(Parameter).filter(Parameter.project_id == project_id).all()
    values = compute_all_values(params)
    return {p.key: (values.get(p.key), p.unit) for p in params}


def resolve_text(text: str | None, values: dict[str, tuple[Any, str | None]]) -> tuple[str, list[str]]:
    """Substitute {{param:KEY}} with this project's parameter values.
    Returns the text and the keys that have no value in this project."""
    missing: list[str] = []

    def repl(m: re.Match) -> str:
        key = m.group(1)
        if key in values and values[key][0] is not None:
            v, unit = values[key]
            v = int(v) if isinstance(v, float) and v.is_integer() else v
            return f"{v}{(' ' + unit) if unit else ''}"
        missing.append(key)
        return f"⟨{key}?⟩"

    return _PARAM.sub(repl, text or ""), missing


_OPS = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "in": lambda a, b: a in (b or []),
    "not_in": lambda a, b: a not in (b or []),
    "gt": lambda a, b: a is not None and b is not None and a > b,
    "lt": lambda a, b: a is not None and b is not None and a < b,
    "truthy": lambda a, b: bool(a),
    "falsy": lambda a, b: not a,
}


def evaluate_rules(rules: list[dict], attributes: dict) -> tuple[str | None, str | None]:
    for rule in rules:
        op = _OPS.get(rule.get("op", "eq"))
        attr = rule.get("attribute")
        if op is None or attr is None or attr not in attributes:
            continue
        try:
            if op(attributes.get(attr), rule.get("value")):
                return rule.get("suggest"), rule.get("reason") or f"{attr} {rule.get('op')} {rule.get('value')}"
        except TypeError:
            continue
    return None, None


def apply_rules(db: Session, project: Project) -> int:
    """Refresh rule-based suggestions on undecided records. Never changes a
    status by itself."""
    records = (
        db.query(ApplicabilityRecord)
        .filter(ApplicabilityRecord.project_id == project.id)
        .all()
    )
    if not records:
        return 0
    rules_by_item = {
        r.item_id: r.rules
        for r in db.query(LibraryRule).filter(LibraryRule.item_id.in_([x.source_item_id for x in records])).all()
    }
    count = 0
    for r in records:
        suggest, reason = evaluate_rules(rules_by_item.get(r.source_item_id, []), project.mission_attributes or {})
        if suggest not in (None, "applicable", "not_applicable"):
            suggest = None
        r.suggested_status = suggest
        r.suggested_reason = reason if suggest else None
        count += bool(suggest)
    db.flush()
    return count


# ---- workflow subject -----------------------------------------------------------


class ApplicabilitySubject(wf.Subject):
    def __init__(self, db: Session, record: ApplicabilityRecord):
        super().__init__(kind="applicability", obj=record, db=db)

    @property
    def r(self) -> ApplicabilityRecord:
        return self.obj

    @property
    def label(self) -> str:
        snap = snapshot_at(self.db, self.r.source_item_id, self.r.source_version) or {}
        return f"Applicability of {snap.get('key') or 'library requirement'}"

    @property
    def url(self) -> str:
        return f"/projects/{self.r.project_id}/applicability?record={self.r.id}"

    def workflow(self) -> dict:
        return SYSTEM_WORKFLOWS["applicability"]

    def author_ids(self) -> set[uuid.UUID]:
        return {self.r.decided_by_id} if self.r.decided_by_id else set()

    def field_value(self, name: str):
        return getattr(self.r, name, None)

    def after_transition(self, ctx: wf.Context) -> None:
        now = datetime.now(timezone.utc)
        r = self.r
        if ctx.from_state == "applicable_modified" and ctx.to_state != "applicable_modified" and r.modified_item_id:
            _retire_copy(self.db, r, ctx)
        if ctx.transition["key"] in ("approve_not_applicable",):
            r.approved_by_id = ctx.user.id if ctx.user else None
            r.approved_at = now
        else:
            r.decided_by_id = ctx.user.id if ctx.user else None
            r.decided_at = now
            r.approved_by_id = None
            r.approved_at = None
        if ctx.comment:
            r.rationale = ctx.comment
        if ctx.to_state in DECIDED or ctx.to_state == "not_applicable_pending":
            r.suspect = False
            r.suspect_reason = None


@wf.register_subject("applicability")
def _load(db: Session, subject_id: uuid.UUID):
    r = db.get(ApplicabilityRecord, subject_id)
    return ApplicabilitySubject(db, r) if r else None


def _retire_copy(db: Session, r: ApplicabilityRecord, ctx: wf.Context) -> None:
    copy = db.get(Item, r.modified_item_id)
    if copy is None or copy.obsolete_at is not None:
        return
    subject = wf.ItemSubject(db, copy)
    if subject.definition() is None:
        return
    spec = subject.workflow()
    retire = next(
        (t for t in spec["transitions"] if subject.get_state() in t["from"]
         and (wf.state(spec, t["to"]) or {}).get("is_obsolete")),
        None,
    )
    if retire:
        wf.execute(db, subject, retire["key"], ctx.user, system=True,
                   comment="Applicability decision changed — modified copy no longer used.")


def _copy_pre(db, subject, cfg, ctx):
    r: ApplicabilityRecord = subject.obj
    doc_id = ctx.payload.get("document_id")
    if not doc_id:
        sub = db.query(ProjectLibrary).filter_by(project_id=r.project_id, library_id=r.library_id).first()
        doc_id = sub.target_document_id if sub else None
    document = db.get(Document, uuid.UUID(str(doc_id))) if doc_id else None
    if document is None or document.project_id != r.project_id:
        raise wf.WorkflowError(
            "Choose the project document the modified requirement goes into.", reasons=["document_required"]
        )
    ctx.notes["document_id"] = str(document.id)


@wf.action("create_modified_copy", pre=_copy_pre)
def _create_modified_copy(db, subject, cfg, ctx):
    """Create (or reuse) the project's own modified copy of the library
    requirement. The copy then follows the normal requirement workflow, so
    the modification itself gets reviewed and approved."""
    from app.api.v1.items import _next_key  # noqa: PLC0415 — shared key minting

    r: ApplicabilityRecord = subject.obj
    if r.modified_item_id:
        existing = db.get(Item, r.modified_item_id)
        if existing is not None and existing.obsolete_at is None:
            return
    snap = snapshot_at(db, r.source_item_id, r.source_version) or {}
    source = db.get(Item, r.source_item_id)
    document = db.get(Document, uuid.UUID(ctx.notes["document_id"]))
    item_type = source.item_type
    definition = wf.resolve_item_definition(db, r.project_id, item_type.id)
    attributes = {k: v for k, v in (snap.get("attributes") or {}).items() if k != wf.STATUS_KEY}
    if definition is not None:
        attributes[wf.STATUS_KEY] = wf.initial_state({"states": definition.states})
    title = ctx.payload.get("title") or snap.get("title") or source.title
    description = ctx.payload.get("description_md")
    if description is None:
        description = snap.get("description_md")
    max_order = max([i.order for i in document.items if i.parent_id is None] or [0])
    copy = Item(
        document_id=document.id,
        parent_id=None,
        item_type_id=item_type.id,
        title=title,
        description_md=description,
        attributes=attributes,
        order=max_order + 1,
        key=_next_key(db, r.project_id, item_type),
        updated_by=ctx.user.username if ctx.user else "system",
        source_item_id=source.id,
        source_version=r.source_version,
    )
    db.add(copy)
    record_version(db, copy, changed_by=ctx.user, reason="create", initial=True,
                   note=f"Modified copy of library requirement {snap.get('key')} v{r.source_version}")
    r.modified_item_id = copy.id
    ctx.notes["modified_item"] = copy.key


@wf.condition("applicability_complete")
def _c_applicability_complete(db, subject, cfg, ctx):
    pid = subject.project_id
    if not pid:
        return None
    n = (
        db.query(ApplicabilityRecord)
        .filter(ApplicabilityRecord.project_id == pid, ApplicabilityRecord.status == "to_be_assessed")
        .count()
    )
    return f"The applicability matrix still has {n} record(s) to be assessed." if n else None


def summary(db: Session, project_id: uuid.UUID) -> dict:
    rows = db.query(ApplicabilityRecord).filter(ApplicabilityRecord.project_id == project_id).all()
    by_subsystem: dict[str, dict[str, int]] = {}
    totals = {s: 0 for s in STATUSES}
    suspect = 0
    for r in rows:
        bucket = by_subsystem.setdefault(r.subsystem or "—", {s: 0 for s in STATUSES})
        bucket[r.status] = bucket.get(r.status, 0) + 1
        totals[r.status] = totals.get(r.status, 0) + 1
        suspect += r.suspect
    return {
        "total": len(rows),
        "totals": totals,
        "by_subsystem": by_subsystem,
        "suspect": suspect,
        "complete": totals.get("to_be_assessed", 0) == 0 and len(rows) > 0,
    }


def modification_diff(db: Session, r: ApplicabilityRecord) -> list[dict]:
    if not r.modified_item_id:
        return []
    copy = db.get(Item, r.modified_item_id)
    snap = snapshot_at(db, r.source_item_id, r.source_version) or {}
    from app.services.versioning import snapshot

    current = snapshot(copy)
    return [
        c for c in diff_snapshots(snap, current)
        if c["field"] in ("title", "description_md") or (
            c["field"].startswith("attributes.") and c["field"] != "attributes.status"
        )
    ]
