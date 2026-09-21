# Jira Releaseletter Toolkit

Werkzeug für drei aufeinander aufbauende Schritte:

1. **`import`** – Eine Jira-Exportdatei (XML, HTML oder DOCX) mit vielen
   Tickets einlesen, personenbezogene Daten bereinigen, leere Felder
   entfernen und **jedes Ticket einzeln** als Markdown- und/oder
   PDF-Datei ablegen.
2. **`match-release`** – Eine Liste von Ticket-Keys, die zu einem Release
   gehören, gegen die bereits bereinigten Tickets abgleichen und
   ausweisen, welche noch fehlen.
3. **`build-letter`** – Aus den Tickets eines Release einen Entwurf für
   Release Letter, Benutzerhandbuch, Prozessdiagramm (Mermaid) und
   Klickanweisung erzeugen.

Zusätzlich gibt es unter `webapp/` eine **Browser-Web-App** ("Ticket-Cockpit"),
die Phase 1 (Upload, Bereinigung, Durchsuchen, Export) mit grafischer
Oberfläche abbildet – siehe [Web-App](#web-app-ticket-cockpit) unten.

## Wichtiger Hinweis zum Speicherort

Dieses Repository läuft hier in einer Cloud-/Remote-Umgebung, nicht auf
einem Windows-PC. Die Ordnerstruktur (`Input/`, `Output/<Thema>/`) ist
**in diesem Git-Repo** angelegt. Um lokal unter
`C:\Users\Azehnpf\2026\Jira_Releaseletter 092026` damit zu arbeiten:

```powershell
cd C:\Users\Azehnpf\2026
git clone <URL-dieses-Repos> "Jira_Releaseletter 092026"
cd "Jira_Releaseletter 092026"
```

(oder: bestehenden Klon dorthin `git pull`). Danach befinden sich
`Input\` und `Output\...` als normale Windows-Ordner darunter.

## Ordnerstruktur

```
Input/                          <- Jira-Exportdatei(en) hier ablegen
Output/
  01_Tickets_bereinigt/         <- Phase 1: ein MD + PDF je Ticket
  02_Release_Zuordnung/         <- Phase 2: Abgleichsberichte je Release
  03_Releaseletter/             <- Phase 3: Release-Letter-Entwürfe
  04_Benutzerhandbuch/          <- Phase 3: Benutzerhandbuch-Entwürfe
  05_Prozessdiagramm/           <- Phase 3: Mermaid-Prozessdiagramme
  06_Clickanweisung/            <- Phase 3: Klickanweisungs-Entwürfe
data/tickets.json               <- interner Datenspeicher (bereinigt),
                                    Grundlage für Phase 2 und 3, wird
                                    nicht ins Git-Repo eingecheckt
```

## Einrichtung

Voraussetzung: Python 3.10+.

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .
```

Danach steht der Befehl `jira-releaseletter` zur Verfügung.

## Phase 1: Import & Bereinigung

```bash
jira-releaseletter import --input Input/mein_export.xml
```

Optionen:
- `--formats md pdf` (Standard: beide) – nur Markdown oder nur PDF erzeugen.
- `--names-denylist Input/namen.txt` – zusätzliche Klarnamen (eine Zeile
  pro Name), die aus Freitextfeldern (Zusammenfassung, Beschreibung)
  entfernt werden.
- `--output-dir` / `--data-store` – Zielordner überschreiben.

**Was bereinigt wird:**
- `assignee`/`reporter` werden durch ein Pseudonym ersetzt (`Person 1`,
  `Person 2`, …), pro Lauf konsistent, aber nicht auf Platte gespeichert.
- `comments` und `watchers` werden **komplett entfernt** (dort stehen
  typischerweise die meisten Klarnamen/internen Notizen).
- E-Mail-Adressen werden aus allen Freitextfeldern entfernt.
- Zusätzliche Klarnamen aus der `--names-denylist` werden aus Freitext
  entfernt.
- Leere Felder tauchen im Output gar nicht erst auf.

**Grenzen der automatischen Bereinigung:** Vollautomatische
Namenserkennung in Fließtext (z. B. in der Beschreibung) ohne
NLP-Modell ist nicht zuverlässig. Namen in strukturierten Feldern
(Bearbeiter/Ersteller) werden zuverlässig erkannt; Namen, die nur im
Freitext vorkommen, werden nur erkannt, wenn sie über
`--names-denylist` explizit genannt werden. Vor Weitergabe der
Ergebnisse stichprobenartig prüfen.

## Phase 2: Release-Abgleich

Release-Ticketliste als `.txt` (ein Key pro Zeile) oder `.csv` (erste
Spalte) bereitstellen, z. B. `Input/release_2026.1.txt`:

```
DEMO-101
DEMO-102
DEMO-205
```

```bash
jira-releaseletter match-release \
  --release-name "2026.1" \
  --release-list Input/release_2026.1.txt
```

Ergebnis: `Output/02_Release_Zuordnung/2026_1_abgleich.md` mit
vorhandenen, fehlenden und zusätzlichen Tickets.

## Phase 3: Release-Dokumente erzeugen

```bash
jira-releaseletter build-letter \
  --release-name "2026.1" \
  --release-list Input/release_2026.1.txt
```

Alternativ direkt Keys angeben: `--keys DEMO-101 DEMO-102 ...`

Erzeugt je einen Markdown-Entwurf in `03_Releaseletter/`,
`04_Benutzerhandbuch/`, `05_Prozessdiagramm/` (mit eingebettetem
Mermaid-Flussdiagramm) und `06_Clickanweisung/`. Mit `--documents` lässt
sich die Auswahl einschränken, z. B. `--documents releaseletter`.

**Wichtig:** Diese Dokumente sind automatisch erzeugte **Rohgerüste**
aus den Ticket-Zusammenfassungen/-Beschreibungen. Sie kennen den
redaktionellen Kontext des Release nicht (z. B. was hervorzuheben ist,
Screenshots für die Klickanweisung, die tatsächliche
Prozess-Reihenfolge). Vor Veröffentlichung immer redaktionell prüfen
und überarbeiten.

## Web-App: Ticket-Cockpit

`webapp/ticket_cockpit.html` ist eine eigenständige Single-Page-App (kein
Server, kein Build-Schritt) mit ausklappbarer Navigationsleiste und
folgenden Bereichen:

- **Dashboard** – zusammengeführter, aktueller Stand aller importierten
  Tickets: Status-Kacheln, Domain-Verteilung, Volltextsuche, sortierbare
  Tabelle, Ticket-Detailansicht (18 Standardfelder, fehlende klar als
  "Nicht im Export enthalten" markiert statt erfunden).
- **Import** – vier Formate per Tab wählbar, jeweils mit Mehrfachauswahl
  und Drag&Drop; zusätzlich eine **Zwischenablage-Funktion**: Text direkt
  einfügen (Button „Aus Zwischenablage einfügen“ oder Strg+V in das
  Textfeld), Format wird automatisch erkannt, Button „Verarbeiten und
  speichern“ zeigt während der Verarbeitung eine Sanduhr/Spinner-Animation;
  das Ergebnis erscheint in der Dateiverwaltung mit der Quelle „Manuell
  (Zwischenablage)“. Parsing/Bereinigung laufen vollständig im Browser, die
  Datei/der Text verlässt den Rechner nicht:
  - *Jira Massenupload* – Jira-HTML-Export (Issue-Navigator-Tabelle)
    oder klassischer XML-Export (JavaScript-Portierung von
    `parser_html.py`/`parser_xml.py`/`cleaner.py`).
  - *Jira Einzelticket* – einzelne Ticket-Detailseite (HTML, ein Ticket
    pro Datei, Überschrift + Feldtabellen).
  - *Releaseinfo* – Release-Notes-Text aus Confluence (.txt, Tab-getrennt),
    Tickets werden je Service-Abschnitt automatisch der dort genannten
    Domain zugeordnet und über den Schlüssel dedupliziert (mehrere
    Service-Zugehörigkeiten werden als Komponenten zusammengeführt).
  - *Andere Importe* – probiert alle drei Parser automatisch durch.
- **Dateiverwaltung** – Liste aller Imports dieser Sitzung sowie ein
  Vergleich von Tickets, die in mehreren Imports mit unterschiedlichem
  Status/Datum/Zusammenfassung vorkamen (Vorher/Nachher inkl. Quelle).
  Tickets werden über ihren Schlüssel zusammengeführt; bei einem
  Teil-Import (z. B. ein Releaseinfo-Nachtrag, der nur Schlüssel/Status/
  Domain enthält) bleiben im vorherigen Import vorhandene, im neuen
  Import aber fehlende Felder unverändert erhalten und werden **nicht**
  als Änderung gewertet – nur tatsächlich abweichende Werte erscheinen im
  Vergleich. Im Dashboard markiert ein Punkt hinter dem Schlüssel
  geänderte Tickets.
- **Verarbeitung** – sechs Jobs für wiederkehrende Arbeitsschritte rund
  um die geladenen Tickets (6 ist als Platzhalter angelegt, folgt
  später), erreichbar über die Tab-Leiste oder das kompakte
  Burger-Menü (☰) daneben. Jeder Job zeigt oben seine **Prozessschritte**
  als visuelle Checkliste (grauer Kreis = ausstehend, grüner Haken =
  erledigt, roter Kreis = Fehler bei der Ausführung) und lässt sich
  komplett als **XLSX, DOCX oder PDF exportieren**:
  1. *Jira Verarbeitung* – chronologisches Protokoll aller Import-/Export-Aktionen.
  2. *Vergleich Jira Tickets* – derselbe Änderungsvergleich wie in der
     Dateiverwaltung (gleiche Jira-Nummer, unterschiedlicher Datenstand),
     zusätzlich direkt hier verfügbar. Über den Button "Vergleich" öffnet
     sich pro geändertem Ticket ein Dialog, der den Original-Datensatz aus
     dem jeweiligen Import dem Zwischenschritt (Ergebnis nach
     Bereinigung/Merge, aktueller Stand) gegenüberstellt und Abweichungen
     hervorhebt.
  3. *Glossar & Abkürzungen extrahieren* – durchsucht alle geladenen
     Tickets nach Großbuchstaben-Kürzeln (mit Häufigkeit und
     Beispiel-Ticket) sowie nach häufigen Status-/Typ-/Domain-Werten als
     Glossar-Kandidaten. Es werden keine Bedeutungen erfunden, nur
     tatsächlich vorkommende Werte gelistet; Ergebnisse erscheinen
     zusätzlich in den neuen Registern **Glossar** (Abschnitt "Aus
     Ticket-Daten erkannte Begriffe") und **Abkürzungen**.
  4. *Releaseversion* – tabellarische Übersicht aller geladenen Tickets
     mit Domain, ein Abgleich gegen eine eigene Release-Ticketliste (ein
     Key pro Zeile, zeigt fehlende Tickets, Web-App-Pendant zu
     `match-release` aus dem CLI-Tool) sowie eine Bewertung, welche
     Tickets anhand des Jira-Feldes "Typ" als Benutzerhandbuch-Kandidat
     gelten und welche nur intern/Bug sind (fehlt der Typ im Export, wird
     das als "Unbekannt" ausgewiesen statt geraten).
  5. *Jira Liste* – alle importierten Jira-Nummern mit Status und Datum,
     inklusive prominent angezeigter Gesamtanzahl der importierten Tickets.
- **Releaseletter / Benutzerhandbuch / Clickanweisung** – Textentwürfe aus
  ausgewählten Tickets (aktuelle Dashboard-Filterung oder Ticket-Keys),
  Vorschau + Markdown-Download.
- **Prozessbild** – einfaches sequentielles Mermaid-Diagramm aus
  ausgewählten Tickets, live gerendert.
- **Bilder** – Galerie der in der Sitzung erzeugten Prozessdiagramme.
- **Output MD Tickets / Output PDF Tickets** – bereinigte Tickets als
  ZIP-Archiv aus Markdown- bzw. PDF-Dateien exportieren (respektiert die
  aktuelle Dashboard-Filterung); PDFs werden clientseitig mit jsPDF
  erzeugt.
- **Infobox / Glossar / Abkürzungen** – Kurzerklärung der App, Begriffsliste
  bzw. extrahierte Abkürzungen (siehe Verarbeitung → 3.).
- **Einstellungen** – Admin-Bereich mit Funktion "Alle Daten löschen": leert
  die komplette Sitzung (Tickets, Imports, Protokoll, Vergleiche,
  Extraktionen) unwiderruflich, mit Sicherheitsabfrage. Anders als "Sitzung
  zurücksetzen" im Import-Bereich werden dabei **nicht** wieder die
  eingebetteten Ausgangsdaten geladen, sondern alles auf 0 Tickets geleert.
- Word-Exporte (`.docx`) und Detail-HTML-Exports (ein Abschnitt pro
  Ticket statt einer Tabelle) werden von der Web-App **nicht**
  unterstützt – dafür das CLI-Tool verwenden.

**Mit aktuellen Daten neu bauen** (bettet `data/tickets.json` ein):

```bash
jira-releaseletter build-webapp
```

Erzeugt `webapp/ticket_cockpit.build.html`. Lokal im Browser geöffnet
funktionieren Ansicht/Suche/Filter; der Datei-Download (ZIP/Markdown)
benötigt die Claude-Artifact-Laufzeit (`window.claude`-API) und
funktioniert nur, wenn die Datei über Claude als Artifact veröffentlicht
wurde – lokal geöffnet zeigt der Button eine entsprechende Meldung.

## Unterstützte Exportformate (Phase 1)

- **XML** (`.xml`): klassischer Jira-Export ("Issue-Navigator > XML
  exportieren"). Robust, da Jira hier ein festes Schema verwendet.
- **HTML** (`.html`/`.htm`): Jira-HTML-Export. Ticket-Grenzen werden
  über den Link auf `/browse/<KEY>` erkannt, Felder über Label/Wert-
  Tabellenzeilen (Deutsch/Englisch, siehe `field_aliases.py`).
- **DOCX** (`.docx`): Word-Dokument, das Tickets im Ablauf enthält.
  Ticket-Grenzen werden über Absätze erkannt, die mit einem Jira-Key
  beginnen (`PROJ-123 ...`).

HTML- und DOCX-Export haben **kein festes Schema** – die Parser sind
Best-Effort-Heuristiken (siehe Docstrings in `parser_html.py` /
`parser_docx.py`). Weicht ein echter Export davon ab (andere
Feldbezeichnungen, andere Struktur), zuerst mit `tests/fixtures/` als
Vorlage die Erkennung anpassen bzw. `field_aliases.py` um fehlende
Label-Varianten ergänzen.

## Tests

```bash
pip install -e ".[dev]" 2>/dev/null || pip install pytest
PYTHONPATH=src python3 -m pytest tests/ -v
```

Die Tests laufen gegen synthetische Beispiel-Exporte in
`tests/fixtures/` (XML/HTML/DOCX mit Testdaten inkl. Namen/E-Mails) und
prüfen den kompletten Weg von Parsing bis Dokumenterzeugung.

## Bei 1000 Tickets

`import` verarbeitet die gesamte Exportdatei in einem Lauf und gibt
alle 100 Tickets eine Fortschrittsmeldung aus. Für sehr große
Exportdateien (z. B. > 50 MB HTML/DOCX) kann der Speicherbedarf
steigen, da der jeweilige Parser das Dokument komplett einliest.
