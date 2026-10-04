import uuid

from pydantic import BaseModel


class GraphNode(BaseModel):
    id: uuid.UUID
    key: str | None
    title: str
    item_type_id: uuid.UUID
    status: str | None = None
    depth: int  # negative = upstream, 0 = center, positive = downstream


class GraphEdge(BaseModel):
    source: uuid.UUID
    target: uuid.UUID
    link_type_id: uuid.UUID
    label: str


class ItemGraph(BaseModel):
    center_id: uuid.UUID
    nodes: list[GraphNode]
    edges: list[GraphEdge]
