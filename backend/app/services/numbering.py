"""Computes Word-style outline numbers for structural items (§4.3).

Numbers are derived purely from tree position and sibling order at render
time — never stored — so reordering or inserting a section renumbers
everything below it automatically. Content items keep their own stable
`key` (e.g. SYS-042) and never receive a computed number.
"""

from app.schemas.item import ItemRead


def assign_numbers(nodes: list[ItemRead], behaviors: dict, prefix: str = "") -> None:
    counter = 0
    for node in nodes:
        if behaviors.get(node.item_type_id) == "structural":
            counter += 1
            node.number = f"{prefix}{counter}"
            assign_numbers(node.children, behaviors, f"{node.number}.")
        else:
            node.number = None
