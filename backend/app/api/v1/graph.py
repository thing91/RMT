import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.link import LinkType
from app.models.user import User
from app.schemas.graph import GraphEdge, GraphNode, ItemGraph
from app.services.graph import build_item_graph
from app.services.permissions import can_read

router = APIRouter(tags=["graph"])


def _parse_depth(value: str | None) -> int | None:
    """None (param omitted) means "use the default depth"; "all" means
    unlimited (capped internally); anything else must be a non-negative
    integer — matches the brief's illustrative `depth_down=all` shape."""
    if value is None:
        return 3
    if value == "all":
        return None
    try:
        parsed = int(value)
    except ValueError:
        raise HTTPException(422, f"Invalid depth '{value}': must be an integer or 'all'.")
    if parsed < 0:
        raise HTTPException(422, "Depth must be >= 0.")
    return parsed


@router.get("/items/{item_id}/graph", response_model=ItemGraph)
def get_item_graph(
    item_id: uuid.UUID,
    direction: Literal["up", "down", "both"] = "both",
    depth_up: str | None = Query(default=None),
    depth_down: str | None = Query(default=None),
    link_types: str | None = Query(default=None, description="Comma-separated link type keys"),
    user: User | None = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    center = db.get(Item, item_id)
    if not center:
        raise HTTPException(404, "Item not found")
    project = center.document.project
    if not can_read(db, project, user.id if user else None):
        raise HTTPException(404, "Item not found")

    link_type_ids = None
    if link_types:
        keys = {k.strip() for k in link_types.split(",") if k.strip()}
        rows = (
            db.query(LinkType)
            .filter(LinkType.org_id == project.org_id, LinkType.key.in_(keys))
            .all()
        )
        link_type_ids = {lt.id for lt in rows}

    items_by_id, node_depths, edges, link_types_by_id = build_item_graph(
        db,
        center,
        direction,
        _parse_depth(depth_up),
        _parse_depth(depth_down),
        link_type_ids,
    )

    item_types_by_id = {
        t.id: t
        for t in db.query(ItemType).filter(ItemType.org_id == project.org_id).all()
    }

    nodes = [
        GraphNode(
            id=item.id,
            key=item.key,
            title=item.title,
            item_type_id=item.item_type_id,
            status=item.attributes.get("status"),
            depth=node_depths[item.id],
        )
        for item in items_by_id.values()
        if item_types_by_id.get(item.item_type_id) is not None
    ]
    edge_models = [
        GraphEdge(source=s, target=t, link_type_id=lt, label=link_types_by_id[lt].name)
        for s, t, lt in edges
        if lt in link_types_by_id
    ]

    return ItemGraph(center_id=center.id, nodes=nodes, edges=edge_models)
