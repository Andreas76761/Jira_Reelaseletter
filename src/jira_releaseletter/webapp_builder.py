"""Baut die Ticket-Cockpit-Web-App (webapp/ticket_cockpit.html) mit den
aktuellen bereinigten Ticketdaten (data/tickets.json) zu einer
eigenständigen HTML-Datei.

Die Web-App läuft vollständig im Browser (Parsing/Bereinigung neuer
Exporte, Suche/Filter). Der Datei-Download (einzelnes Ticket / ZIP-Archiv)
nutzt die "downloads"-Capability der Claude-Artifact-Laufzeit und
funktioniert daher nur, wenn die Datei als Claude-Artifact veröffentlicht
ist - beim direkten Öffnen im Browser lokal funktionieren Ansicht,
Suche und Filter, aber keine Downloads.
"""

from __future__ import annotations

import json
from pathlib import Path

_DATA_PLACEHOLDER = "__TICKET_DATA__"
_META_PLACEHOLDER = "__TICKET_META__"


def build_webapp(
    tickets: list[dict],
    template_path: Path,
    output_path: Path,
    meta: dict | None = None,
) -> Path:
    template = template_path.read_text(encoding="utf-8")
    if _DATA_PLACEHOLDER not in template:
        raise ValueError(f"Platzhalter {_DATA_PLACEHOLDER} nicht in {template_path} gefunden.")
    data_json = json.dumps(tickets, ensure_ascii=False, separators=(",", ":"))
    meta_json = json.dumps(meta or {}, ensure_ascii=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    content = template.replace(_DATA_PLACEHOLDER, data_json).replace(_META_PLACEHOLDER, meta_json)
    output_path.write_text(content, encoding="utf-8")
    return output_path
