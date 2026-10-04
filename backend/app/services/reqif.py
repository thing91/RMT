"""Minimal ReqIF 1.2 (OMG, namespace .../20110401/reqif.xsd) export of a
project's applicability matrix — one SPEC-OBJECT per applicability record
with string attributes plus an enumeration for the decision, grouped under
one SPECIFICATION per subsystem-ordered list. Enough for DOORS/Polarion/
ReqView to import it as a customer-facing document; no round-trip import.
"""

import uuid
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

NS = "http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"

_STATUSES = [
    ("to_be_assessed", "To be assessed"),
    ("applicable", "Applicable"),
    ("applicable_modified", "Applicable with modification"),
    ("not_applicable_pending", "Not applicable (pending approval)"),
    ("not_applicable", "Not applicable"),
]

_STRING_ATTRS = [
    ("AD-ForeignID", "ReqIF.ForeignID"),
    ("AD-Name", "ReqIF.Name"),
    ("AD-Text", "ReqIF.Text"),
    ("AD-Subsystem", "Subsystem"),
    ("AD-Release", "Library release"),
    ("AD-Version", "Library version"),
    ("AD-Justification", "Justification"),
    ("AD-ProjectReq", "Project requirement"),
    ("AD-DecidedBy", "Decided by"),
    ("AD-ApprovedBy", "Approved by"),
]


def _el(parent, tag, **attrs):
    e = ET.SubElement(parent, tag)
    for k, v in attrs.items():
        e.set(k.replace("_", "-"), str(v))
    return e


def applicability_reqif(project, records) -> bytes:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    ET.register_namespace("", NS)
    root = ET.Element("REQ-IF", {"xmlns": NS})

    header = _el(_el(root, "THE-HEADER"), "REQ-IF-HEADER", IDENTIFIER=f"H-{uuid.uuid4()}")
    for tag, text in (
        ("COMMENT", "Applicability matrix exported from RMT"),
        ("CREATION-TIME", now),
        ("REQ-IF-TOOL-ID", "RMT-KNA"),
        ("REQ-IF-VERSION", "1.0"),
        ("SOURCE-TOOL-ID", "RMT-KNA"),
        ("TITLE", f"{project.name} — applicability matrix"),
    ):
        _el(header, tag).text = text

    content = _el(_el(root, "CORE-CONTENT"), "REQ-IF-CONTENT")

    datatypes = _el(content, "DATATYPES")
    _el(datatypes, "DATATYPE-DEFINITION-STRING", IDENTIFIER="DT-String", LAST_CHANGE=now,
        LONG_NAME="String", MAX_LENGTH="65535")
    dt_enum = _el(datatypes, "DATATYPE-DEFINITION-ENUMERATION", IDENTIFIER="DT-Applicability",
                  LAST_CHANGE=now, LONG_NAME="Applicability")
    values = _el(dt_enum, "SPECIFIED-VALUES")
    for i, (key, label) in enumerate(_STATUSES):
        ev = _el(values, "ENUM-VALUE", IDENTIFIER=f"EV-{key}", LAST_CHANGE=now, LONG_NAME=label)
        _el(_el(ev, "PROPERTIES"), "EMBEDDED-VALUE", KEY=str(i), OTHER_CONTENT=key)

    spec_types = _el(content, "SPEC-TYPES")
    sot = _el(spec_types, "SPEC-OBJECT-TYPE", IDENTIFIER="SOT-Applicability", LAST_CHANGE=now,
              LONG_NAME="Applicability record")
    sattrs = _el(sot, "SPEC-ATTRIBUTES")
    for ident, name in _STRING_ATTRS:
        ad = _el(sattrs, "ATTRIBUTE-DEFINITION-STRING", IDENTIFIER=ident, LAST_CHANGE=now, LONG_NAME=name)
        _el(_el(ad, "TYPE"), "DATATYPE-DEFINITION-STRING-REF").text = "DT-String"
    ad = _el(sattrs, "ATTRIBUTE-DEFINITION-ENUMERATION", IDENTIFIER="AD-Status", LAST_CHANGE=now,
             LONG_NAME="Applicability", MULTI_VALUED="false")
    _el(_el(ad, "TYPE"), "DATATYPE-DEFINITION-ENUMERATION-REF").text = "DT-Applicability"
    _el(spec_types, "SPECIFICATION-TYPE", IDENTIFIER="ST-Matrix", LAST_CHANGE=now, LONG_NAME="Applicability matrix")

    objects = _el(content, "SPEC-OBJECTS")
    for r in records:
        so = _el(objects, "SPEC-OBJECT", IDENTIFIER=f"SO-{r.id}", LAST_CHANGE=(r.decided_at or datetime.now(timezone.utc)).isoformat(timespec="seconds"))
        _el(_el(so, "TYPE"), "SPEC-OBJECT-TYPE-REF").text = "SOT-Applicability"
        vals = _el(so, "VALUES")
        string_values = {
            "AD-ForeignID": r.key or "",
            "AD-Name": r.resolved_title,
            "AD-Text": r.resolved_description,
            "AD-Subsystem": r.subsystem,
            "AD-Release": r.release_name,
            "AD-Version": str(r.source_version),
            "AD-Justification": r.rationale or "",
            "AD-ProjectReq": r.modified_item_key or "",
            "AD-DecidedBy": r.decided_by or "",
            "AD-ApprovedBy": r.approved_by or "",
        }
        for ident, value in string_values.items():
            av = _el(vals, "ATTRIBUTE-VALUE-STRING", THE_VALUE=value)
            _el(_el(av, "DEFINITION"), "ATTRIBUTE-DEFINITION-STRING-REF").text = ident
        ae = _el(vals, "ATTRIBUTE-VALUE-ENUMERATION")
        _el(_el(ae, "DEFINITION"), "ATTRIBUTE-DEFINITION-ENUMERATION-REF").text = "AD-Status"
        _el(_el(ae, "VALUES"), "ENUM-VALUE-REF").text = f"EV-{r.status}"

    _el(content, "SPEC-RELATIONS")
    specs = _el(content, "SPECIFICATIONS")
    spec = _el(specs, "SPECIFICATION", IDENTIFIER=f"SPEC-{project.id}", LAST_CHANGE=now,
               LONG_NAME=f"{project.name} — applicability matrix")
    _el(_el(spec, "TYPE"), "SPECIFICATION-TYPE-REF").text = "ST-Matrix"
    children = _el(spec, "CHILDREN")
    for r in records:
        sh = _el(children, "SPEC-HIERARCHY", IDENTIFIER=f"SH-{r.id}", LAST_CHANGE=now)
        _el(_el(sh, "OBJECT"), "SPEC-OBJECT-REF").text = f"SO-{r.id}"

    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


# ---- documents ---------------------------------------------------------------


def document_reqif(document, items, item_types) -> bytes:
    """A whole document as ReqIF: one SPEC-OBJECT per item (sections and
    requirements alike), the document tree as nested SPEC-HIERARCHY, every
    attribute as a string attribute named after its label."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    types_by_id = {t.id: t for t in item_types}
    attr_labels: dict[str, str] = {}
    for t in item_types:
        for a in t.attributes:
            attr_labels.setdefault(a.key, a.label)

    root = ET.Element("REQ-IF", {"xmlns": NS})
    header = _el(_el(root, "THE-HEADER"), "REQ-IF-HEADER", IDENTIFIER=f"H-{uuid.uuid4()}")
    for tag, text in (
        ("CREATION-TIME", now), ("REQ-IF-TOOL-ID", "RMT-KNA"), ("REQ-IF-VERSION", "1.0"),
        ("SOURCE-TOOL-ID", "RMT-KNA"), ("TITLE", document.name),
    ):
        _el(header, tag).text = text
    content = _el(_el(root, "CORE-CONTENT"), "REQ-IF-CONTENT")
    datatypes = _el(content, "DATATYPES")
    _el(datatypes, "DATATYPE-DEFINITION-STRING", IDENTIFIER="DT-String", LAST_CHANGE=now,
        LONG_NAME="String", MAX_LENGTH="65535")

    fixed = [("AD-ForeignID", "ReqIF.ForeignID"), ("AD-ChapterName", "ReqIF.ChapterName"),
             ("AD-Name", "ReqIF.Name"), ("AD-Text", "ReqIF.Text"), ("AD-Type", "RMT.ItemType")]
    dyn = [(f"AD-attr-{k}", label) for k, label in sorted(attr_labels.items())]
    spec_types = _el(content, "SPEC-TYPES")
    sot = _el(spec_types, "SPEC-OBJECT-TYPE", IDENTIFIER="SOT-Item", LAST_CHANGE=now, LONG_NAME="Item")
    sattrs = _el(sot, "SPEC-ATTRIBUTES")
    for ident, name in fixed + dyn:
        ad = _el(sattrs, "ATTRIBUTE-DEFINITION-STRING", IDENTIFIER=ident, LAST_CHANGE=now, LONG_NAME=name)
        _el(_el(ad, "TYPE"), "DATATYPE-DEFINITION-STRING-REF").text = "DT-String"
    _el(spec_types, "SPECIFICATION-TYPE", IDENTIFIER="ST-Document", LAST_CHANGE=now, LONG_NAME="Document")

    objects = _el(content, "SPEC-OBJECTS")
    for item in items:
        t = types_by_id.get(item.item_type_id)
        structural = t is not None and t.behavior == "structural"
        so = _el(objects, "SPEC-OBJECT", IDENTIFIER=f"SO-{item.id}",
                 LAST_CHANGE=item.updated_at.isoformat(timespec="seconds"))
        _el(_el(so, "TYPE"), "SPEC-OBJECT-TYPE-REF").text = "SOT-Item"
        vals = _el(so, "VALUES")
        values = {
            "AD-ForeignID": item.key or "",
            ("AD-ChapterName" if structural else "AD-Name"): item.title,
            "AD-Text": item.description_md or "",
            "AD-Type": t.name if t else "",
        }
        for key, value in (item.attributes or {}).items():
            if value is not None and value != "":
                values[f"AD-attr-{key}"] = ", ".join(map(str, value)) if isinstance(value, list) else str(value)
        for ident, value in values.items():
            av = _el(vals, "ATTRIBUTE-VALUE-STRING", THE_VALUE=value)
            _el(_el(av, "DEFINITION"), "ATTRIBUTE-DEFINITION-STRING-REF").text = ident

    _el(content, "SPEC-RELATIONS")
    spec = _el(_el(content, "SPECIFICATIONS"), "SPECIFICATION", IDENTIFIER=f"SPEC-{document.id}",
               LAST_CHANGE=now, LONG_NAME=document.name)
    _el(_el(spec, "TYPE"), "SPECIFICATION-TYPE-REF").text = "ST-Document"
    children_of: dict = {}
    for item in items:
        children_of.setdefault(item.parent_id, []).append(item)

    def add(parent_el, parent_id):
        kids = sorted(children_of.get(parent_id, []), key=lambda i: i.order)
        if not kids:
            return
        container = _el(parent_el, "CHILDREN")
        for kid in kids:
            sh = _el(container, "SPEC-HIERARCHY", IDENTIFIER=f"SH-{kid.id}", LAST_CHANGE=now)
            _el(_el(sh, "OBJECT"), "SPEC-OBJECT-REF").text = f"SO-{kid.id}"
            add(sh, kid.id)

    add(spec, None)
    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


class ReqIFError(ValueError):
    pass


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text_of(el) -> str:
    return "".join(el.itertext()).strip()


def parse_reqif(data: bytes) -> list[dict]:
    """Parse any ReqIF file into nodes {title, text, foreign_id, attributes,
    children}, following its first SPECIFICATION's hierarchy. Attribute
    names come from LONG-NAMEs; XHTML values are flattened to text;
    enumeration values resolve to their LONG-NAME."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ReqIFError(f"Not valid XML: {e}")
    if _local(root.tag) != "REQ-IF":
        raise ReqIFError("Not a ReqIF file (root element isn't REQ-IF).")

    by_ident = {}
    for el in root.iter():
        ident = el.get("IDENTIFIER")
        if ident:
            by_ident[ident] = el
    attr_names = {
        el.get("IDENTIFIER"): el.get("LONG-NAME") or el.get("IDENTIFIER")
        for el in root.iter() if _local(el.tag).startswith("ATTRIBUTE-DEFINITION-")
    }
    enum_names = {
        el.get("IDENTIFIER"): el.get("LONG-NAME") or el.get("IDENTIFIER")
        for el in root.iter() if _local(el.tag) == "ENUM-VALUE"
    }

    def object_values(obj) -> dict:
        out: dict[str, str] = {}
        for av in obj.iter():
            kind = _local(av.tag)
            if not kind.startswith("ATTRIBUTE-VALUE-"):
                continue
            ref = next((r.text for r in av.iter() if _local(r.tag).startswith("ATTRIBUTE-DEFINITION-")
                        and _local(r.tag).endswith("-REF")), None)
            name = attr_names.get(ref, ref or "?")
            if kind == "ATTRIBUTE-VALUE-XHTML":
                the = next((c for c in av if _local(c.tag) == "THE-VALUE"), None)
                value = _text_of(the) if the is not None else ""
            elif kind == "ATTRIBUTE-VALUE-ENUMERATION":
                value = ", ".join(enum_names.get(r.text, r.text) for r in av.iter() if _local(r.tag) == "ENUM-VALUE-REF")
            else:
                value = av.get("THE-VALUE", "")
            out[name] = value
        return out

    def node_for(sh) -> dict | None:
        obj_ref = next((r.text for r in sh.iter() if _local(r.tag) == "SPEC-OBJECT-REF"), None)
        obj = by_ident.get(obj_ref)
        values = object_values(obj) if obj is not None else {}
        children_el = next((c for c in sh if _local(c.tag) == "CHILDREN"), None)
        children = [n for n in (node_for(c) for c in (children_el if children_el is not None else []) if _local(c.tag) == "SPEC-HIERARCHY") if n]
        title = (values.pop("ReqIF.ChapterName", "") or values.pop("ReqIF.Name", "") or "").strip()
        text = values.pop("ReqIF.Text", "")
        if not title:
            first_line = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
            title = first_line[:120] or (values.get("ReqIF.ForeignID") or obj_ref or "Untitled")
        return {
            "title": title,
            "text": text,
            "foreign_id": values.pop("ReqIF.ForeignID", None),
            "attributes": values,
            "children": children,
        }

    spec = next((el for el in root.iter() if _local(el.tag) == "SPECIFICATION"), None)
    if spec is None:
        raise ReqIFError("The file has no SPECIFICATION to import.")
    children_el = next((c for c in spec if _local(c.tag) == "CHILDREN"), None)
    nodes = [n for n in (node_for(c) for c in (children_el if children_el is not None else []) if _local(c.tag) == "SPEC-HIERARCHY") if n]
    if not nodes:
        raise ReqIFError("The specification is empty.")
    return nodes
