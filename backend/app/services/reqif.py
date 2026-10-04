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
