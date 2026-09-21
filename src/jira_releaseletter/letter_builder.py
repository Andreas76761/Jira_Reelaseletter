"""Phase 3: Aus mehreren Tickets Release-Letter, Benutzerhandbuch,
Prozessdiagramm und Click-Anweisung generieren.

Erzeugt Entwürfe (Markdown) auf Basis der bereinigten Ticket-Daten. Die
automatische Zusammenstellung kennt den redaktionellen Kontext eines
Release nicht - die Ergebnisse sind bewusst als Rohgerüst gedacht, das vor
Veröffentlichung geprüft/überarbeitet wird.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_DOCUMENTS = {
    "releaseletter": ("releaseletter.md.j2", "03_Releaseletter"),
    "benutzerhandbuch": ("benutzerhandbuch.md.j2", "04_Benutzerhandbuch"),
    "prozessdiagramm": ("prozessdiagramm.md.j2", "05_Prozessdiagramm"),
    "clickanweisung": ("clickanweisung.md.j2", "06_Clickanweisung"),
}


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(disabled_extensions=(".j2",), default=False),
        trim_blocks=True,
        lstrip_blocks=True,
    )


def build_documents(
    release_name: str,
    tickets: list[dict],
    output_root: Path,
    documents: list[str] | None = None,
) -> dict[str, Path]:
    """Rendert die gewählten Dokumenttypen und schreibt sie unter
    output_root/<Themenordner>/. Gibt {doc_type: geschriebener_pfad}
    zurück."""
    env = _env()
    generated_at = date.today().isoformat()
    wanted = documents or list(_DOCUMENTS)
    written: dict[str, Path] = {}

    safe_release = "".join(c if c.isalnum() or c in "-_" else "_" for c in release_name)

    for doc_type in wanted:
        if doc_type not in _DOCUMENTS:
            raise ValueError(
                f"Unbekannter Dokumenttyp '{doc_type}', erlaubt: {list(_DOCUMENTS)}"
            )
        template_name, subfolder = _DOCUMENTS[doc_type]
        template = env.get_template(template_name)
        content = template.render(
            release_name=release_name, generated_at=generated_at, tickets=tickets
        )
        out_dir = output_root / subfolder
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{safe_release}_{doc_type}.md"
        out_path.write_text(content, encoding="utf-8")
        written[doc_type] = out_path

    return written
