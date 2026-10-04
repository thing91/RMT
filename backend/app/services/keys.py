"""Human-readable sequential keys (CR-001, REV-001, SUG-0042, IDEA-17).

Uses a row in `key_counters` per (scope, prefix), locked FOR UPDATE, so two
concurrent requests can never mint the same key.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session


def next_key(db: Session, scope_id: uuid.UUID, prefix: str, width: int = 3) -> str:
    db.execute(
        text(
            "INSERT INTO key_counters (scope_id, prefix, last_value) VALUES (:s, :p, 0) "
            "ON CONFLICT (scope_id, prefix) DO NOTHING"
        ),
        {"s": scope_id, "p": prefix},
    )
    value = db.execute(
        text(
            "UPDATE key_counters SET last_value = last_value + 1 "
            "WHERE scope_id = :s AND prefix = :p RETURNING last_value"
        ),
        {"s": scope_id, "p": prefix},
    ).scalar_one()
    return f"{prefix}-{value:0{width}d}"
