"""§5.4 + §5.5: `[[ref:CODE#locator]]` is the third instance of the shared
"custom Markdown syntax resolved by a preprocessing step" mechanism
(glossary and parameters being the other two, app/services/glossary.py and
app/services/parameters.py).
"""

import html
import re

from app.models.reference import ReferenceLocator, ReferenceSource

_REF_PATTERN = re.compile(r"\[\[ref:([A-Za-z0-9_.\-]+)#([^\]]+)\]\]")


def extract_reference_refs(text: str | None) -> set[tuple[str, str]]:
    if not text:
        return set()
    return {(m.group(1), m.group(2)) for m in _REF_PATTERN.finditer(text)}


def file_url(source: ReferenceSource) -> str | None:
    if source.source_type == "pdf" and source.file_ref:
        return f"/api/v1/reference-sources/{source.id}/file"
    if source.source_type == "external_link":
        return source.external_url
    return None


def locator_url(source: ReferenceSource, locator: ReferenceLocator | None) -> str | None:
    base = file_url(source)
    if not base:
        return None
    if locator and locator.page_number:
        return f"{base}#page={locator.page_number}"
    return base


def resolve_reference_refs_html(
    text: str,
    sources_by_code: dict[str, ReferenceSource],
    locators_by_code_label: dict[tuple[str, str], ReferenceLocator],
) -> str:
    """Replaces `[[ref:CODE#locator]]` with an interactive chip — a link
    that jumps straight to the cited page/clause, flagged with a "newer
    version available" marker when the cited source has been superseded
    (§5.4 versioning). Unresolvable references are left as escaped plain
    text, same principle as glossary/link resolution elsewhere."""

    def replace(match: re.Match) -> str:
        code, label = match.group(1), match.group(2)
        source = sources_by_code.get(code.lower())
        if not source:
            return html.escape(match.group(0))
        locator = locators_by_code_label.get((code.lower(), label.lower()))
        url = locator_url(source, locator)
        version = f" {source.version}" if source.version else ""
        title_bits = [f"{source.title}{version}"]
        if locator:
            title_bits.append(locator.label)
        title = html.escape(" — ".join(title_bits))
        stale = (
            ' <span class="ref-superseded" title="A newer version of this document exists">⚠</span>'
            if source.superseded_by
            else ""
        )
        label_text = html.escape(f"{code}, {label}" if locator else code)
        if url:
            return (
                f'<a href="{html.escape(url)}" target="_blank" rel="noopener" '
                f'class="ref-chip" title="{title}">{label_text}</a>{stale}'
            )
        return f'<span class="ref-chip" title="{title}">{label_text}</span>{stale}'

    return _REF_PATTERN.sub(replace, text)
