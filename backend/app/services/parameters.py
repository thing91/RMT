"""§5.3 + §5.5: `{{param:KEY}}` is the second instance of the shared
"custom Markdown syntax resolved by a preprocessing step" mechanism
(app/services/glossary.py's docstring). Also home to the safe formula
evaluator for `derived` parameters — restricted to arithmetic over other
parameters' keys, never Python's `eval()` — with cycle detection, since a
dependency graph is what separates this from a "nice gadget" per the brief.
"""

import ast
import html
import operator
import re
import uuid

from sqlalchemy.orm import Session

from app.models.parameter import Parameter, ParameterLink

_REF_PATTERN = re.compile(r"\{\{param:([A-Za-z0-9_]+)\}\}")

_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}


class ParameterError(ValueError):
    pass


def extract_parameter_refs(text: str | None) -> set[str]:
    if not text:
        return set()
    return {m.group(1) for m in _REF_PATTERN.finditer(text)}


def _eval_node(node: ast.AST, values: dict[str, float]) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, values)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ParameterError(f"Unsupported constant: {node.value!r}")
    if isinstance(node, ast.Name):
        if node.id not in values:
            raise ParameterError(f"Unknown parameter reference '{node.id}' in formula.")
        return values[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        return _ALLOWED_BINOPS[type(node.op)](_eval_node(node.left, values), _eval_node(node.right, values))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_node(node.operand, values)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
        return _eval_node(node.operand, values)
    raise ParameterError(f"Unsupported expression: {ast.dump(node)}")


def eval_formula(formula: str, values: dict[str, float]) -> float:
    """Restricted AST evaluator — only +,-,*,/,**, parentheses, numbers and
    known parameter keys. Never falls back to `eval()`."""
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as e:
        raise ParameterError(f"Invalid formula syntax: {e}") from e
    return _eval_node(tree, values)


def compute_all_values(params: list[Parameter]) -> dict[str, float | None]:
    """Resolves every parameter's current value, including `derived` ones —
    recursive with memoization, which gets the same correctness as an
    explicit topological sort for the scale this is used at, plus cycle
    detection via the `visiting` set (raises rather than infinite-looping).
    A `derived` parameter with a formula error or missing dependency
    resolves to None rather than failing the whole batch.
    """
    by_key = {p.key: p for p in params}
    resolved: dict[str, float | None] = {}
    visiting: set[str] = set()

    def resolve(key: str) -> float | None:
        if key in resolved:
            return resolved[key]
        if key in visiting:
            raise ParameterError(f"Circular dependency involving '{key}'.")
        param = by_key.get(key)
        if param is None:
            return None
        if param.data_type != "derived":
            resolved[key] = param.value
            return param.value
        visiting.add(key)
        try:
            deps = {k: resolve(k) for k in by_key if k != key}
            deps = {k: v for k, v in deps.items() if v is not None}
            value = eval_formula(param.formula or "0", deps)
        except ParameterError:
            value = None
        visiting.discard(key)
        resolved[key] = value
        return value

    for key in by_key:
        resolve(key)
    return resolved


def resolve_parameter_refs_html(text: str, params_by_key: dict[str, Parameter], values: dict[str, float | None]) -> str:
    """Substitutes the current value inline — the requirement text itself
    never changes, but the number always reflects the parameter's live (or,
    for a baseline export, frozen) value."""

    def replace(match: re.Match) -> str:
        key = match.group(1)
        param = params_by_key.get(key)
        if not param:
            return html.escape(match.group(0))
        value = values.get(key)
        display = "?" if value is None else _format_number(value)
        unit = f" {param.unit}" if param.unit else ""
        title = html.escape(f"{param.name} ({param.data_type}, source: {param.source})")
        return f'<span class="param-ref" title="{title}">{html.escape(display)}{html.escape(unit)}</span>'

    return _REF_PATTERN.sub(replace, text)


def sync_parameter_links(db: Session, project_id: uuid.UUID, item_id: uuid.UUID, text: str | None) -> None:
    """Keeps `parameter_links` (§5.3 "used in" traceability) matching
    whatever `{{param:KEY}}` refs currently appear in `text` — called after
    every item create/update alongside the git sync, same "derive from
    current content" spirit. Silently ignores refs to a key that doesn't
    exist in this project (same as an unresolved glossary/ref citation)."""
    referenced_keys = extract_parameter_refs(text)
    current = (
        db.query(ParameterLink)
        .filter(ParameterLink.item_id == item_id)
        .all()
    )
    current_by_param_id = {link.parameter_id: link for link in current}
    params_by_key = {
        p.key: p for p in db.query(Parameter).filter(Parameter.project_id == project_id).all()
    }
    wanted_param_ids = {params_by_key[k].id for k in referenced_keys if k in params_by_key}

    for link in current:
        if link.parameter_id not in wanted_param_ids:
            db.delete(link)
    for param_id in wanted_param_ids:
        if param_id not in current_by_param_id:
            db.add(ParameterLink(parameter_id=param_id, item_id=item_id))
    db.commit()


def _format_number(value: float) -> str:
    if value == int(value):
        return str(int(value))
    return f"{value:g}"
