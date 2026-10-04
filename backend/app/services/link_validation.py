"""Enforces §4.6: a link type's `allowed_source_types`/`allowed_target_types`.

An empty list means "any item type allowed" (full ReqView-style freedom).
When non-empty, creating a link that violates the rule is rejected with a
message that names the expected types — e.g. attempting to create a
"verifies" link the wrong way around between a Requirement and a
Verification Activity.
"""

from app.models.item_type import ItemType
from app.models.link import LinkType


class LinkValidationError(ValueError):
    pass


def validate_link_types(
    link_type: LinkType,
    source_type: ItemType,
    target_type: ItemType,
    allowed_source_names: list[str],
    allowed_target_names: list[str],
) -> None:
    if link_type.allowed_source_types and str(source_type.id) not in [
        str(x) for x in link_type.allowed_source_types
    ]:
        raise LinkValidationError(
            f"Link type '{link_type.name}' requires the source item to be one of: "
            f"{', '.join(allowed_source_names)}. Got '{source_type.name}'."
        )
    if link_type.allowed_target_types and str(target_type.id) not in [
        str(x) for x in link_type.allowed_target_types
    ]:
        raise LinkValidationError(
            f"Link type '{link_type.name}' requires the target item to be one of: "
            f"{', '.join(allowed_target_names)}. Got '{target_type.name}'."
        )
