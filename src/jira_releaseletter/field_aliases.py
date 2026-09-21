"""Zuordnung von Feld-Bezeichnungen (Deutsch/Englisch, wie sie in Jira-HTML-
und Word-Exporten vorkommen) auf die kanonischen Feldnamen im Ticket-Modell.

Jira-HTML- und Word-Exporte haben kein festes Schema (abhängig von Sprache,
Jira-Version und Add-ons). Diese Liste deckt die gängigsten Beschriftungen
ab. Fehlt eine Bezeichnung aus einem echten Export, hier ergänzen -
kanonischer Feldname links, mögliche Label-Varianten rechts.
"""

from __future__ import annotations

CANONICAL_FIELD_LABELS: dict[str, list[str]] = {
    "key": ["key", "schlüssel", "issue key", "ticket"],
    "summary": ["summary", "zusammenfassung", "titel"],
    "issue_type": ["type", "issue type", "typ", "vorgangstyp"],
    "status": ["status"],
    "priority": ["priority", "priorität"],
    "project": ["project", "projekt"],
    "resolution": ["resolution", "lösung"],
    "assignee": ["assignee", "bearbeiter", "zugewiesen an"],
    "reporter": ["reporter", "ersteller", "melder"],
    "created": ["created", "erstellt", "erstellungsdatum"],
    "updated": ["updated", "aktualisiert", "geändert"],
    "labels": ["labels", "label", "schlagwörter"],
    "components": ["component", "components", "komponente", "komponenten"],
    "fix_versions": [
        "fix version", "fix versions", "fix version/s",
        "fixversion", "ziel-version", "fixversionen",
    ],
    "description": ["description", "beschreibung"],
    "comments": ["comments", "kommentare"],
    "watchers": ["watchers", "beobachter"],
}

# Reverse lookup: normalisiertes Label -> kanonischer Feldname
_LABEL_TO_FIELD: dict[str, str] = {}
for canonical, variants in CANONICAL_FIELD_LABELS.items():
    for variant in variants:
        _LABEL_TO_FIELD[variant.strip().lower().rstrip(":")] = canonical


def normalize_label(label: str) -> str | None:
    """Gibt den kanonischen Feldnamen für ein Label zurück, oder None."""
    return _LABEL_TO_FIELD.get(label.strip().lower().rstrip(":"))


# Anzeige-Labels (Deutsch) für den Export, in Anzeigereihenfolge.
DISPLAY_LABELS_DE: dict[str, str] = {
    "key": "Ticket",
    "summary": "Zusammenfassung",
    "issue_type": "Typ",
    "status": "Status",
    "priority": "Priorität",
    "project": "Projekt",
    "resolution": "Lösung",
    "assignee": "Bearbeiter",
    "reporter": "Ersteller",
    "created": "Erstellt",
    "updated": "Aktualisiert",
    "labels": "Labels",
    "components": "Komponenten",
    "fix_versions": "Fix-Version(en)",
    "description": "Beschreibung",
}

# Jira-interne Spalten-IDs (data-id/class in der Issue-Navigator-Tabelle,
# z.B. beim HTML-Export "aktuelle Felder") -> kanonischer Feldname.
JIRA_DATA_ID_MAP: dict[str, str] = {
    "issuekey": "key",
    "summary": "summary",
    "issuetype": "issue_type",
    "status": "status",
    "priority": "priority",
    "project": "project",
    "resolution": "resolution",
    "assignee": "assignee",
    "reporter": "reporter",
    "created": "created",
    "updated": "updated",
    "labels": "labels",
    "components": "components",
    "fixVersions": "fix_versions",
    "fixfor": "fix_versions",
    "description": "description",
    "comment": "comments",
    "watches": "watchers",
}

FIELD_DISPLAY_ORDER: list[str] = [
    "key",
    "summary",
    "issue_type",
    "status",
    "priority",
    "project",
    "resolution",
    "assignee",
    "reporter",
    "created",
    "updated",
    "labels",
    "components",
    "fix_versions",
]
