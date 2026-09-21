"""Hilfsfunktionen für Ein-/Ausgabe: Release-Listen, JSON-Datenablage."""

from __future__ import annotations

import csv
import json
from pathlib import Path

_KEY_RE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")


def read_release_list(path: str) -> list[str]:
    """Liest eine Liste von Jira-Keys aus einer .txt- oder .csv-Datei.

    .txt: ein Key pro Zeile, Leerzeilen und Zeilen mit '#' werden ignoriert.
    .csv: erste Spalte wird verwendet; eine Kopfzeile ohne gültigen
    Jira-Key wird übersprungen.
    """
    p = Path(path)
    keys: list[str] = []
    if p.suffix.lower() == ".csv":
        with p.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.reader(fh):
                if not row:
                    continue
                candidate = row[0].strip()
                if candidate and _looks_like_key(candidate):
                    keys.append(candidate)
    else:
        with p.open(encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                keys.append(line.split()[0])
    return keys


def _looks_like_key(value: str) -> bool:
    value = value.strip().upper()
    return bool(value) and "-" in value and set(value) <= _KEY_RE_CHARS


def save_tickets_json(tickets: list[dict], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(tickets, fh, ensure_ascii=False, indent=2)


def load_tickets_json(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
