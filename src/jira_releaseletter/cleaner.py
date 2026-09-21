"""Bereinigung personenbezogener Daten und leerer Felder.

Vorgehen (siehe auch README):
- Kommentare und Beobachter (watchers) werden komplett entfernt - dort
  stehen typischerweise die meisten Klarnamen und internen Notizen.
- Bearbeiter (assignee) und Ersteller (reporter) werden durch ein
  Pseudonym ersetzt ("Person 1", "Person 2", ...). Die Zuordnung ist nur
  für den aktuellen Lauf im Speicher konsistent (gleiche Person -> gleiches
  Pseudonym) und wird NICHT auf Platte geschrieben, damit keine
  Klarname-Zuordnung im Output landet.
- E-Mail-Adressen werden aus allen Freitextfeldern (Zusammenfassung,
  Beschreibung, Custom Fields) entfernt.
- Optional: eine Namensliste (eine Zeile pro Name) kann zusätzliche
  Klarnamen aus Freitext entfernen - vollautomatische Namenserkennung in
  Fließtext ohne NLP-Modell ist nicht zuverlässig, daher dieser
  Deny-List-Ansatz als Ergänzung.
- Leere Felder (None, "", [], {}) werden beim Export komplett weggelassen.
"""

from __future__ import annotations

import re
from dataclasses import replace

from .model import Ticket

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
EMAIL_PLACEHOLDER = "[E-Mail entfernt]"
NAME_PLACEHOLDER = "[Name entfernt]"


class PersonAnonymizer:
    """Vergibt pro Klarname ein konsistentes Pseudonym (nur im Speicher)."""

    def __init__(self) -> None:
        self._mapping: dict[str, str] = {}

    def anonymize(self, name: str | None) -> str | None:
        if not name or not name.strip():
            return name
        key = name.strip()
        if key not in self._mapping:
            self._mapping[key] = f"Person {len(self._mapping) + 1}"
        return self._mapping[key]

    @property
    def person_count(self) -> int:
        return len(self._mapping)


class Cleaner:
    def __init__(self, deny_list_names: list[str] | None = None) -> None:
        self.anonymizer = PersonAnonymizer()
        self._name_re = None
        names = [n.strip() for n in (deny_list_names or []) if n.strip()]
        if names:
            pattern = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
            self._name_re = re.compile(rf"\b({pattern})\b")

    def redact_text(self, text: str | None) -> str:
        if not text:
            return ""
        text = EMAIL_RE.sub(EMAIL_PLACEHOLDER, text)
        if self._name_re is not None:
            text = self._name_re.sub(NAME_PLACEHOLDER, text)
        return text

    def clean_ticket(self, ticket: Ticket) -> Ticket:
        cleaned = replace(
            ticket,
            summary=self.redact_text(ticket.summary),
            description=self.redact_text(ticket.description),
            assignee=self.anonymizer.anonymize(ticket.assignee),
            reporter=self.anonymizer.anonymize(ticket.reporter),
            comments=[],  # komplett entfernen (enthalten meist Klarnamen)
            watchers=[],  # komplett entfernen
            custom_fields={
                k: self.redact_text(v) for k, v in ticket.custom_fields.items()
            },
            warnings=list(ticket.warnings),
        )
        return cleaned


def as_clean_export_dict(ticket: Ticket) -> dict[str, object]:
    """Feld-Dict für den Export, leere Felder werden entfernt."""
    raw = ticket.as_field_dict()
    result: dict[str, object] = {}
    for field_name, value in raw.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, dict)) and not value:
            continue
        if field_name == "comments" and isinstance(value, list) and not value:
            continue
        result[field_name] = value
    return result
