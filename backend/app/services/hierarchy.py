"""Enforces §4.3: only `structural` items may have children.

`content` items (Requirement, Verification Activity, any custom type) are
always leaves; a content item's parent must be a structural item or null.
"""


class HierarchyError(ValueError):
    pass


def validate_parent(parent_behavior: str | None) -> None:
    if parent_behavior is None:
        return
    if parent_behavior != "structural":
        raise HierarchyError(
            "Items can only be nested under a Section (structural item). "
            f"The chosen parent is a '{parent_behavior}' item and cannot have children."
        )
