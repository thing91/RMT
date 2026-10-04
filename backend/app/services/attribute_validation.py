"""Server-side validation of `items.attributes` against `item_type_attributes` (§4.5).

Runs on every write regardless of caller (UI, API, import) so the schema
defined per item type can never be bypassed.
"""

from app.models.item_type import ItemTypeAttribute


class AttributeValidationError(ValueError):
    pass


def validate_attributes(attribute_defs: list[ItemTypeAttribute], attributes: dict) -> None:
    defs_by_key = {a.key: a for a in attribute_defs}

    for key, value in attributes.items():
        if key not in defs_by_key:
            raise AttributeValidationError(f"Unknown attribute '{key}' for this item type.")

    for attr in attribute_defs:
        value = attributes.get(attr.key)

        if value is None:
            if attr.required:
                raise AttributeValidationError(f"Attribute '{attr.label}' is required.")
            continue

        _validate_value(attr, value)


def _validate_value(attr: ItemTypeAttribute, value) -> None:
    label = attr.label

    if attr.data_type in ("text", "rich_text", "user_ref", "item_ref"):
        if not isinstance(value, str):
            raise AttributeValidationError(f"Attribute '{label}' must be a string.")

    elif attr.data_type == "enum":
        # deprecated options stay valid for items that already hold them (§4.5) —
        # only the picker for new values hides them, enforced in the frontend.
        options = {o["value"] for o in (attr.enum_options or [])}
        if value not in options:
            raise AttributeValidationError(f"'{value}' is not a valid option for '{label}'.")

    elif attr.data_type == "multi_enum":
        if not isinstance(value, list):
            raise AttributeValidationError(f"Attribute '{label}' must be a list of options.")
        options = {o["value"] for o in (attr.enum_options or [])}
        for v in value:
            if v not in options:
                raise AttributeValidationError(f"'{v}' is not a valid option for '{label}'.")

    elif attr.data_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise AttributeValidationError(f"Attribute '{label}' must be a number.")
        if attr.min is not None and value < attr.min:
            raise AttributeValidationError(f"Attribute '{label}' must be >= {attr.min}.")
        if attr.max is not None and value > attr.max:
            raise AttributeValidationError(f"Attribute '{label}' must be <= {attr.max}.")

    elif attr.data_type == "boolean":
        if not isinstance(value, bool):
            raise AttributeValidationError(f"Attribute '{label}' must be true or false.")

    elif attr.data_type == "date":
        if not isinstance(value, str):
            raise AttributeValidationError(
                f"Attribute '{label}' must be an ISO date string."
            )
