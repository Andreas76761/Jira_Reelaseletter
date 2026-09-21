"""End-to-End-Tests mit den synthetischen Beispiel-Exports unter
tests/fixtures/. Prüft den kompletten Weg: Parsen -> Bereinigen ->
Export als Markdown/PDF -> Release-Abgleich -> Release-Dokumente."""

from __future__ import annotations

from pathlib import Path

import pytest

from jira_releaseletter.cleaner import Cleaner, as_clean_export_dict
from jira_releaseletter.export_md import write_markdown
from jira_releaseletter.export_pdf import write_pdf
from jira_releaseletter.letter_builder import build_documents
from jira_releaseletter.parsers import parse_jira_export
from jira_releaseletter.release_matcher import match_release

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize(
    "filename,expected_keys",
    [
        ("sample_export.xml", ["DEMO-101", "DEMO-102", "DEMO-103"]),
        ("sample_export.html", ["DEMO-201", "DEMO-202"]),
        ("sample_export.docx", ["DEMO-301", "DEMO-302"]),
    ],
)
def test_parsers_extract_all_tickets(filename, expected_keys):
    tickets = parse_jira_export(str(FIXTURES / filename))
    assert [t.key for t in tickets] == expected_keys
    for t in tickets:
        assert t.summary


def test_cleaner_anonymizes_and_drops_pii():
    tickets = parse_jira_export(str(FIXTURES / "sample_export.xml"))
    cleaner = Cleaner()
    cleaned = [cleaner.clean_ticket(t) for t in tickets]

    for t in cleaned:
        assert t.comments == []
        assert t.watchers == []
        assert "@example.com" not in (t.description or "")
        if t.assignee:
            assert t.assignee.startswith("Person ")
        if t.reporter:
            assert t.reporter.startswith("Person ")

    # gleicher Klarname -> gleiches Pseudonym
    by_key = {t.key: t for t in cleaned}
    assert by_key["DEMO-101"].assignee == by_key["DEMO-102"].assignee  # Max Mustermann


def test_empty_fields_are_dropped_from_export_dict():
    tickets = parse_jira_export(str(FIXTURES / "sample_export.xml"))
    empty_ticket = next(t for t in tickets if t.key == "DEMO-103")
    cleaner = Cleaner()
    cleaned = cleaner.clean_ticket(empty_ticket)
    d = as_clean_export_dict(cleaned)
    assert "description" not in d
    assert "assignee" not in d
    assert "comments" not in d
    assert "watchers" not in d


def test_md_and_pdf_export(tmp_path):
    tickets = parse_jira_export(str(FIXTURES / "sample_export.xml"))
    cleaner = Cleaner()
    for t in tickets:
        cleaned = cleaner.clean_ticket(t)
        d = as_clean_export_dict(cleaned)
        md_path = write_markdown(d, tmp_path)
        pdf_path = write_pdf(d, tmp_path)
        assert md_path.exists() and md_path.stat().st_size > 0
        assert pdf_path.exists() and pdf_path.stat().st_size > 0
        assert d["key"] in md_path.read_text(encoding="utf-8")


def test_release_matcher_finds_missing_tickets():
    result = match_release(
        "2026.1",
        release_keys=["DEMO-101", "DEMO-102", "DEMO-999"],
        available_keys=["DEMO-101", "DEMO-102", "DEMO-103"],
    )
    assert result.found == ["DEMO-101", "DEMO-102"]
    assert result.missing == ["DEMO-999"]
    assert result.extra == ["DEMO-103"]


def test_build_documents_creates_all_four_drafts(tmp_path):
    tickets = [
        {"key": "DEMO-101", "summary": "Login-Fehler", "status": "Open", "description": "Text"},
        {"key": "DEMO-102", "summary": "Export", "status": "Done"},
    ]
    written = build_documents("2026.1", tickets, tmp_path)
    assert set(written) == {
        "releaseletter",
        "benutzerhandbuch",
        "prozessdiagramm",
        "clickanweisung",
    }
    for path in written.values():
        content = path.read_text(encoding="utf-8")
        assert "DEMO-101" in content
        assert "DEMO-102" in content

    mermaid = written["prozessdiagramm"].read_text(encoding="utf-8")
    assert "```mermaid" in mermaid
    assert "    t1[" in mermaid
    assert "    t1 --> t2" in mermaid
