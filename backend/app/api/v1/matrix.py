import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.document import Document
from app.models.item import Item
from app.models.link import Link
from app.schemas.matrix import MatrixAxisItem, MatrixCell, TraceabilityMatrix

router = APIRouter(tags=["matrix"])


@router.get("/projects/{project_id}/traceability-matrix", response_model=TraceabilityMatrix)
def get_traceability_matrix(
    project_id: uuid.UUID,
    row_type_id: uuid.UUID,
    col_type_id: uuid.UUID,
    link_type_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    def items_of_type(type_id: uuid.UUID) -> list[Item]:
        return (
            db.query(Item)
            .join(Document, Item.document_id == Document.id)
            .filter(Document.project_id == project_id, Item.item_type_id == type_id)
            .order_by(Item.key)
            .all()
        )

    row_items = items_of_type(row_type_id)
    col_items = items_of_type(col_type_id)
    if not row_items or not col_items:
        return TraceabilityMatrix(rows=[], cols=[], cells=[], uncovered_row_ids=[])

    row_ids = {i.id for i in row_items}
    col_ids = {i.id for i in col_items}

    links = (
        db.query(Link)
        .filter(
            Link.link_type_id == link_type_id,
            or_(
                Link.source_item_id.in_(row_ids) & Link.target_item_id.in_(col_ids),
                Link.source_item_id.in_(col_ids) & Link.target_item_id.in_(row_ids),
            ),
        )
        .all()
    )

    cell_links: dict[tuple[uuid.UUID, uuid.UUID], list[uuid.UUID]] = defaultdict(list)
    covered_rows: set[uuid.UUID] = set()
    for link in links:
        if link.source_item_id in row_ids and link.target_item_id in col_ids:
            row_id, col_id = link.source_item_id, link.target_item_id
        else:
            row_id, col_id = link.target_item_id, link.source_item_id
        cell_links[(row_id, col_id)].append(link.id)
        covered_rows.add(row_id)

    return TraceabilityMatrix(
        rows=[MatrixAxisItem(id=i.id, key=i.key, title=i.title) for i in row_items],
        cols=[MatrixAxisItem(id=i.id, key=i.key, title=i.title) for i in col_items],
        cells=[
            MatrixCell(row_id=row_id, col_id=col_id, link_ids=link_ids)
            for (row_id, col_id), link_ids in cell_links.items()
        ],
        uncovered_row_ids=[i.id for i in row_items if i.id not in covered_rows],
    )
