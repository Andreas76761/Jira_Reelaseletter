"""Parser für Jira-HTML-Exporte (Issue-Navigator 'Export > HTML' /
'Printable').

Jira-HTML-Exporte haben kein festes Schema (abhängig von Jira-Version,
Sprache, Add-ons). Als zuverlässiger Anker für Ticket-Grenzen dient der
Link auf die Vorgangsseite (`href=".../browse/PROJ-123"`), den Jira in
jedem Export konsistent setzt. Innerhalb eines Tickets werden th/td- bzw.
Label/Wert-Zeilen generisch eingelesen und über field_aliases auf die
kanonischen Feldnamen gemappt; unbekannte Labels landen in custom_fields.

Best-effort-Parser: Wenn ein konkreter Export abweicht, hier die
Erkennung der Ticket-Grenzen bzw. der Feld-Zeilen anpassen.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from .field_aliases import normalize_label
from .model import Comment, Ticket

_BROWSE_HREF_RE = re.compile(r"/browse/([A-Z][A-Z0-9]*-\d+)")
_MULTI_VALUE_FIELDS = {"labels", "components", "fix_versions", "watchers"}


def parse_html(path: str) -> list[Ticket]:
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()

    boundaries = _find_boundaries(raw)
    tickets: list[Ticket] = []
    for i, (key, start) in enumerate(boundaries):
        end = boundaries[i + 1][1] if i + 1 < len(boundaries) else len(raw)
        segment = raw[start:end]
        tickets.append(_parse_segment(key, segment, source_file=path))
    return tickets


_BLOCK_TAG_OPEN_RE = re.compile(r"<(h[1-4]|tr|p|div|li|table)\b[^>]*>", re.IGNORECASE)


def _find_boundaries(raw: str) -> list[tuple[str, int]]:
    block_starts = [m.start() for m in _BLOCK_TAG_OPEN_RE.finditer(raw)]

    seen: set[str] = set()
    boundaries: list[tuple[str, int]] = []
    for m in re.finditer(r"<a\s[^>]*href=\"[^\"]*?/browse/([A-Z][A-Z0-9]*-\d+)[^\"]*\"", raw):
        key = m.group(1)
        if key in seen:
            continue
        seen.add(key)
        boundaries.append((key, _nearest_block_start(block_starts, m.start())))
    return boundaries


def _nearest_block_start(block_starts: list[int], anchor_pos: int) -> int:
    """Position des nächstgelegenen umschließenden Block-Tags vor anchor_pos,
    damit ein Segment nicht mit einem offenen/unvollständigen Tag beginnt."""
    best = anchor_pos
    for pos in block_starts:
        if pos > anchor_pos:
            break
        best = pos
    return best


def _parse_segment(key: str, segment_html: str, source_file: str) -> Ticket:
    soup = BeautifulSoup(segment_html, "lxml")
    ticket = Ticket(key=key, source_file=source_file)

    summary = _extract_heading_summary(soup, key)
    if summary:
        ticket.summary = summary

    fields, comments = _extract_fields_and_comments(soup)

    for label, value in fields.items():
        canonical = normalize_label(label)
        if canonical is None or canonical == "key":
            if value:
                ticket.custom_fields[label] = value
            continue
        if canonical in _MULTI_VALUE_FIELDS:
            values = [v.strip() for v in re.split(r"[,;\n]", value) if v.strip()]
            setattr(ticket, canonical, values)
        elif canonical == "summary":
            if value:
                ticket.summary = value
        elif canonical == "comments":
            continue  # separat über comments-Liste behandelt
        else:
            setattr(ticket, canonical, value)

    ticket.comments = comments
    return ticket


def _extract_heading_summary(soup: BeautifulSoup, key: str) -> str | None:
    anchor = soup.find("a", href=_BROWSE_HREF_RE)
    if anchor is None:
        return None
    parent = anchor.find_parent(["h1", "h2", "h3", "h4"]) or anchor.parent
    if parent is None:
        return None
    text = parent.get_text(" ", strip=True)
    text = text.replace(key, "", 1).strip(" -:–—")
    return text or None


def _extract_fields_and_comments(
    soup: BeautifulSoup,
) -> tuple[dict[str, str], list[Comment]]:
    fields: dict[str, str] = {}
    comments: list[Comment] = []
    in_comments_section = False

    for row in soup.find_all("tr"):
        cells = row.find_all(["th", "td"])
        if not cells:
            continue

        if len(cells) == 1:
            label_text = cells[0].get_text(" ", strip=True)
            if normalize_label(label_text) == "comments":
                in_comments_section = True
                continue
            if in_comments_section and label_text:
                comments.append(Comment(body=label_text))
            continue

        if in_comments_section:
            comments.append(
                Comment(body=" | ".join(c.get_text(" ", strip=True) for c in cells))
            )
            continue

        # th/td- bzw. td/td-Zeilen paarweise als Label/Wert interpretieren.
        for j in range(0, len(cells) - 1, 2):
            label = cells[j].get_text(" ", strip=True)
            value = cells[j + 1].get_text("\n", strip=True)
            if label:
                fields[label] = value

    # Fallback: Beschreibung steht manchmal als eigener Absatz statt als
    # th/td-Zeile (Label als <b>/<strong> gefolgt von <p>).
    known_canonicals = {normalize_label(l) for l in fields}
    if "description" not in known_canonicals:
        for tag in soup.find_all(["b", "strong"]):
            if normalize_label(tag.get_text(strip=True)) == "description":
                nxt = tag.find_parent(["p", "div"])
                nxt = nxt.find_next_sibling(["p", "div"]) if nxt else None
                if nxt:
                    fields["Description"] = nxt.get_text("\n", strip=True)
                break

    return fields, comments
