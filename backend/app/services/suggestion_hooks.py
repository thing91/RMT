"""Reactions to an item's content changing, kept out of app/api/v1/items.py
so the items API doesn't need to know about everything that depends on an
item's text (open change suggestions, applicability records, ...).

Called after the item change is committed.
"""

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.user import User

_HOOKS = []


def register(fn):
    _HOOKS.append(fn)
    return fn


def on_item_content_changed(db: Session, item: Item, user: User | None) -> None:
    for hook in _HOOKS:
        hook(db, item, user)
