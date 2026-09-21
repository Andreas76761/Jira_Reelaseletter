"""Parser für den klassischen Jira XML-Export (RSS-artiges Format,
'Werkzeuge > XML exportieren' bzw. 'Export > XML' im Issue-Navigator).
"""

from __future__ import annotations

from lxml import etree

from .model import Comment, Ticket


def parse_xml(path: str) -> list[Ticket]:
    tree = etree.parse(path)
    items = tree.findall(".//item")
    tickets: list[Ticket] = []
    for item in items:
        tickets.append(_parse_item(item, source_file=path))
    return tickets


def _text(item: etree._Element, tag: str) -> str | None:
    el = item.find(tag)
    if el is None:
        return None
    text = "".join(el.itertext()).strip()
    return text or None


def _parse_item(item: etree._Element, source_file: str) -> Ticket:
    key_el = item.find("key")
    key = (key_el.text or "").strip() if key_el is not None else None
    if not key:
        # Fallback: Schlüssel aus dem Titel "[PROJ-123] Summary" extrahieren.
        title = _text(item, "title") or ""
        key = title.split("]")[0].lstrip("[").strip() or "UNKNOWN-0"

    assignee_el = item.find("assignee")
    reporter_el = item.find("reporter")

    labels = [
        (lbl.text or "").strip()
        for lbl in item.findall("labels/label")
        if (lbl.text or "").strip()
    ]
    components = [
        (c.text or "").strip()
        for c in item.findall("component")
        if (c.text or "").strip()
    ]
    fix_versions = [
        (v.text or "").strip()
        for v in item.findall("fixVersion")
        if (v.text or "").strip()
    ]
    watchers = [
        (w.text or "").strip()
        for w in item.findall("watches/watcher")
        if (w.text or "").strip()
    ]

    comments: list[Comment] = []
    for c in item.findall("comments/comment"):
        comments.append(
            Comment(
                author=c.get("author"),
                created=c.get("created"),
                body="".join(c.itertext()).strip(),
            )
        )

    custom_fields: dict[str, str] = {}
    for cf in item.findall("customfields/customfield"):
        name_el = cf.find("customfieldname")
        if name_el is None or not (name_el.text or "").strip():
            continue
        name = name_el.text.strip()
        values = [
            (v.text or "").strip()
            for v in cf.findall("customfieldvalues/customfieldvalue")
            if (v.text or "").strip()
        ]
        if values:
            custom_fields[name] = "; ".join(values)

    ticket = Ticket(
        key=key,
        summary=_text(item, "summary") or _text(item, "title") or "",
        issue_type=_text(item, "type"),
        status=_text(item, "status"),
        priority=_text(item, "priority"),
        project=_text(item, "project"),
        resolution=_text(item, "resolution"),
        assignee=(assignee_el.text or "").strip() if assignee_el is not None else None,
        reporter=(reporter_el.text or "").strip() if reporter_el is not None else None,
        created=_text(item, "created"),
        updated=_text(item, "updated"),
        labels=labels,
        components=components,
        fix_versions=fix_versions,
        description=_text(item, "description") or "",
        comments=comments,
        watchers=watchers,
        custom_fields=custom_fields,
        source_file=source_file,
    )
    return ticket
