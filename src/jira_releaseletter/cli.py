"""Kommandozeilen-Werkzeug für die drei Verarbeitungsschritte:

  import          Jira-Exportdatei einlesen, bereinigen, pro Ticket als
                   Markdown/PDF ablegen (Phase 1)
  match-release   Release-Ticketliste gegen vorhandene Tickets abgleichen
                   und fehlende Tickets ausweisen (Phase 2)
  build-letter    Release-Letter, Benutzerhandbuch, Prozessdiagramm und
                   Klickanweisung aus den Tickets eines Release generieren
                   (Phase 3)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from .cleaner import Cleaner, as_clean_export_dict
from .export_md import write_markdown
from .export_pdf import write_pdf
from .io_utils import load_tickets_json, read_release_list, save_tickets_json
from .letter_builder import build_documents
from .parsers import parse_jira_export
from .release_matcher import match_release
from .webapp_builder import build_webapp

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT_DIR = REPO_ROOT / "Input"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "Output"
DEFAULT_TICKETS_OUTPUT = DEFAULT_OUTPUT_DIR / "01_Tickets_bereinigt"
DEFAULT_RELEASE_OUTPUT = DEFAULT_OUTPUT_DIR / "02_Release_Zuordnung"
DEFAULT_DATA_STORE = REPO_ROOT / "data" / "tickets.json"
DEFAULT_WEBAPP_TEMPLATE = REPO_ROOT / "webapp" / "ticket_cockpit.html"
DEFAULT_WEBAPP_OUTPUT = REPO_ROOT / "webapp" / "ticket_cockpit.build.html"


def cmd_import(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Eingabedatei nicht gefunden: {input_path}", file=sys.stderr)
        return 1

    deny_list: list[str] = []
    if args.names_denylist:
        deny_list = [
            line.strip()
            for line in Path(args.names_denylist).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    print(f"Lese Jira-Export: {input_path}")
    tickets = parse_jira_export(str(input_path))
    print(f"{len(tickets)} Tickets gefunden. Bereinige und exportiere...")

    cleaner = Cleaner(deny_list_names=deny_list)
    output_dir = Path(args.output_dir)
    formats = set(args.formats)

    cleaned_dicts: list[dict] = []
    for i, ticket in enumerate(tickets, start=1):
        cleaned = cleaner.clean_ticket(ticket)
        ticket_dict = as_clean_export_dict(cleaned)
        cleaned_dicts.append(ticket_dict)

        if "md" in formats:
            write_markdown(ticket_dict, output_dir)
        if "pdf" in formats:
            write_pdf(ticket_dict, output_dir)

        if i % 100 == 0 or i == len(tickets):
            print(f"  {i}/{len(tickets)} Tickets verarbeitet")

    save_tickets_json(cleaned_dicts, str(args.data_store))
    meta_path = Path(args.data_store).parent / "import_meta.json"
    meta_path.write_text(
        json.dumps(
            {
                "source": input_path.name,
                "when": date.today().strftime("%d.%m.%Y"),
                "format": input_path.suffix.lstrip(".").upper() + "-Export",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        f"Fertig: {len(tickets)} Tickets bereinigt, "
        f"{cleaner.anonymizer.person_count} Personen pseudonymisiert."
    )
    print(f"Export: {output_dir}")
    print(f"Interner Datenspeicher (für Phase 2/3): {args.data_store}")
    return 0


def cmd_match_release(args: argparse.Namespace) -> int:
    data_store = Path(args.data_store)
    if not data_store.exists():
        print(
            f"Keine Ticket-Daten gefunden ({data_store}). Zuerst 'import' ausführen.",
            file=sys.stderr,
        )
        return 1

    tickets = load_tickets_json(str(data_store))
    available_keys = [t["key"] for t in tickets if "key" in t]

    release_keys = read_release_list(args.release_list)
    if not release_keys:
        print(f"Keine Ticket-Keys in {args.release_list} gefunden.", file=sys.stderr)
        return 1

    result = match_release(args.release_name, release_keys, available_keys)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in args.release_name)
    out_path = output_dir / f"{safe_name}_abgleich.md"
    out_path.write_text(result.as_markdown(), encoding="utf-8")

    print(f"{len(result.found)}/{result.total_requested} Tickets vorhanden.")
    if result.missing:
        print(f"Fehlend ({len(result.missing)}): {', '.join(result.missing)}")
    print(f"Bericht: {out_path}")
    return 0


def cmd_build_letter(args: argparse.Namespace) -> int:
    data_store = Path(args.data_store)
    if not data_store.exists():
        print(
            f"Keine Ticket-Daten gefunden ({data_store}). Zuerst 'import' ausführen.",
            file=sys.stderr,
        )
        return 1

    all_tickets = {t["key"]: t for t in load_tickets_json(str(data_store)) if "key" in t}

    if args.release_list:
        keys = read_release_list(args.release_list)
    elif args.keys:
        keys = args.keys
    else:
        print("Entweder --release-list oder --keys angeben.", file=sys.stderr)
        return 1

    selected = []
    missing = []
    for key in keys:
        ticket = all_tickets.get(key.strip().upper()) or all_tickets.get(key.strip())
        if ticket is None:
            missing.append(key)
        else:
            selected.append(ticket)

    if missing:
        print(
            f"Warnung: {len(missing)} Tickets nicht in den bereinigten Daten "
            f"gefunden (erst 'import' bzw. 'match-release' prüfen): "
            f"{', '.join(missing)}",
            file=sys.stderr,
        )
    if not selected:
        print("Keine passenden Tickets gefunden - Abbruch.", file=sys.stderr)
        return 1

    written = build_documents(
        release_name=args.release_name,
        tickets=selected,
        output_root=Path(args.output_dir),
        documents=args.documents,
    )
    for doc_type, path in written.items():
        print(f"{doc_type}: {path}")
    return 0


def cmd_build_webapp(args: argparse.Namespace) -> int:
    data_store = Path(args.data_store)
    if not data_store.exists():
        print(
            f"Keine Ticket-Daten gefunden ({data_store}). Zuerst 'import' ausführen.",
            file=sys.stderr,
        )
        return 1
    tickets = load_tickets_json(str(data_store))
    meta_path = data_store.parent / "import_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None
    test_results_path = Path(args.template).parent / "tests" / "test-results.json"
    test_results = (
        json.loads(test_results_path.read_text(encoding="utf-8")) if test_results_path.exists() else None
    )
    output_path = build_webapp(
        tickets, Path(args.template), Path(args.output), meta=meta, test_results=test_results
    )
    print(f"Web-App gebaut: {output_path} ({len(tickets)} Tickets eingebettet)")
    if test_results:
        summary = test_results.get("summary", {})
        print(
            "Testergebnisse eingebettet: "
            f"{summary.get('filesPassed', '?')}/{summary.get('filesTotal', '?')} Dateien, "
            f"{summary.get('checksPassed', '?')}/{summary.get('checksTotal', '?')} Testfaelle "
            f"(Stand: {test_results.get('generatedAt', '?')})"
        )
    else:
        print(
            f"Hinweis: keine Testergebnisse gefunden ({test_results_path}) - "
            "Testdashboard in der App bleibt leer, bis 'node run-all.js' einmal gelaufen ist."
        )
    print(
        "Hinweis: Lokal geöffnet funktionieren Ansicht/Suche/Filter; Downloads "
        "(einzelnes Ticket/ZIP) benötigen die Claude-Artifact-Laufzeit."
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jira-releaseletter",
        description="Jira-Export bereinigen, Release-Tickets abgleichen, Release-Dokumente erzeugen.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_import = sub.add_parser("import", help="Phase 1: Jira-Export bereinigen und exportieren")
    p_import.add_argument("--input", required=True, help="Pfad zur Jira-Exportdatei (.xml/.html/.docx)")
    p_import.add_argument("--output-dir", default=str(DEFAULT_TICKETS_OUTPUT))
    p_import.add_argument("--data-store", default=str(DEFAULT_DATA_STORE))
    p_import.add_argument("--formats", nargs="+", choices=["md", "pdf"], default=["md", "pdf"])
    p_import.add_argument(
        "--names-denylist",
        help="Optionale Textdatei mit zusätzlichen Klarnamen (ein Name pro Zeile), die aus Freitext entfernt werden",
    )
    p_import.set_defaults(func=cmd_import)

    p_match = sub.add_parser("match-release", help="Phase 2: Release-Ticketliste abgleichen")
    p_match.add_argument("--release-name", required=True)
    p_match.add_argument("--release-list", required=True, help="Datei (.txt/.csv) mit Ticket-Keys des Release")
    p_match.add_argument("--data-store", default=str(DEFAULT_DATA_STORE))
    p_match.add_argument("--output-dir", default=str(DEFAULT_RELEASE_OUTPUT))
    p_match.set_defaults(func=cmd_match_release)

    p_letter = sub.add_parser("build-letter", help="Phase 3: Release-Dokumente erzeugen")
    p_letter.add_argument("--release-name", required=True)
    p_letter.add_argument("--release-list", help="Datei (.txt/.csv) mit Ticket-Keys des Release")
    p_letter.add_argument("--keys", nargs="+", help="Alternativ: Ticket-Keys direkt angeben")
    p_letter.add_argument("--data-store", default=str(DEFAULT_DATA_STORE))
    p_letter.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    p_letter.add_argument(
        "--documents",
        nargs="+",
        choices=["releaseletter", "benutzerhandbuch", "prozessdiagramm", "clickanweisung"],
        default=None,
        help="Standard: alle vier Dokumente",
    )
    p_letter.set_defaults(func=cmd_build_letter)

    p_webapp = sub.add_parser(
        "build-webapp", help="Ticket-Cockpit-Web-App mit aktuellen Daten bauen"
    )
    p_webapp.add_argument("--data-store", default=str(DEFAULT_DATA_STORE))
    p_webapp.add_argument("--template", default=str(DEFAULT_WEBAPP_TEMPLATE))
    p_webapp.add_argument("--output", default=str(DEFAULT_WEBAPP_OUTPUT))
    p_webapp.set_defaults(func=cmd_build_webapp)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
