"""§8.2 HTML exporter — static, self-contained report built from the same
DocumentTree the XLSX exporter and (eventually) the UI's own rendering
share. No templating engine dependency: the structure is simple enough
that plain string building stays readable.
"""

import html
from typing import Callable

import markdown as md
from sqlalchemy.orm import Session

from app.models.glossary import GlossaryTerm
from app.models.item import Item
from app.models.item_type import ItemType
from app.models.parameter import Parameter
from app.models.reference import ReferenceSource
from app.services.document_tree import attribute_columns, build_document_tree, rich_text_keys as _rich_text_keys
from app.services.glossary import extract_glossary_refs, resolve_glossary_refs_html
from app.services.parameters import compute_all_values, resolve_parameter_refs_html
from app.services.references import resolve_reference_refs_html

_STYLE = """
body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1e293b; }
h1 { font-size: 1.5rem; }
.node { margin: 1.25rem 0; scroll-margin-top: 20px; }
.structural h2, .structural h3, .structural h4 { margin: 0; }
.content { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
.content:target { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
.content .key { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
.content .title { font-weight: 600; margin-left: 6px; }
.content .description { margin: 8px 0; }
.attrs { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.85rem; color: #475569; margin-bottom: 8px; }
.attrs span.label { font-weight: 600; color: #334155; }
.links { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.85rem; border-top: 1px solid #f1f5f9; padding-top: 8px; margin-top: 4px; }
.links a { color: #2563eb; text-decoration: none; }
.links a:hover { text-decoration: underline; }
.links .unresolved { color: #94a3b8; font-style: italic; }
.links .label { font-weight: 600; color: #334155; }
.glossary-ref { color: #7c3aed; text-decoration: underline dotted; cursor: help; }
.ref-chip { color: #0f766e; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 4px; padding: 0 4px; text-decoration: none; font-size: 0.85em; }
.ref-superseded { color: #b45309; }
.param-ref { color: #1d4ed8; background: #eff6ff; border-radius: 4px; padding: 0 4px; font-weight: 600; cursor: help; }
#glossary { margin-top: 3rem; border-top: 2px solid #e2e8f0; padding-top: 1rem; }
#glossary dt { font-family: ui-monospace, monospace; font-weight: 600; margin-top: 0.75rem; scroll-margin-top: 20px; }
#glossary dt:target { color: #2563eb; }
#glossary dd { margin: 0.15rem 0 0; color: #475569; }
"""


def _heading_level(level: int) -> int:
    return min(level + 2, 6)  # level 0 -> h2, so the export's own h1 stays the document title


def _render_attributes(
    attributes: dict,
    columns: list[tuple[str, str]],
    rich_text_keys: set[str],
    resolve_and_render: "Callable[[str], str]",
) -> str:
    parts = []
    for key, label in columns:
        value = attributes.get(key)
        if value in (None, "", []):
            continue
        if key in rich_text_keys and isinstance(value, str):
            # §known simplification (now closed): rich_text attributes get
            # the same glossary/[[ref:]]/{{param:}} resolution + Markdown
            # rendering as description_md, not just plain-text escaping.
            body = resolve_and_render(value)
            parts.append(f'<span><span class="label">{html.escape(label)}:</span> {body}</span>')
            continue
        text = ", ".join(str(v) for v in value) if isinstance(value, list) else str(value)
        parts.append(f'<span><span class="label">{html.escape(label)}:</span> {html.escape(text)}</span>')
    return f'<div class="attrs">{"".join(parts)}</div>' if parts else ""


def _render_links(links) -> str:
    if not links:
        return ""
    parts = []
    for link in links:
        target_label = html.escape(link.target_key or link.target_title)
        if link.in_document:
            parts.append(
                f'<a href="#item-{link.target_id}">'
                f'<span class="label">{html.escape(link.label)}</span> {target_label} →</a>'
            )
        else:
            # Target lives in a different document/export — nothing on this
            # static page to jump to, so it's named but left un-clickable
            # rather than silently dropped.
            parts.append(
                f'<span class="unresolved">'
                f'<span class="label">{html.escape(link.label)}</span> {target_label} '
                f"(in another document)</span>"
            )
    return f'<div class="links">{"".join(parts)}</div>'


def _render_glossary_appendix(cited: set[str], terms_by_abbr: dict[str, GlossaryTerm]) -> str:
    if not cited:
        return ""
    entries = sorted(
        (terms_by_abbr[abbr] for abbr in cited if abbr in terms_by_abbr),
        key=lambda t: t.abbreviation,
    )
    if not entries:
        return ""
    items_html = "".join(
        f'<dt id="glossary-{html.escape(t.abbreviation.lower())}">{html.escape(t.abbreviation)}'
        f" — {html.escape(t.term)}</dt><dd>{html.escape(t.definition)}</dd>"
        for t in entries
    )
    return f'<div id="glossary"><h2>Glossary of Terms</h2><dl>{items_html}</dl></div>'


def build_document_html(
    db: Session,
    document_name: str,
    items: list[Item],
    item_types: list[ItemType],
    glossary_terms: list[GlossaryTerm] | None = None,
    reference_sources: list[ReferenceSource] | None = None,
    parameters: list[Parameter] | None = None,
) -> str:
    nodes = build_document_tree(db, items, item_types)
    columns = attribute_columns(item_types)
    terms_by_abbr = {t.abbreviation.lower(): t for t in (glossary_terms or [])}
    sources_by_code = {s.code.lower(): s for s in (reference_sources or [])}
    locators_by_code_label = {
        (s.code.lower(), loc.label.lower()): loc for s in (reference_sources or []) for loc in s.locators
    }
    params_by_key = {p.key: p for p in (parameters or [])}
    param_values = compute_all_values(parameters or [])
    rt_keys = _rich_text_keys(item_types)
    cited_refs: set[str] = set()

    def resolve_and_render(text: str) -> str:
        cited_refs.update(r.lower() for r in extract_glossary_refs(text))
        resolved = resolve_glossary_refs_html(text, terms_by_abbr)
        resolved = resolve_reference_refs_html(resolved, sources_by_code, locators_by_code_label)
        resolved = resolve_parameter_refs_html(resolved, params_by_key, param_values)
        return md.markdown(resolved)

    body_parts = []
    for node in nodes:
        if node.kind == "structural":
            level = _heading_level(node.level)
            heading = f"{node.number} {html.escape(node.title)}" if node.number else html.escape(node.title)
            body_parts.append(f'<div class="node structural"><h{level}>{heading}</h{level}></div>')
        else:
            description_html = resolve_and_render(node.description_md) if node.description_md else ""
            body_parts.append(
                f'<div class="node content" id="item-{node.id}">'
                f'<div><span class="key">{html.escape(node.key or "")}</span>'
                f'<span class="title">{html.escape(node.title)}</span></div>'
                f'<div class="description">{description_html}</div>'
                f"{_render_attributes(node.attributes, columns, rt_keys, resolve_and_render)}"
                f"{_render_links(node.links)}"
                f"</div>"
            )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(document_name)}</title>
<style>{_STYLE}</style>
</head>
<body>
<h1>{html.escape(document_name)}</h1>
{"".join(body_parts)}
{_render_glossary_appendix(cited_refs, terms_by_abbr)}
</body>
</html>
"""
