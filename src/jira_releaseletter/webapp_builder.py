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
_TEST_RESULTS_PLACEHOLDER = "__TEST_RESULTS__"


def _script_safe_json(value, separators=None) -> str:
    # "<" als JSON-Escape, damit Ticketinhalte wie "</script>" oder "<!--" das
    # einbettende <script type="application/json">-Tag nicht vorzeitig beenden.
    return json.dumps(value, ensure_ascii=False, separators=separators).replace("<", "\\u003c")


def build_webapp(
    tickets: list[dict],
    template_path: Path,
    output_path: Path,
    meta: dict | None = None,
    test_results: dict | None = None,
) -> Path:
    template = template_path.read_text(encoding="utf-8")
    if _DATA_PLACEHOLDER not in template:
        raise ValueError(f"Platzhalter {_DATA_PLACEHOLDER} nicht in {template_path} gefunden.")
    data_json = _script_safe_json(tickets, separators=(",", ":"))
    meta_json = _script_safe_json(meta or {})
    test_results_json = _script_safe_json(test_results or {}, separators=(",", ":"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Nur das jeweils erste Vorkommen (das <script>-Tag) ersetzen - weitere
    # Erwähnungen des Platzhalters, z. B. in Kommentaren, bleiben unverändert.
    content = (
        template.replace(_DATA_PLACEHOLDER, data_json, 1)
        .replace(_META_PLACEHOLDER, meta_json, 1)
        .replace(_TEST_RESULTS_PLACEHOLDER, test_results_json, 1)
    )
    output_path.write_text(content, encoding="utf-8")
    return output_path
