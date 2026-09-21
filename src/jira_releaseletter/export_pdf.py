"""Export eines bereinigten Tickets als einzelne PDF-Datei (fpdf2, keine
externen Systemabhängigkeiten wie wkhtmltopdf nötig)."""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

from .export_md import safe_filename
from .field_aliases import DISPLAY_LABELS_DE, FIELD_DISPLAY_ORDER

_MARGIN = 15


def _build_pdf(ticket_dict: dict[str, object]) -> FPDF:
    pdf = FPDF(format="A4")
    pdf.set_margins(_MARGIN, _MARGIN, _MARGIN)
    pdf.set_auto_page_break(auto=True, margin=_MARGIN)
    pdf.add_page()

    key = str(ticket_dict.get("key", "UNKNOWN"))
    summary = str(ticket_dict.get("summary", ""))

    pdf.set_font("Helvetica", "B", 16)
    pdf.multi_cell(0, 9, f"{key}" + (f" - {summary}" if summary else ""))
    pdf.ln(2)

    pdf.set_font("Helvetica", "", 11)
    for field_name in FIELD_DISPLAY_ORDER:
        if field_name in ("key", "summary", "description"):
            continue
        if field_name not in ticket_dict:
            continue
        value = ticket_dict[field_name]
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value)
        _field_row(pdf, DISPLAY_LABELS_DE.get(field_name, field_name), str(value))

    custom_fields = ticket_dict.get("custom_fields") or {}
    for name, value in custom_fields.items():
        _field_row(pdf, str(name), str(value))

    description = ticket_dict.get("description")
    if description:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Beschreibung")
        pdf.ln(8)
        pdf.set_font("Helvetica", "", 11)
        pdf.multi_cell(0, 6, str(description))

    return pdf


_LABEL_WIDTH = 45


def _field_row(pdf: FPDF, label: str, value: str) -> None:
    x, y = pdf.get_x(), pdf.get_y()
    pdf.set_font("Helvetica", "B", 11)
    pdf.multi_cell(_LABEL_WIDTH, 6, f"{label}:")
    value_x = x + _LABEL_WIDTH
    pdf.set_xy(value_x, y)
    pdf.set_font("Helvetica", "", 11)
    value_width = pdf.w - pdf.r_margin - value_x
    pdf.multi_cell(value_width, 6, value, new_x="LMARGIN", new_y="NEXT")


def write_pdf(ticket_dict: dict[str, object], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(str(ticket_dict.get("key", "UNKNOWN"))) + ".pdf"
    path = output_dir / filename
    pdf = _build_pdf(ticket_dict)
    pdf.output(str(path))
    return path
