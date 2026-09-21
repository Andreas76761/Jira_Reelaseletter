"""Parser für Jira-Ticket-Sammlungen im Word-Format (.docx).

Jira selbst exportiert nicht nativ nach Word; typischerweise stammt so ein
Dokument aus einem Add-on oder aus Copy&Paste des Issue-Navigators nach
Word. Es gibt daher kein festes Schema. Dieser Parser erkennt Ticket-
Grenzen an Absätzen, die mit einem Jira-Schlüssel beginnen (z.B.
"PROJ-123 ..."), und liest danach Tabellenzeilen (Label/Wert) sowie
"Label: Wert"-Zeilen im Fließtext ein.

Best-effort-Parser: Bei einem realen Export ggf. an die tatsächliche
Struktur anpassen (siehe _KEY_RE und die Feld-Erkennung unten).
"""

from __future__ import annotations

import re

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from .field_aliases import normalize_label
from .model import Comment, Ticket

_KEY_RE = re.compile(r"^([A-Z][A-Z0-9]*-\d+)\b[\s:.\-–—]*(.*)$")
_INLINE_FIELD_RE = re.compile(r"^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß /]{1,30}):\s*(.+)$")
_MULTI_VALUE_FIELDS = {"labels", "components", "fix_versions", "watchers"}


def parse_docx(path: str) -> list[Ticket]:
    document = Document(path)
    blocks = list(_iter_block_items(document))

    # Ticket-Blockgrenzen anhand von Absätzen finden, die mit einem Key
    # beginnen.
    boundaries: list[tuple[str, str, int]] = []  # (key, rest_of_line, block_index)
    for idx, block in enumerate(blocks):
        if isinstance(block, Paragraph):
            m = _KEY_RE.match(block.text.strip())
            if m:
                boundaries.append((m.group(1), m.group(2).strip(), idx))

    tickets: list[Ticket] = []
    for i, (key, summary_hint, start_idx) in enumerate(boundaries):
        end_idx = boundaries[i + 1][2] if i + 1 < len(boundaries) else len(blocks)
        block_slice = blocks[start_idx + 1 : end_idx]
        tickets.append(_parse_ticket_blocks(key, summary_hint, block_slice, source_file=path))
    return tickets


def _iter_block_items(document: Document):
    """Paragraphs und Tables in Dokumentreihenfolge liefern."""
    parent_elm = document.element.body
    for child in parent_elm.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, document)
        elif child.tag.endswith("}tbl"):
            yield Table(child, document)


def _parse_ticket_blocks(
    key: str, summary_hint: str, blocks: list, source_file: str
) -> Ticket:
    ticket = Ticket(key=key, summary=summary_hint, source_file=source_file)
    description_parts: list[str] = []
    comments: list[Comment] = []
    in_comments_section = False

    for block in blocks:
        if isinstance(block, Table):
            for row in block.rows:
                cells = [c.text.strip() for c in row.cells]
                if len(cells) >= 2:
                    for j in range(0, len(cells) - 1, 2):
                        _apply_field(ticket, cells[j], cells[j + 1])
            continue

        text = block.text.strip()
        if not text:
            continue

        if normalize_label(text) == "comments":
            in_comments_section = True
            continue

        inline = _INLINE_FIELD_RE.match(text)
        if inline and normalize_label(inline.group(1)) is not None:
            in_comments_section = False
            _apply_field(ticket, inline.group(1), inline.group(2))
            continue

        if in_comments_section:
            comments.append(Comment(body=text))
        else:
            description_parts.append(text)

    if description_parts and not ticket.description:
        ticket.description = "\n\n".join(description_parts)
    ticket.comments = comments
    return ticket


def _apply_field(ticket: Ticket, raw_label: str, raw_value: str) -> None:
    canonical = normalize_label(raw_label)
    value = raw_value.strip()
    if canonical is None:
        if value:
            ticket.custom_fields[raw_label.strip()] = value
        return
    if canonical == "key":
        return
    if canonical in _MULTI_VALUE_FIELDS:
        values = [v.strip() for v in re.split(r"[,;\n]", value) if v.strip()]
        setattr(ticket, canonical, values)
    elif canonical == "comments":
        return
    else:
        setattr(ticket, canonical, value)
