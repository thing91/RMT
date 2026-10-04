"""§8.1: one neutral `DocumentTree` shared by every export renderer, instead
of each format re-implementing "how to flatten the hierarchy".
"""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.item_type import ItemType
from app.models.link import Link, LinkType


@dataclass
class LinkRef:
    label: str  # link type name, or its inverse_name for an incoming link
    target_id: str  # the OTHER item's id
    target_key: str | None
    target_title: str
    in_document: bool  # whether target_id has a node in this same export


@dataclass
class DocumentNode:
    id: str
    kind: str  # "structural" | "content"
    level: int
    number: str | None
    key: str | None
    title: str
    description_md: str | None
    attributes: dict = field(default_factory=dict)
    links: list[LinkRef] = field(default_factory=list)


def _numbering(items: list[Item], behaviors: dict, parent_id, prefix="") -> dict:
    numbers: dict = {}
    siblings = sorted((i for i in items if i.parent_id == parent_id), key=lambda i: i.order)
    counter = 0
    for item in siblings:
        if behaviors.get(item.item_type_id) == "structural":
            counter += 1
            number = f"{prefix}{counter}"
            numbers[item.id] = number
            numbers.update(_numbering(items, behaviors, item.id, f"{number}."))
        else:
            numbers[item.id] = None
    return numbers


def attribute_columns(item_types: list[ItemType]) -> list[tuple[str, str]]:
    """Union of (key, label) across every content type's non-deprecated
    attributes, de-duplicated by key in first-seen order."""
    columns: list[tuple[str, str]] = []
    seen = set()
    for t in item_types:
        if t.behavior != "content":
            continue
        for attr in t.attributes:
            if attr.deprecated or attr.key in seen:
                continue
            seen.add(attr.key)
            columns.append((attr.key, attr.label))
    return columns


def rich_text_keys(item_types: list[ItemType]) -> set[str]:
    """Attribute keys whose values are `rich_text` (Markdown) — so a
    renderer knows which attribute values need glossary/reference/parameter
    resolution + Markdown rendering, not just plain-text escaping (§ known
    simplification: this was previously description_md-only)."""
    return {
        attr.key
        for t in item_types
        if t.behavior == "content"
        for attr in t.attributes
        if attr.data_type == "rich_text" and not attr.deprecated
    }


def _load_links(db: Session, item_ids: list) -> dict:
    """Every link touching this set of items, in both directions, keyed by
    the item id on OUR side — resolving the other item even when it lives
    outside the exported document, so the renderer can tell an in-page jump
    apart from a reference it simply can't make clickable (§8.1 note in the
    HTML renderer)."""
    if not item_ids:
        return {}

    rows = (
        db.query(Link, LinkType)
        .join(LinkType, Link.link_type_id == LinkType.id)
        .filter(
            (Link.source_item_id.in_(item_ids)) | (Link.target_item_id.in_(item_ids))
        )
        .all()
    )

    other_ids = set()
    for link, _ in rows:
        other_ids.add(link.source_item_id)
        other_ids.add(link.target_item_id)
    other_items = {i.id: i for i in db.query(Item).filter(Item.id.in_(other_ids)).all()}

    by_item: dict = {}
    for link, link_type in rows:
        if link.source_item_id in item_ids:
            other = other_items.get(link.target_item_id)
            if other:
                by_item.setdefault(link.source_item_id, []).append((link_type.name, other))
        if link.target_item_id in item_ids and link.target_item_id != link.source_item_id:
            other = other_items.get(link.source_item_id)
            if other:
                by_item.setdefault(link.target_item_id, []).append(
                    (link_type.inverse_name, other)
                )
    return by_item


def build_document_tree(
    db: Session, items: list[Item], item_types: list[ItemType]
) -> list[DocumentNode]:
    types_by_id = {t.id: t for t in item_types}
    behaviors = {t.id: t.behavior for t in item_types}
    numbers = _numbering(items, behaviors, None)

    by_id = {i.id: i for i in items}
    links_by_item = _load_links(db, list(by_id.keys()))

    def depth(item: Item) -> int:
        level = 0
        node = item
        seen = set()
        while node.parent_id is not None and node.parent_id not in seen:
            seen.add(node.parent_id)
            node = by_id.get(node.parent_id)
            if node is None:
                break
            level += 1
        return level

    def sort_key(item: Item):
        chain = []
        node = item
        seen = set()
        while node is not None and node.id not in seen:
            seen.add(node.id)
            chain.append((node.parent_id, node.order))
            node = by_id.get(node.parent_id)
        return list(reversed(chain))

    nodes = []
    for item in sorted(items, key=sort_key):
        item_type = types_by_id.get(item.item_type_id)
        is_structural = item_type is not None and item_type.behavior == "structural"
        links = [
            LinkRef(
                label=label,
                target_id=str(target.id),
                target_key=target.key,
                target_title=target.title,
                in_document=target.id in by_id,
            )
            for label, target in links_by_item.get(item.id, [])
        ]
        nodes.append(
            DocumentNode(
                id=str(item.id),
                kind="structural" if is_structural else "content",
                level=depth(item),
                number=numbers.get(item.id),
                key=None if is_structural else item.key,
                title=item.title,
                description_md=None if is_structural else item.description_md,
                attributes={} if is_structural else item.attributes,
                links=[] if is_structural else links,
            )
        )
    return nodes
