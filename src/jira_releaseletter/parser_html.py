"""Parser für Jira-HTML-Exporte.

Jira kennt (mindestens) zwei grundlegend unterschiedliche HTML-Exporte,
beide ohne festes Schema (abhängig von Jira-Version, Sprache, Add-ons,
gewählten Spalten):

1. **Tabellen-Export** ("Issue-Navigator > Export > HTML (aktuelle
   Felder)"): eine einzige `<table id="issuetable">` mit einer Zeile pro
   Ticket (`<tr data-issuekey="...">`) und genau den Spalten, die in der
   Jira-Ansicht ausgewählt waren (oft nur Key/Status/Datum, nicht
   zwangsläufig Zusammenfassung/Beschreibung/Bearbeiter!). Wird über
   `_parse_issue_table` erkannt und geparst - zuverlässig, da
   spaltenbasiert.
2. **Detail-Export** ("HTML (alle Felder)" / Druckansicht): pro Ticket
   ein eigener Abschnitt mit Überschrift + Label/Wert-Tabellen. Als
   Anker für Ticket-Grenzen dient der Link auf die Vorgangsseite
   (`href=".../browse/PROJ-123"`), den Jira konsistent setzt. Wird von
   `_parse_detail_export` als Fallback verwendet, wenn Format 1 nicht
   erkannt wird.

Best-effort-Parser: Wenn ein konkreter Export von beiden Mustern
abweicht, hier die Erkennung anpassen.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from .field_aliases import JIRA_DATA_ID_MAP, normalize_label
from .model import Comment, Ticket

_BROWSE_HREF_RE = re.compile(r"/browse/([A-Z][A-Z0-9]*-\d+)")
_MULTI_VALUE_FIELDS = {"labels", "components", "fix_versions", "watchers"}


def parse_html(path: str) -> list[Ticket]:
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()

    soup = BeautifulSoup(raw, "lxml")
    table_tickets = _parse_issue_table(soup, source_file=path)
    if table_tickets is not None:
        return table_tickets

    return _parse_detail_export(raw, source_file=path)


def _parse_issue_table(soup: BeautifulSoup, source_file: str) -> list[Ticket] | None:
    table = soup.find(id="issuetable")
    if table is None:
        for candidate in soup.find_all("table"):
            if candidate.find("tr", attrs={"data-issuekey": True}):
                table = candidate
                break
    if table is None:
        return None

    column_labels: dict[str, str] = {}
    thead = table.find("thead")
    if thead is not None:
        for th in thead.find_all("th"):
            data_id = th.get("data-id")
            if data_id:
                column_labels[data_id] = th.get_text(" ", strip=True)

    tbody = table.find("tbody") or table
    rows = tbody.find_all("tr", attrs={"data-issuekey": True})
    if not rows:
        return None

    tickets: list[Ticket] = []
    for row in rows:
        key = row.get("data-issuekey")
        if not key:
            continue
        ticket = Ticket(key=key, source_file=source_file)
        for td in row.find_all("td", recursive=False):
            classes = [c for c in (td.get("class") or []) if c]
            if not classes:
                continue
            data_id = next((c for c in classes if c in column_labels or c in JIRA_DATA_ID_MAP), classes[0])
            value = td.get_text(" ", strip=True)
            if not value:
                continue
            canonical = JIRA_DATA_ID_MAP.get(data_id) or normalize_label(
                column_labels.get(data_id, data_id)
            )
            if canonical == "key" or canonical == "comments":
                continue
            if canonical in _MULTI_VALUE_FIELDS:
                setattr(ticket, canonical, [v.strip() for v in re.split(r"[,;\n]", value) if v.strip()])
            elif canonical:
                setattr(ticket, canonical, value)
            else:
                ticket.custom_fields[column_labels.get(data_id, data_id)] = value
        tickets.append(ticket)
    return tickets


def _parse_detail_export(raw: str, source_file: str) -> list[Ticket]:
    boundaries = _find_boundaries(raw)
    tickets: list[Ticket] = []
    for i, (key, start) in enumerate(boundaries):
        end = boundaries[i + 1][1] if i + 1 < len(boundaries) else len(raw)
        segment = raw[start:end]
        tickets.append(_parse_segment(key, segment, source_file=source_file))
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
