"""Idempotent data bootstrapping shared by app.seed and Alembic data
migrations: default workflows per content item type and version-1
snapshots for items that predate versioning."""

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.item_type import ItemType
from app.models.item_version import ItemVersion
from app.models.organization import Organization
from app.models.workflow_def import WorkflowDefinition
from app.services.versioning import snapshot
from app.services.workflow_engine import STATUS_KEY, apply_template, initial_state
from app.services.workflow_templates import DEFAULT_ITEM_TEMPLATE, ITEM_TEMPLATES

# Item type key → template; anything else gets DEFAULT_ITEM_TEMPLATE.
TEMPLATE_FOR_TYPE = {
    "requirement": "change_managed",
    "verification_activity": "test_case",
    "test_case": "test_case",
}


def ensure_default_workflow(db: Session, item_type: ItemType) -> WorkflowDefinition | None:
    if item_type.behavior != "content":
        return None
    existing = (
        db.query(WorkflowDefinition)
        .filter(WorkflowDefinition.item_type_id == item_type.id, WorkflowDefinition.project_id.is_(None))
        .first()
    )
    if existing:
        return existing
    template = ITEM_TEMPLATES[TEMPLATE_FOR_TYPE.get(item_type.key, DEFAULT_ITEM_TEMPLATE)]
    d = apply_template(db, org_id=item_type.org_id, item_type_id=item_type.id, template=template)
    # Items of this type that never had a status start in the initial state.
    start = initial_state(template)
    for item in db.query(Item).filter(Item.item_type_id == item_type.id).all():
        if not (item.attributes or {}).get(STATUS_KEY):
            item.attributes = {**(item.attributes or {}), STATUS_KEY: start}
        elif item.attributes[STATUS_KEY] not in {s["key"] for s in template["states"]}:
            # Unknown legacy value — keep it visible as a deprecated option
            # (sync_status_enum keeps old options) rather than rewriting data.
            pass
    db.flush()
    return d


def ensure_default_workflows(db: Session, org: Organization) -> None:
    for item_type in db.query(ItemType).filter(ItemType.org_id == org.id).all():
        ensure_default_workflow(db, item_type)


def ensure_item_versions(db: Session) -> int:
    """Give every item without any version history a version-1 snapshot."""
    versioned = {row[0] for row in db.query(ItemVersion.item_id).distinct().all()}
    created = 0
    for item in db.query(Item).all():
        if item.id in versioned:
            continue
        item.version = 1
        db.add(
            ItemVersion(
                item_id=item.id,
                version=1,
                snapshot=snapshot(item),
                reason="migration",
                note="Baseline version created when item versioning was introduced.",
            )
        )
        created += 1
    db.flush()
    return created
