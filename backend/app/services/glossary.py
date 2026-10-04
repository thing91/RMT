"""§5.2 + §5.5: `[[abbreviation]]` is custom Markdown syntax resolved by a
preprocessing step before rendering — the same mechanism §5.5 says every
inline reference type (glossary, params, standards) should share. Only the
glossary half exists so far; `{{param:KEY}}` and `[[ref:CODE#locator]]` are
Phase 3 items further down the brief's own list (§12).
"""

import html
import re

from app.models.glossary import GlossaryTerm

# Deliberately excludes "ref:"-prefixed refs so this doesn't misfire once
# §5.4's [[ref:CODE#locator]] syntax exists — same [[...]] bracket style,
# disambiguated by that prefix.
_REF_PATTERN = re.compile(r"\[\[(?!ref:)([A-Za-z0-9_.\-]+)\]\]")


def extract_glossary_refs(text: str | None) -> set[str]:
    if not text:
        return set()
    return {m.group(1) for m in _REF_PATTERN.finditer(text)}


def resolve_glossary_refs_html(text: str, terms_by_abbr: dict[str, GlossaryTerm]) -> str:
    """Replaces `[[abbr]]` with an anchor into the export's own Glossary
    appendix (§5.2 export behavior) plus a hover tooltip. An unresolvable
    reference is left as plain escaped text rather than silently dropped —
    same principle as the "unresolved" link case in `export_html.py`.
    """

    def replace(match: re.Match) -> str:
        abbr = match.group(1)
        term = terms_by_abbr.get(abbr.lower())
        if not term:
            return html.escape(match.group(0))
        return (
            f'<a href="#glossary-{html.escape(abbr.lower())}" class="glossary-ref" '
            f'title="{html.escape(term.definition)}">{html.escape(term.abbreviation)}</a>'
        )

    return _REF_PATTERN.sub(replace, text)
