"""§6: relationship graph — BFS over the `links` table, walked separately
upstream/downstream relative to link direction, independent of where an
item sits in a document tree (deliberately a different view from the tree,
per the brief's own note that conflating the two confuses DOORS/ReqView
users).

Direction convention (the brief doesn't pin one down, so this is ours,
applied consistently): "up" follows a node's OUTGOING links — what it
points to (e.g. what a Requirement derives from); "down" follows INCOMING
links — what points at it (e.g. what verifies it, what derives from it).
"""

import uuid

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.link import Link, LinkType

_MAX_DEPTH = 10  # stands in for "all" — a real cap, not an actual unlimited walk


def build_item_graph(
    db: Session,
    center: Item,
    direction: str,
    depth_up: int | None,
    depth_down: int | None,
    link_type_ids: set[uuid.UUID] | None,
):
    nodes: dict[uuid.UUID, int] = {center.id: 0}
    edges: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = []
    seen_edges: set[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = set()

    def link_query(item_ids: set[uuid.UUID], outgoing: bool):
        col = Link.source_item_id if outgoing else Link.target_item_id
        q = db.query(Link).filter(col.in_(item_ids))
        if link_type_ids:
            q = q.filter(Link.link_type_id.in_(link_type_ids))
        return q.all()

    def walk(outgoing: bool, max_depth: int, sign: int):
        frontier = {center.id}
        depth = 0
        while frontier and depth < min(max_depth, _MAX_DEPTH):
            links = link_query(frontier, outgoing)
            next_frontier = set()
            for link in links:
                other_id = link.target_item_id if outgoing else link.source_item_id
                edge_key = (link.source_item_id, link.target_item_id, link.link_type_id)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append(edge_key)
                if other_id not in nodes:
                    nodes[other_id] = sign * (depth + 1)
                    next_frontier.add(other_id)
            frontier = next_frontier
            depth += 1

    if direction in ("up", "both") and (depth_up is None or depth_up > 0):
        walk(outgoing=True, max_depth=depth_up if depth_up is not None else _MAX_DEPTH, sign=-1)
    if direction in ("down", "both") and (depth_down is None or depth_down > 0):
        walk(outgoing=False, max_depth=depth_down if depth_down is not None else _MAX_DEPTH, sign=1)

    items_by_id = {i.id: i for i in db.query(Item).filter(Item.id.in_(nodes.keys())).all()}
    link_types_by_id = {
        lt.id: lt
        for lt in db.query(LinkType).filter(LinkType.id.in_({e[2] for e in edges})).all()
    }

    return items_by_id, nodes, edges, link_types_by_id
