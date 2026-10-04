import uuid

from pydantic import BaseModel


class MatrixAxisItem(BaseModel):
    id: uuid.UUID
    key: str | None
    title: str


class MatrixCell(BaseModel):
    row_id: uuid.UUID
    col_id: uuid.UUID
    link_ids: list[uuid.UUID]


class TraceabilityMatrix(BaseModel):
    rows: list[MatrixAxisItem]
    cols: list[MatrixAxisItem]
    cells: list[MatrixCell]
    uncovered_row_ids: list[uuid.UUID]
