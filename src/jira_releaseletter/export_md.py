"""Export eines bereinigten Tickets als einzelne Markdown-Datei."""

from __future__ import annotations

import re
from pathlib import Path

from .field_aliases import DISPLAY_LABELS_DE, FIELD_DISPLAY_ORDER

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9_\-]+")


def safe_filename(key: str) -> str:
    return _SAFE_FILENAME_RE.sub("_", key).strip("_") or "TICKET"


def render_markdown(ticket_dict: dict[str, object]) -> str:
    key = ticket_dict.get("key", "UNKNOWN")
    summary = ticket_dict.get("summary", "")
    lines = [f"# {key}" + (f" – {summary}" if summary else ""), ""]

    lines.append("| Feld | Wert |")
    lines.append("| --- | --- |")
    for field_name in FIELD_DISPLAY_ORDER:
        if field_name in ("key", "summary", "description"):
            continue
        if field_name not in ticket_dict:
            continue
        value = ticket_dict[field_name]
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value)
        lines.append(f"| {DISPLAY_LABELS_DE.get(field_name, field_name)} | {value} |")

    custom_fields = ticket_dict.get("custom_fields") or {}
    for name, value in custom_fields.items():
        lines.append(f"| {name} | {value} |")

    lines.append("")

    description = ticket_dict.get("description")
    if description:
        lines.append("## Beschreibung")
        lines.append("")
        lines.append(str(description))
        lines.append("")

    return "\n".join(lines)


def write_markdown(ticket_dict: dict[str, object], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(str(ticket_dict.get("key", "UNKNOWN"))) + ".md"
    path = output_dir / filename
    path.write_text(render_markdown(ticket_dict), encoding="utf-8")
    return path
