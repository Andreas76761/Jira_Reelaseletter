"""Format-Erkennung und Dispatch auf den passenden Parser."""

from __future__ import annotations

from pathlib import Path

from .model import Ticket
from .parser_docx import parse_docx
from .parser_html import parse_html
from .parser_xml import parse_xml


class UnsupportedFormatError(Exception):
    pass


def parse_jira_export(path: str) -> list[Ticket]:
    """Erkennt das Format anhand der Dateiendung/des Inhalts und liefert
    die enthaltenen Tickets als Liste."""
    p = Path(path)
    suffix = p.suffix.lower()

    if suffix == ".xml":
        return parse_xml(path)
    if suffix == ".docx":
        return parse_docx(path)
    if suffix in (".html", ".htm"):
        return parse_html(path)

    # Endung unbekannt/uneindeutig (z.B. .txt) -> Inhalt schnuppern.
    with open(path, "rb") as fh:
        head = fh.read(4096)
    if head.lstrip().startswith(b"PK"):
        return parse_docx(path)
    if b"<?xml" in head[:200]:
        return parse_xml(path)
    if b"<html" in head.lower() or b"<!doctype html" in head.lower():
        return parse_html(path)

    raise UnsupportedFormatError(
        f"Konnte Format von '{path}' nicht erkennen (erwartet: .xml, .html/.htm, .docx)"
    )
