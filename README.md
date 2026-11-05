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

**Hauptziel:** die in importierten Jira-Tickets enthaltenen Texte
(Zusammenfassung, Beschreibung) analysieren und nutzbar machen. Dazu lassen
sich die geladenen Tickets nach Domäne, Status und Zeitraum filtern und die
gefilterten Texte extrahieren (Verarbeitung → 7. RAG) – als reine Rohdaten
oder als daraus generierter, endnutzergerechter Fließtext. Auf dieser
Grundlage entstehen aus denselben Tickets die vier Dokument-Generatoren
(Releaseletter, Benutzerhandbuch, Prozessbild, Clickanweisung).

`webapp/ticket_cockpit.html` ist eine eigenständige Single-Page-App (kein
Server, kein Build-Schritt) mit ausklappbarer Navigationsleiste und
folgenden Bereichen. Die Überschrift zeigt neben dem App-Namen ein
Versions-Badge (`APP_VERSION` in der `<script>`, aktuell "v2.169.0"), das bei
jeder für Nutzer sichtbaren Funktionserweiterung erhöht wird, damit sich
auf einen Blick erkennen lässt, ob eine aktuelle Version geöffnet ist.
Alle Löschbestätigungen (Einstellungen, Dateiverwaltung, Bilder) laufen
über ein selbst gebautes Bestätigungs-Dialogfeld statt über
`window.confirm()` – manche eingebetteten Browser-Umgebungen (z. B. ein
sandboxed `<iframe>`, wie beim Ausführen als Claude-Artifact) unterdrücken
native Dialoge stillschweigend, wodurch ein Klick auf "Löschen" sonst
wirkungslos bleiben kann.

**Bereinigung personen-/fahrzeugbezogener Daten:** Zusätzlich zur
Pseudonymisierung von Bearbeiter/Ersteller und der Entfernung von
Kommentaren/Beobachtern/E-Mail-Adressen (siehe Phase 1 oben, in der
Web-App als eigene JS-Portierung) erkennt und entfernt die Web-App aus
Freitext (Zusammenfassung, Beschreibung, Custom-Fields) musterbasiert:
Telefonnummern (mit Vorwahl), Adressen (Straße + Hausnummer, PLZ + Ort),
Fahrgestellnummern/VIN (17-stellig, ISO 3779) und deutsche
KFZ-Kennzeichen – relevant, da oneSCM ein Fuhrpark-/Vertragsmanagement-
System ist und Ticket-Freitext entsprechende Daten enthalten kann. Wie
bei der Namenserkennung gilt: musterbasiert und Best-Effort, keine
Garantie auf lückenlose Erkennung bei untypischer Schreibweise oder
anderen Länderformaten (Kennzeichen).

**Performance (Pro-Ticket-Cache):** `refreshDashboard()` – der zentrale
Rebuild-Schritt hinter Dashboard, Verarbeitung, RAG, Benutzerhandbuch und
Gliederung – lief bisher bei **jeder** Einstellungsänderung (Label
hinzufügen, Gliederungs-/Importformat-Spalte ändern – über 25
Aufrufstellen im Code) die komplette automatische Label-/Gliederungs-/
Datenprofil-Zuordnung für **alle** geladenen Tickets neu durch. Gemessen
bei 663 Demo-Tickets und ~230 Label-Begriffen: **~2 Sekunden pro Klick**,
spürbar u. a. beim Wechseln zwischen Verarbeitung/Benutzerhandbuch/RAG,
weil deren Filter-Dropdowns dieselbe Ticketliste referenzieren. Zusätzlich
rief die alte Fassung die Label-Suche pro Ticket **zweimal** auf (für
Labels und Label-Kategorien getrennt).

Fix: ein Cache je Ticket (`ticketDerivedCache`), der die teuren Ergebnisse
nur dann neu berechnet, wenn sich entweder der **Ticket-Inhalt** selbst
(Zusammenfassung/Beschreibung/Domäne/Typ) oder die jeweils **relevante
Konfiguration** (Labels/Gliederung/Importformat, je über eine eigene,
billige Prüfsumme erkannt) seit der letzten Berechnung geändert hat.
Ändert sich z. B. nur eine Importformat-Spalte, bleiben die (teuren)
Label-/Gliederungs-Ergebnisse aus dem Cache erhalten – nur das (billige)
Datenprofil wird neu berechnet. Gemessene Wirkung: der ohnehin
unvermeidbare erste Durchlauf nach einer echten Label-/Gliederungs-
Änderung sinkt leicht (durch den Wegfall der doppelten Label-Suche); jeder
**weitere** `refreshDashboard()`-Aufruf, der Labels/Gliederung nicht
berührt (die deutliche Mehrheit realer Interaktionen – Importformat-
Toggles, Kapitel-Generator-/RAG-/Gliederung-Filterwechsel, Punkte-System-
Änderungen), fällt von ~1,6–2 Sekunden auf **unter 1 Millisekunde**
(Cache-Treffer). Der Cache wird bei "Sitzung zurücksetzen"/"Alle Daten
löschen" geleert; inhaltlich geänderte Tickets (erneuter Import) werden
über die Inhalts-Prüfsumme automatisch erkannt und gezielt neu berechnet.

**Performance (Batch-Parallelisierung im Kapitel-Generator):** Bei sehr
vielen Tickets je Kapitel/Label-Themengebiet teilt der Benutzerhandbuch-
Kapitel-Generator die Texte (wie das RAG-Modul) über `chunkRagRows()` in
mehrere zeichen-budgetierte Teil-Batches und lässt daraus einen
Zusammenfassungstext erzeugen. Diese Teil-Batches sind unabhängig
voneinander (jeder bekommt eine eigene Ticket-Teilmenge) und werden daher
**parallel statt nacheinander** an Claude geschickt – bei z. B. 3
Teil-Batches etwa um den Faktor 3 kürzere Wartezeit für diesen Schritt, da
die Antwortzeit des KI-Aufrufs dominiert, nicht lokale Rechenarbeit. Die
Reihenfolge der Teiltexte in den Zusammenführungs-Aufrufen (s. u.) bleibt
dabei unabhängig von der tatsächlichen Fertigstellungsreihenfolge korrekt
erhalten. Höchstens **3 Teil-Batches gleichzeitig** (statt unbegrenzt viele
auf einmal) – bei Kapiteln mit sehr vielen Tickets (z. B. 100+, entsprechend
vielen Teil-Batches) führte eine unbegrenzte Parallelität dazu, dass die
Claude-Artifact-Laufzeit einzelne gleichzeitige Aufrufe mit "zu viele
Anfragen" ablehnte, statt sie zu bearbeiten; die Obergrenze behält den
Großteil des Geschwindigkeitsgewinns, ohne denselben Fehlschlag zu
riskieren. Zusätzlich wird genau dieser Fehler (aber kein anderer) bis zu
zweimal mit wachsender Wartezeit automatisch wiederholt, bevor er als
echter Fehler gemeldet wird – ein einzelner vorübergehender Ausreißer lässt
also nicht gleich das ganze Kapitel scheitern. **Bewusst nicht verändert:**
der Batch-Lauf im RAG-Modul (Verarbeitung → 7. RAG) bleibt sequenziell,
weil er als fortsetzbarer Lauf mit Live-Streaming-Vorschau und
batch-genauem Stop/Resume gebaut ist (`ragBatchRun.index`) – das setzt
echte Sequenzialität voraus und müsste für eine Parallelisierung erst
grundlegend umgebaut werden.

**Bugfix (mehrstufige Zusammenführung bei sehr vielen Teil-Batches):** Die
Ticket-Rohdaten werden zwar bereits über `chunkRagRows()` in
zeichen-budgetierte Teil-Batches aufgeteilt (s. o.), der anschließende
Zusammenführungs-Schritt fasste bisher aber IMMER alle daraus entstandenen
Teiltexte in einem einzigen Aufruf zusammen – bei einem häufig verwendeten
Kapitel mit hunderten Tickets (entsprechend vielen Teiltexten) konnte
dieser Zusammenführungs-Aufruf selbst wieder zu groß werden und mit
"Zu viele Rohdaten für einen Durchlauf" fehlschlagen, obwohl die
Aufteilung der Rohdaten selbst korrekt funktionierte. `manualSynthesizePartials()`
verdichtet die Teiltexte jetzt bei Bedarf in mehreren
Zusammenführungs-**Runden** (ebenfalls zeichen-budgetiert, mit derselben
Nebenläufigkeitsgrenze von 3 gleichzeitigen Aufrufen je Runde), bis sie
zusammen in einen einzelnen finalen Aufruf passen – ein Kapitel mit 150
Tickets braucht dadurch z. B. 2 statt 1 Zusammenführungsrunden, scheitert
aber nicht mehr am Limit. Performance-Messung (simulierte Antwortzeit):
150 Tickets ≈ 19 Claude-Aufrufe gesamt, 400 Tickets ≈ 46 – lineares, nicht
explodierendes Wachstum.

**Bugfix 2 (adaptive Bisektion gegen denselben Fehler bereits bei der
Rohdaten-Erzeugung):** Die Zusammenführungs-Absicherung oben (Bugfix 1) hat
den Fehler bei genau dieser Stelle behoben, er trat in der Praxis aber auch
bereits BEIM ERZEUGEN der einzelnen Roh-Batches selbst wieder auf – obwohl
`chunkRagRows()` die reinen Ticket-Rohdaten korrekt auf
`RAG_BATCH_CHAR_BUDGET` begrenzt, zählt der tatsächlich an Claude gesendete
Prompt zusätzlich Anweisungstext und Rollenhinweis dazu, und ein einzelnes
ungewöhnlich langes Ticket bildet laut Kommentar in `chunkRagRows()` ohnehin
einen bewusst UNGEDECKELTEN eigenen Batch. `manualGenerateBatchAdaptive()`
fängt `prompt_too_large` jetzt auch an dieser Stelle ab und bisektiert die
betroffenen Tickets rekursiv (Hälfte/Hälfte), bis einzelne Tickets übrig
bleiben; ist selbst ein einzelnes Ticket noch zu groß, wird dessen
Beschreibung gekürzt (mit sichtbarem `[…Text gekürzt]`-Hinweis) und einmal
erneut versucht; scheitert auch das (seltener Randfall), wird genau dieses
eine Ticket ehrlich als `[OFFEN: Ticket <Key> konnte … nicht automatisch
verarbeitet werden.]` markiert, statt den gesamten Kapitel-Lauf abzubrechen.
Dieselbe reaktive Bisektion sichert zusätzlich jeden einzelnen
Zusammenführungs-Aufruf aus Bugfix 1 ab (`manualSynthesizeGroup()`), falls
die vorausschauende Zeichen-Budget-Schätzung dort im Einzelfall doch nicht
ausreicht – beide Mechanismen zusammen verlassen sich damit nicht mehr auf
einen geschätzten, sondern reagieren direkt auf die tatsächliche
Prompt-Größengrenze der Claude-Artifact-Laufzeit.

**Bugfix 3 (garantierter Fortschritt der Zusammenführungs-Runden bei sehr
vielen Tickets):** Bei einem Kapitel mit sehr vielen Tickets (hunderte bis
tausende) konnte die Statuszeile dauerhaft bei "Verdichte X Teiltexte in Y
Zwischenschritte (Zusammenführungsrunde 1) …" hängen bleiben, ohne dass das
Kapitel je fertig wurde. Ursache: `chunkTextsByBudget()` packte einen
Teiltext, der bereits für sich allein das Zusammenführungs-Budget sprengt,
IMMER in eine eigene Einzel-Gruppe, die nie mit einem Nachbarn kombiniert
wurde. Bei vielen solcher Texte reduzierte eine Verdichtungsrunde die Anzahl
kaum, bis `manualSynthesizePartials()` nach einer Runde ganz ohne Reduktion
komplett abbrach und auf den rein SEQUENZIELLEN (nicht parallelisierten)
rekursiven Bisektions-Fallback in `manualSynthesizeGroup()` auswich – bei
hunderten Texten praktisch eine Hängepartie. Behoben durch zwei Änderungen:
(1) `chunkTextsByBudget()` fasst direkt benachbarte "zu groß für sich
allein"-Einzel-Gruppen jetzt zusätzlich paarweise zusammen (das Budget wird
dabei bewusst überschritten – `manualSynthesizeGroup()` bisektiert eine zu
große Gruppe ohnehin reaktiv zurück), was jede Runde mindestens eine
spürbare Reduktion statt Stillstand garantiert; (2) `manualSynthesizeGroup()`
verarbeitet seine beiden Bisektions-Hälften jetzt nebenläufig (`Promise.all`)
statt nacheinander. Zusätzlich zeigt die Ordnerauswahl ("Zielordner wählen")
jetzt eine klarere Fehlermeldung, wenn der Browser sie innerhalb der
eingebetteten Claude-Artifact-Vorschau per Sandbox-Regel blockiert (reine
Browser-Beschränkung, nicht umgehbar – App direkt in Chrome/Edge öffnen statt
in der Vorschau).

**Wartbarkeit (vereinheitlichter Ticket-Index):** RAG (Verarbeitung → 7.
RAG), der Benutzerhandbuch-Kapitel-Generator und Gliederung filterten
Tickets bislang über drei fast identische, unabhängig gepflegte
Kopien derselben Domäne/Label-Themengebiet/Gliederungskapitel-Prüfungen.
Diese Prüfungen sind jetzt in gemeinsamen, reinen Prädikat-Funktionen
(`queryTickets()` + `ticketMatches*()`) gebündelt, die alle drei Stellen
intern nutzen – nach außen unverändertes Verhalten (identische Ergebnisse,
gleiche Funktionssignaturen), nur ohne die dreifache Kopie derselben Logik.
Der Releaseletter/Benutzerhandbuch/Clickanweisung-Rohgerüst-Generator
(`resolveGeneratorTickets()`) bleibt bewusst außen vor: er arbeitet auf
rohen statt normalisierten Ticket-Daten und umgeht die Datei-/Listen-
Sichteinschränkung bewusst zugunsten der aktuellen Dashboard-Filterung
bzw. einer expliziten Ticket-Schlüssel-Liste – eine erzwungene
Vereinheitlichung hätte hier nur Komplexität hinzugefügt, ohne echte
Duplikation zu entfernen.

**RAG-Bibliothek (Verarbeitung → 7. RAG, Punkte 3-5, nach der eigentlichen
Text-Generierung):** ein erzeugter Text (Zusammenfassung/Fließtext) lässt
sich bewusst per Klick in eine interne, **sitzungsübergreifend gesicherte**
Bibliothek übernehmen – anders als der eigentliche RAG-Ausgabebereich
(automatisch erzeugter Zwischenstand, bewusst NICHT Teil von "Sitzung
speichern/laden") wird ein so übernommenes Ergebnis über `app.ragLibrary`/
`app.ragMergedDoc` mit exportiert/wiederhergestellt, genau wie die
Benutzerhandbuch-Kapitel. Alternativ lässt sich eine zuvor heruntergeladene
Markdown-Datei oder ein Batch-ZIP-Archiv (mehrere `.md`-Dateien auf einmal)
wieder einladen – importierter Freitext wird wie überall in der App durch
`redactText()` geleitet. Jeder Bibliothekseintrag bekommt eine editierbare
Domäne-/Kapitel-Zuordnung (Dropdown, volle Gliederung zur Auswahl, unabhängig
von der ursprünglichen RAG-Auswahl); bei der Übernahme aus einer laufenden
Generierung wird sie vorbelegt, falls zum Zeitpunkt des Speicherns genau
eine Domäne bzw. ein Kapitel in der RAG-Auswahl gewählt war. Bei importierten
Dateien übernimmt dieselbe wortbasierte Titel-Ähnlichkeit wie bei der
Referenz-Handbuch-Kapitel-Zuordnung (`chapterTitleSimilarity`/
`CHAPTER_MATCH_THRESHOLD`, Jaccard über normalisierte Wörter) die Vorbelegung
– angewandt auf Dateiname und erste Überschriftzeile (`# ...`) der Datei
gegen die tatsächlich vorkommenden Domänen bzw. die volle Gliederung; nur ab
ausreichender Ähnlichkeit wird vorbelegt, sonst bewusst leer gelassen
("ehrlich anzeigen statt raten") statt einen unsicheren Treffer
vorzutäuschen – in jedem Fall bleibt die Zuordnung manuell überschreibbar.
"Alle
zusammenführen" fasst schließlich sämtliche Bibliothekseinträge zu einem
Gesamtdokument zusammen – sortiert nach Domäne, darunter nach Kapitel
("Ohne Domäne"/"Nicht zugeordnet" am Ende), damit unvollständige Zuordnungen
sofort auffallen statt Textschnipsel unsortiert aneinanderzureihen. Der
zusammengeführte Text ist direkt editierbar und lässt sich als eigene
Markdown-Datei herunterladen. Ziel: Ergebnisse aus vielen einzelnen
RAG-Durchläufen (z. B. je Domäne/Kapitel separat generiert, um Vermischung
zu vermeiden) am Ende sauber geordnet in einem Dokument zusammenführen,
statt jeden Durchlauf einzeln zu verwalten. Zusätzlich lässt sich die
gesamte Bibliothek unverändert als ZIP-Archiv herunterladen (eine
`.md`-Datei je Eintrag, mit Domäne/Kapitel/Quelle/Datum als Metadaten-Kopf,
fortlaufend nummeriert) – für externe Weiterverarbeitung oder Weitergabe,
ohne die einzelnen Textschnipsel erst zu einem Gesamtdokument
zusammenzuführen.

**RAG: Automatische Chunk-Erzeugung + RAG-Analyse (Verarbeitung → 7. RAG,
Punkte 6-7, neu, v2.103.0):** Punkt 6 füllt die RAG-Bibliothek
(Punkte 3-5, s. o.) auf Knopfdruck automatisiert mit Textschnipseln ("Chunks")
aus ALLEN bereits an anderer Stelle der App vorhandenen Quellen je
Gliederungskapitel – ein Chunk je Quelle/Kapitel-Kombination (heuristisches
Chunking, keine Vektoreinbettung): zugeordnete Jira-Tickets
(`manualRowsForChapter`/`manualTicketBlock`, wie im Benutzerhandbuch-
Kapitel-Generator), zugeordnete Rovo-Wissens-Notizen, zugeordnete Tabellen
(Register Tabelle), Bildbeschreibungen zugeordneter Screenshots (Register
Bilder/Editor) sowie bereits erzeugter Benutzerhandbuch-Kapiteltext. Domäne/
Kapitel sind bei diesen Chunks bereits aus der Quelle vorbelegt, bleiben aber
wie jeder Bibliothekseintrag manuell überschreibbar. Ein erneuter Lauf ist
idempotent: er entfernt zunächst nur die zuvor automatisch erzeugten Chunks
(eigene Kennzeichnung "Automatisch" in der Quelle-Spalte, getrennt von
"Generiert"/"Importiert") und baut sie neu auf – manuell gespeicherte oder
importierte Einträge bleiben davon unberührt. Punkt 7 erstellt anschließend
EINEN einzelnen, Claude-basierten Gesamtbericht über den **kompletten
aktuellen Chunk-Bestand** der Bibliothek (bewusst nicht je Kapitel und nicht
in die EDITO-Agenten integriert) mit vier Abschnitten: Zusammenhänge zwischen
den Chunks (auch über Kapitel-/Domänengrenzen hinweg), Genauigkeit
(vage/widersprüchliche Angaben), Priorität (was vorrangig für Benutzerhandbuch/
EDITO, Releaseletter oder Clickanweisung aufbereitet werden sollte) und
Klärungsbedarf (offene Fachfragen) – Ergebnis samt Erstellungsdatum und
Chunk-Anzahl sitzungsübergreifend gesichert (`app.ragAnalysis`), Prompt unter
Einstellungen → RAG-Prompts editierbar ("RAG-Analyse: Gesamtbericht über den
Chunk-Bestand"). **RAG-Anbindung für Releaseletter/Clickanweisung** (neu,
v2.105.0): Releaseletter und Clickanweisung selbst bleiben bewusst
vollständig deterministisch (direkt aus den Ticket-Rohdaten erzeugt,
`renderMarkdown()`, ohne eigenen KI-Prompt-Schritt im Entwurf selbst – eine
RAG-Anbindung DORT wäre kein kleiner Zusatz, sondern ein grundlegender
Umbau des Erzeugungswegs). Stattdessen gibt es bei beiden Generatoren einen
zusätzlichen, rein optionalen Button "Mit RAG-Kontext anreichern (KI)": EIN
Claude-Call nimmt den bereits fertigen, deterministischen Entwurf sowie die
dazu passenden Textschnipsel aus der RAG-Bibliothek (nach den
Gliederungskapiteln der im Entwurf enthaltenen Tickets zugeordnet, inkl. der
automatisch erzeugten Chunks aus Punkt 6) und erzeugt eine ZUSÄTZLICHE,
separat angezeigte, inhaltlich angereicherte Fassung darunter (ergänzt
Hintergrundinfos bzw. zusätzliche Klickschritte, ohne vorhandene Aussagen zu
entfernen oder zu widersprechen) – der deterministische Original-Entwurf
bleibt unverändert der Haupt-Export für Markdown/DOCX/PDF/XLSX. Bei
Releaseletter gilt dieselbe Negativlisten-Hervorhebung wie beim Original-
Entwurf (live aktualisiert); bei Clickanweisung bewusst nicht (wie beim
Original-Entwurf dort ebenfalls ausgenommen, da es um Klickschritte statt
Fließtext geht). Reiner Sitzungs-Anzeigezustand (wie Agent 3-5 bei EDITO),
wird bei erneutem "Entwurf generieren" zurückgesetzt und ist NICHT Teil von
"Sitzung speichern". Prompts unter Einstellungen → RAG-Prompts editierbar
("Releaseletter: Mit RAG-Kontext anreichern" / "Clickanweisung: Mit
RAG-Kontext anreichern").

- **Dashboard** – zusammengeführter, aktueller Stand aller importierten
  Tickets: Status-Kacheln, ein **Typ-Schnellfilter** (Chips je Tickettyp,
  z. B. Epic/Story/Feature/Bug – rein aus den tatsächlich geladenen
  Tickets abgeleitet, keine feste Liste, erscheint daher nur wenn Typen
  vorhanden sind) sowie 4 feste Preset-Buttons **"Ohne Bugs"**, **"Nur
  Epics"**, **"Ohne Reporting"**, **"Ohne Testing"** (die drei
  "Ohne ..."-Presets sind frei untereinander UND mit einem Typ-Chip
  kombinierbar, "Nur Epics" teilt sich denselben Einzel-Typ-Filter wie
  die "Epic"-Chip), Domain-Verteilung, ein **Labels-Filter** (nur
  tatsächlich vorkommende, automatisch zugeordnete Labels zur Auswahl,
  siehe Einstellungen → Labels), eine um Labels **erweiterte
  Volltextsuche** (durchsucht Schlüssel, Zusammenfassung und Labels),
  sortierbare Tabelle mit **Beschreibung direkt rechts vom Schlüssel**
  (optisch gekürzt mit "…", voller Text als Hover-Tooltip) sowie Spalte
  **Typ** (Jira-Feld "Typ" – Epic, Story, Feature, Bug, ...; fehlt der Typ
  im Export wirklich, wird das ehrlich als "–" ausgewiesen statt geraten –
  die Erkennung selbst wurde robuster gemacht, siehe unten) mit einem
  **Icon** je erkanntem Importformat (🎯 Epic, ✨ Feature, 🐞 Bug, 🚨
  Incident, 🔄 Change Request; nicht zuordenbare Typen wie "Story"/
  "Reporting" bekommen ein neutrales ▪, s. Einstellungen → Importformat)
  sowie eine neue Spalte **Datenprofil** direkt nach Status: ein 0-100%-
  Balken, der anzeigt, wie viele der für den erkannten Vorgangstyp
  erwarteten (aktiven) Spalten am jeweiligen Ticket tatsächlich befüllt
  sind – "–" wenn der Typ keinem der 5 Importformate zugeordnet werden
  konnte oder für den Typ noch keine Spaltenliste hinterlegt ist. Direkt
  daneben die Spalte **Klassifizierung** (Dropdown je Zeile, genehmigt/in
  Prüfung/intern/Background): ein automatischer Vorschlag aus den
  Jira-Labels "Intern"/"Background"/"Hintergrund"/"Recherche" (wörtlich,
  wie beim Sparte-/Rollen-Filter) bzw. ersatzweise aus dem Status
  (erledigte Tickets gelten als inhaltlich abgeschlossen → "genehmigt"),
  manuell überschreibbar – sowohl hier als auch im Ticket-Detail (s. u.).
  "Genehmigt"/"In Prüfung" dürfen in Benutzerhandbuch-Kapitel-Generator,
  Releaseletter und RAG/Chat einfließen, "Intern" ist dort komplett
  ausgeschlossen (dient nur internen Zwecken), "Background" ebenfalls
  ausgeschlossen, liefert aber zusätzliches Wissen für "Grill me" (s. u.),
  um Lücken im Haupt-Kontext zu erkennen. Übersteuerungen sind an die
  Jira-Nummer gebunden (Konfiguration, kein Sitzungsdatensatz) – bleiben
  daher auch bei "Sitzung zurücksetzen"/"Alle Daten löschen" erhalten,
  werden über Sitzung speichern/laden mit exportiert. Erstellt-/
  Aktualisiert-Spalten **ohne Uhrzeit** (nur das Datum, z. B. "20/Dez/24"
  statt "20/Dez/24 4:41 PM" – sortiert wird weiterhin nach dem vollen
  Zeitstempel, nur die Anzeige ist gekürzt), Ticket-Detailansicht (18
  Standardfelder, fehlende klar als "Nicht im Export enthalten" markiert
  statt erfunden, plus dieselbe Klassifizierungs-Auswahl wie in der
  Tabellenspalte oben an erster Stelle). Jede Zeile hat zusätzlich eine **Checkbox** ("Alle
  sichtbaren auswählen" im Tabellenkopf) – die Auswahl bleibt beim Ändern
  eines Filters erhalten und lässt sich gezielt exportieren: entweder
  **nur die Jira-Nummern** (.txt, eine je Zeile) oder der **Gesamtinhalt**
  (.xlsx, dieselben Spalten wie die Job-Exporte in Verarbeitung). Die
  Suche ist leicht entprellt (150ms), damit bei 600+ geladenen Tickets
  nicht bei jedem einzelnen Tastendruck die komplette Tabelle neu
  aufgebaut wird; Klicks auf eine Zeile (außerhalb der Checkbox) öffnen
  die Detailansicht über einen einzigen, an die Tabelle delegierten
  Klick-Handler statt vieler einzelner Handler pro Zeile.
  Robustere **Typ-Erkennung** beim Import: In Releaseinfo-Tabellen
  (.txt/.docx/.pdf) wird eine Spalte "Typ"/"Type"/"Vorgangstyp" jetzt als
  Jira-Feld "Typ" erkannt statt nur als Zusatzfeld abgelegt zu werden
  (ebenso "Beschreibung"/"Description"); in Jira-HTML-Exporten, die den
  Typ nur als Icon ohne sichtbaren Text zeigen, wird ersatzweise das
  alt-/title-Attribut des Icons gelesen. Beides betraf zuvor Fälle, in
  denen die Typ-Spalte trotz vorhandenem Typ im Original-Export leer
  blieb.
  Neuer Bereich **"Jira Zuordnung"**: gruppiert ALLE geladenen Tickets
  (unabhängig von der obigen Such-/Typ-Filterung) wahlweise **"Nach
  Label-Kategorie"** (nach Themengebiet, siehe Einstellungen → Labels) oder
  **"Nach Gliederung"** (nach Kapitel des Benutzerhandbuchs, siehe
  Einstellungen → Benutzerhandbuch-Gliederung) – Tickets ohne Treffer
  landen ehrlich in einer Gruppe "Ohne Zuordnung" statt irgendwo
  hineingeraten zu werden; ein Ticket kann mehrere Gruppen treffen und
  erscheint dann mehrfach (wie schon die Labels-Spalte selbst mehrwertig
  ist). Die automatischen Status-/Typ-/Domäne-/Anlagemonat-Labels (s.
  Einstellungen → Labels) zählen hier bewusst nicht als Themengebiet, da
  sie auf praktisch jedem Ticket vorhanden sind.
- **Ticket Graph** (neu, direkt unter Dashboard) – Wissensgraph der
  Abhängigkeiten zwischen Tickets (Jira "Issue Links": Vorgänger,
  Nachfolger, Testtickets, sonstige Verknüpfungen wie "relates to", sowie
  Subtasks als eigene Kategorie).
  **Wichtige Einschränkung:** strukturierte Abhängigkeiten sind nur aus
  **Jira-XML-Exports** verfügbar – HTML-Tabellenexporte (Issue-Navigator)
  und Einzelticket-Detailseiten liefern diese Information in Jira nicht
  strukturiert mit (eine reine Text-Referenz in einer "Verknüpfte
  Vorgänge"-Spalte landet dort stattdessen als Zusatzfeld), daher bleiben
  ihre Tickets im Graph ohne Kanten. Die Zuordnung eines Jira-Linktyps
  (das Verb steht im XML-Attribut `description`, an einem realen Export
  bestätigt – z. B. "is blocked by") zu Vorgänger/Nachfolger/Testticket
  ist ein **Vorschlag anhand gängiger deutscher/englischer
  Formulierungen** (Jira kennt "Vorgänger"/"Nachfolger" nicht als festen
  Standard-Linktyp – das sind meist projektspezifisch angelegte Typen);
  nicht erkannte Linktexte landen ehrlich als "Verknüpft" statt geraten
  einer der Kategorien zugeschlagen zu werden. Jeder Knoten zeigt
  Ticket-Schlüssel, Domäne (Farbe am linken Rand) und Status (Ampel-Punkt
  oben rechts: rot/gelb/grün) – beide Farbschemata sind unter
  Einstellungen editierbar (siehe dort). Layout: ein Schichten-Layout
  (Vorgänger links, Nachfolger rechts, entlang des längsten
  Abhängigkeitspfads) statt einer generischen Kraft-Simulation – bei
  einem Zirkelbezug (A Vorgänger von B, B Vorgänger von A) wird die
  Schicht-Berechnung an der Stelle sauber gekappt statt in eine
  Endlosschleife zu laufen, der Graph bleibt immer darstellbar.
  Filter nach Domäne/Status/**Typ** (je Mehrfachauswahl, mit "Alle
  auswählen"/"Auswahl aufheben"-Buttons, mehrere Filter gleichzeitig
  kombinierbar) sowie ein Suchfeld (Ticket-Nummer oder Text in
  Zusammenfassung/Beschreibung) und ein Umschalter "Nur Tickets mit
  Abhängigkeiten anzeigen" (Standard an); verlinkte Nachbar-Tickets
  bleiben auch dann sichtbar, wenn sie selbst nicht zum Filter passen
  (sonst würden Kanten "ins Leere" führen). Ist ein verlinktes Ticket gar
  nicht im aktuellen Bestand vorhanden (andere/nicht geladene Datei), wird
  dafür ein grauer, gestrichelter Platzhalter-Knoten ("nicht geladen")
  gezeigt statt die Abhängigkeit stillschweigend zu unterschlagen – ein
  Klick darauf zeigt in der Tabelle darunter einen entsprechenden Hinweis
  statt Status/Domäne/Beschreibung, die für ein nicht geladenes Ticket
  naturgemäß nicht bekannt sind. Beim **Überfahren eines Knotens mit der
  Maus** zeigt ein Tooltip zusätzliche Inhalte (volle Zusammenfassung,
  Beschreibungs-Ausschnitt, Status/Domäne/Typ, alle Verknüpfungen), die im
  kompakten Knoten selbst keinen Platz haben. Ein Klick auf einen
  (geladenen) Knoten zeigt zusätzlich darunter eine Tabelle mit
  Ticket-Nummer, Status, Domäne, Beschreibung und allen Verknüpfungen
  dieses Tickets. Der Graph lässt sich über **"Als Bild exportieren
  (PNG)"** als Rastergrafik herunterladen (client-seitig aus dem SVG über
  ein Canvas gerendert, benötigt wie die übrigen Downloads die
  Claude-Artifact-Laufzeit). **Mehrfachauswahl** (Strg/Cmd-Klick auf
  mehrere Knoten, eigene gestrichelte grüne Markierung – unabhängig von
  der Einzelauswahl für die Detail-Tabelle darunter) lässt sich direkt
  über "Auswahl als Liste speichern" als neue, benannte Liste unter
  Listenauswahl sichern, ohne vorher irgendwo anders auswählen zu müssen.
  **Zoom/Pan**: Buttons zum Vergrößern/Verkleinern/Zurücksetzen sowie
  Strg/Cmd + Mausrad zum Zoomen direkt über dem Graphen; verschoben
  (Pan) wird über die ohnehin vorhandenen Bildlaufleisten des
  Graph-Bereichs (normales Scrollen bleibt dafür bewusst unverändert,
  ohne Strg/Cmd nutzbar). **EPICs** erhalten einen fetten (dickeren,
  dunkleren) Rahmen zur besseren Unterscheidung. Ist das Jira-Feld "Epic
  Link" (XML-Custom-Field-Typ "...gh-epic-link" bzw. die gleichnamige
  Spalte in HTML-Tabellenexporten) auf einem Ticket gesetzt, zeichnet der
  Graph zusätzlich eine eigene Kantenart **"Epic-Verknüpfung"** vom Epic
  zum jeweiligen Kind-Ticket (Pfeilrichtung: Epic → Kind, unabhängig
  davon, dass der Feldwert technisch auf dem Kind-Ticket steht) – auch in
  der Auswahltabelle darunter sichtbar. Jeder Knoten hat außerdem einen
  neuen **"i"-Knopf** (rechte untere Ecke): zeigt die Beschreibung sowie
  weitere Details in einem angepinnten Panel, das – anders als der
  flüchtige Hover-Tooltip – bis zum erneuten Klick sichtbar bleibt und
  auch beim Hovern über andere Knoten nicht verschwindet. Reines, selbst
  erzeugtes SVG (keine externe Graph-Bibliothek).
  **5 wählbare Darstellungen** (Reiter oberhalb der Filter, dieselben
  Filter/dieselbe Auswahl gelten in jeder Ansicht):
  - *Schichten* (Standard) – wie oben beschrieben.
  - *Baum (Epic)* – EPICs als Wurzelknoten, ihre Kind-Tickets (Feld "Epic
    Link") darunter angeordnet; Tickets ohne Epic-Bezug erscheinen als
    eigene Wurzeln. Nutzt denselben Schichten-Layout-Algorithmus wie
    "Schichten", nur mit der Epic-Verknüpfung statt Vorgänger/Nachfolger
    als Tiefen-Kriterium.
  - *Netzwerk* – freies, selbst implementiertes Kräftelayout
    (Fruchterman-Reingold-artig: Abstoßung zwischen allen Knotenpaaren,
    Anziehung entlang der Kanten, abkühlende Schrittweite) statt fester
    Spalten – verwandte Tickets rücken zusammen, unverbundene driften
    auseinander. Deterministisch (Startpositionen im Kreis, kein Zufall) –
    derselbe Datenstand ergibt immer dasselbe Layout. Bei sehr vielen
    Knoten wird die Iterationszahl automatisch reduziert, um die Ansicht
    responsiv zu halten.
  - *Matrix* – kein Diagramm, sondern ein Raster (Zeile = Ausgangs-,
    Spalte = Zielticket einer Verknüpfung, Zelle eingefärbt nach
    Verknüpfungsart) – kompakter Gesamtüberblick bei vielen Tickets, ohne
    dass sich Linien optisch überschneiden können. Zoom/Pan sind hier
    ohne Wirkung (kein SVG), stattdessen normales Tabellen-Scrollen mit
    fixierten Zeilen-/Spaltenköpfen.
  - *Zeitleiste* – Tickets nach Erstellungsdatum (links = früher)
    angeordnet, je Domäne eine eigene Zeile; Tickets ohne verwertbares
    Datum stehen in einer eigenen Spalte ganz rechts statt geraten zu
    werden. Bei vielen Tickets derselben Domäne mit ähnlichem Datum ist
    etwas Überlappung eine bekannte, akzeptierte Einschränkung dieser
    Ansicht (keine vollständige Kollisionsvermeidung innerhalb einer Zeile).
  Zusätzlich ein eigener, bewusst einfach gehaltener zweiter Graph im
  selben Bereich: **"Textschnipsel-Querverweise (Massenverarbeitung)"**
  – zeigt, welche Gliederungskapitel sich in ihren
  Massenverarbeitung-Textschnipseln gegenseitig per **"[Verweis]"-Tag**
  (demselben Tag, den der Benutzerhandbuch-Kapitel-Generator schon beim
  Schreiben setzt) referenzieren. Rein deterministisch aus dem bereits
  vorhandenen Tag erkannt (Muster "Kapitel &lt;Nummer&gt;" im
  Verweistext, gegen die Kapitelnummern der Gliederung abgeglichen) –
  kein eigener KI-Aufruf. Button "Querverweise anzeigen" berechnet den
  Graphen auf Knopfdruck; nur Kapitel mit mindestens einer erkannten
  Verweis-Beziehung erscheinen als Knoten (Kreisanordnung), eine Linie
  je Richtung mit Pfeil zum referenzierten Kapitel. Mauszeiger über
  Linie/Knoten zeigt per natives SVG-Tooltip den vollen Kapiteltitel
  bzw. den genauen Verweistext. Bewusst als eigener, einfacher
  SVG-Renderer umgesetzt statt in den obigen Ticket-Abhängigkeitsgraphen
  integriert, um dessen Code nicht anzufassen.
  Ein dritter, ebenfalls eigenständiger Graph im selben Bereich:
  **"Kapitel-Übergänge (aus Excel-Matrix 'Uebergaenge')"** – zeigt die im
  gleichnamigen Arbeitsblatt der hochgeladenen oneSCM-Excel-Matrix (s.
  Einstellungen → "Gliederung + Steuerung/KPI aus Excel-Matrix
  hochladen") hinterlegten Übergänge/Abgrenzungen zwischen Kapiteln –
  unabhängig von den "[Verweis]"-Tags oben, da diese Daten aus der Matrix
  selbst stammen statt aus Massenverarbeitung-Textschnipseln. Jede Zeile
  des Arbeitsblatts beschreibt einen Übergang mit einer ID (z. B.
  "T14-15"), einem erläuternden Text und einem Kapitelbezug wie "14 ↔ 15"
  (wechselseitig) oder "15.2/15.7 → 14.8" (gerichtet, ggf. mehrere
  Kapitel/Unterkapitel je Seite – dann wird je referenziertem Hauptkapitel
  eine Kante gebildet). Mehrere Übergangs-Zeilen, die auf dasselbe
  Kapitelpaar führen, werden zu einer einzigen Kante zusammengeführt
  (Tooltip listet alle zugehörigen IDs) statt sich deckungsgleich zu
  überlagern. Unter dem Graphen zeigt eine Tabelle zusätzlich alle
  Übergänge mit vollem Text und "Fehlende Nachweise" im Klartext (auch
  für Zeilen, deren Kapitelbezug sich nicht auf die aktuelle Gliederung
  abbilden lässt). Wie die Gliederung/Steuerung & KPI selbst Konfiguration
  (kein Sitzungsdatensatz) – bleibt bei "Sitzung zurücksetzen"/"Alle Daten
  löschen" erhalten und wird nur durch einen erneuten Matrix-Upload
  ersetzt.
- **Trend** (neu, direkt unter Ticket Graph) – zeitlicher Verlauf der
  aktuell geladenen Tickets, rein deterministisch aus den Feldern
  "Erstellt"/"Gelöst am"/Domäne berechnet (kein KI-Aufruf). Zeitraster
  Woche/Monat umschaltbar. Tickets ohne erkennbares Erstellungsdatum
  fließen nicht ein (ehrlicher Leer-Zustand statt eines irreführenden
  Diagramms, wenn keines der geladenen Tickets ein Datum hat).
  - *Burndown* – drei kumulative Linien über die Zeit: "Erstellt",
    "Gelöst" (Feld "Gelöst am") und die gefüllte Fläche "Offen"
    (= Erstellt − Gelöst zu diesem Zeitpunkt) – klassische
    Burndown/Burnup-Darstellung zum Fortschritt Richtung
    Release-Fertigstellung.
  - *Domain-Trend* – je Domäne eine eigene Linie mit der Anzahl **neu
    erstellter** Tickets je Zeitraster (nicht kumulativ) – zeigt, welche
    Domänen gerade aktiv sind. Domänen-Filter (Mehrfachauswahl mit "Alle
    auswählen"/"Auswahl aufheben", leer = automatisch die 6
    ticketreichsten Domänen).
  Beide Diagramme als reines, selbst erzeugtes SVG (keine externe
  Chart-Bibliothek, gleiche Technik wie der Ticket Graph) und lassen sich
  einzeln über "Als Bild exportieren (PNG)" herunterladen.
- **Datenqualität** (neu, direkt unter Trend) – 12 automatisierte
  Prüfpunkte gegen die aktuell geladenen Tickets, rein aus bereits
  vorhandenen/berechneten Feldern abgeleitet (kein KI-Aufruf, keine
  Bewertung der inhaltlichen Richtigkeit – ein Treffer bedeutet
  "möglicherweise unvollständig/inkonsistent"): fehlende Zusammenfassung,
  fehlende Beschreibung, fehlende Domäne, fehlender Typ, fehlendes
  Erstellungsdatum, "erledigt" ohne "Gelöst am"-Datum, veraltet (offen/in
  Bearbeitung seit über 90 Tagen ohne Aktualisierung), verwaiste
  Issue-Link-Verknüpfung (zeigt auf nicht geladenes Ticket), verwaiste
  Epic-Verknüpfung, kein Label-Themengebiet zugeordnet, kein
  Benutzerhandbuch-Kapitel zugeordnet, sowie Tickettyp ohne
  Punkte-Konfiguration (Einstellungen). Je Prüfpunkt eine auf-/zuklappbare
  Liste der betroffenen Tickets mit "Im Dashboard anzeigen"-Sprung
  (springt zum Dashboard und sucht direkt nach dem Ticket-Schlüssel).
- **Listenauswahl** – die im Dashboard per Checkbox ausgewählten Tickets
  lassen sich hier benannt als eigenständige Liste speichern (Name,
  Zeitpunkt automatisch, Ticket-Inhalte UND die reine Liste der
  Jira-Nummern als Snapshot). Gespeicherte Listen bleiben unverändert
  erhalten, auch wenn sich die Dashboard-Auswahl oder die Tickets selbst
  später ändern, und lassen sich jederzeit erneut exportieren (Nummern
  oder Gesamtinhalt) oder löschen. Nützlich, um z. B. verschiedene
  Ticket-Zusammenstellungen für unterschiedliche Zwecke (Release A vs.
  Release B, Benutzerhandbuch-Kandidaten, ...) parallel vorzuhalten.
  Ein eigener **Typ-Schnellfilter** (dieselben Typ-Chips plus die 4
  Presets Ohne Bugs/Nur Epics/Ohne Reporting/Ohne Testing wie im
  Dashboard) grenzt hier direkt die **Vorschau** der bereits getroffenen
  Dashboard-Auswahl ein – die Dashboard-Auswahl selbst bleibt davon
  unberührt. Gespeichert wird immer genau die gefilterte Vorschau, sodass
  sich z. B. aus einer größeren Auswahl gezielt "nur die Epics daraus"
  oder "alles außer den Bugs daraus" als eigene Liste ablegen lässt, ohne
  vorher im Dashboard neu selektieren zu müssen.
- **Feld-Mapping-Überarbeitung** anhand von zwei echten, anonymisierten
  Jira-Exportvorlagen (ein XML- und ein HTML-Tabellenexport, vom Nutzer
  bereitgestellt) – deckte mehrere konkrete Lücken auf, die jetzt behoben
  sind:
  - **Kritischer Bugfix:** das Verb-Attribut eines Issue-Links heißt in
    echten Jira-Exports `description`, nicht `desc` (die bisherige,
    unbestätigte Annahme) – dadurch wurde JEDER Link bisher als
    "Verknüpft" statt korrekt als Vorgänger/Nachfolger/Testticket
    eingeordnet. Beide Attributnamen werden jetzt geprüft (`description`
    zuerst).
  - Zwei neue Kernfelder **"Gelöst am"** (`resolved`) und **"Fällig am"**
    (`due`) – bisher komplett unerfasste Standardfelder, aus
    XML-Tags sowie den HTML-Tabellenspalten `resolutiondate`/`duedate`
    gelesen.
  - **Subtasks** (`<subtasks>`) fließen jetzt als eigene
    Verknüpfungskategorie in den Ticket-Graph ein (bisher komplett
    unerfasst) – dabei auch ein Zeichnungs-Bug behoben: der Pfeil-Marker
    für diese Kategorie fehlte im SVG (nur die Linie ohne Pfeilspitze
    wurde gezeichnet).
  - Das Feld **"Epic Link"** (XML-Custom-Field-Typ "...gh-epic-link" bzw.
    die gleichnamige Spalte in HTML-Tabellenexporten) wird jetzt als
    eigene Kantenart "Epic-Verknüpfung" im Ticket-Graph dargestellt (s.
    Ticket-Graph-Bullet oben) statt bisher komplett unerfasst zu bleiben.
  - Ein **"labels"-Custom-Field** (z. B. "INT Tag") liefert seine Werte im
    XML als `<label>`-Kindelemente statt als `<customfieldvalue>` – wurde
    dadurch bisher komplett verworfen, wird jetzt erkannt.
  - Ein **"userpicker"-Custom-Field** (z. B. "Responsible PO") trägt den
    lesbaren Namen im Attribut `displayname` (der Textinhalt ist nur der
    technische Username) – wird jetzt bevorzugt gelesen UND wie
    Bearbeiter/Ersteller über `PersonAnonymizer` pseudonymisiert statt nur
    musterbasiert redigiert (ein rein musterbasierter Durchlauf erkennt
    Namen nicht zuverlässig). Für Formate ohne dieses Typ-Attribut
    (HTML-Tabellen/Einzelticket) greift ergänzend eine enge, auf den
    bestätigten Feldnamen zugeschnittene Namens-Heuristik
    ("Responsible PO"/"Product Owner") – bewusst nicht breiter gefasst
    (z. B. nicht "Owner" allein), um keine Team-/Komponentennamen fälschlich
    zu pseudonymisieren.
  - **"Beobachter"** (`watches`) ist in beiden Exportformaten nur ein
    reiner Zähler (kein `<watcher>`-Namenstext) – wurde bisher fälschlich
    als eine Beobachter-Namensliste mit dem Zähler als "Name"
    interpretiert; der Zähler landet jetzt korrekt als eigenes Zusatzfeld
    ("Beobachter (Anzahl)").
  - Die `statusCategory` (z. B. `key="done"`) wird jetzt zusätzlich zum
    freien Statustext als Zusatzfeld "Statuskategorie" erfasst.
  - Die Feld-Alias-Tabelle wurde um weitere gängige deutsche/englische
    Jira-Feldbezeichnungen erweitert.
  Bekannte, bewusst nicht behobene Einschränkung: die Spalten "Autor"
  (`reporter`) und "Ersteller" (`creator`) sind in Jira zwei technisch
  unterschiedliche Felder, werden hier aber weiterhin auf dasselbe Feld
  `reporter` abgebildet (in der weit überwiegenden Zahl der Fälle dieselbe
  Person) – eine Auftrennung in zwei eigene Felder würde ein zusätzliches,
  ebenfalls pseudonymisierungspflichtiges Personenfeld einführen, ohne in
  der Praxis einen belastbaren Mehrwert zu bieten.
- **Import** – vier Formate per Tab wählbar, jeweils mit Mehrfachauswahl
  und Drag&Drop; zusätzlich eine **Zwischenablage-Funktion**: Text direkt
  einfügen (Button „Aus Zwischenablage einfügen“ oder Strg+V in das
  Textfeld), Format wird automatisch erkannt, Button „Verarbeiten und
  speichern“ zeigt während der Verarbeitung eine Sanduhr/Spinner-Animation;
  das Ergebnis erscheint in der Dateiverwaltung mit der Quelle „Manuell
  (Zwischenablage)“. Die automatische Formaterkennung ("Andere Importe" und
  die Zwischenablage, auch innerhalb von ZIP-Archiven) erkennt zusätzlich:
  eine **Ticket-Nummern-Liste** (ein Schlüssel wie `ONESCM-123` pro Zeile) –
  toleriert dabei typische Kopier/Einfüge-Varianten (Groß-/Kleinschreibung,
  Aufzählungszeichen "-"/"*"/"•" oder Nummerierung "1."/"2)" vor dem
  Schlüssel, Kommas/Semikolons danach, eine einzelne Überschriftszeile wie
  "Meine Tickets:") – daraus werden Platzhalter-Tickets angelegt (bereits
  bekannte, reichhaltigere Ticketdaten bleiben dabei unverändert, s.
  Teil-Import unten) und die Liste wird direkt als **neue, benannte Liste
  unter „Listenauswahl“** gespeichert (auch bei einer Ticket-Liste als
  einzelne Datei innerhalb eines ZIP-Archivs); sowie **CSV-Dateien/-Text**
  (Komma oder Semikolon getrennt, automatische Trennzeichen-Erkennung,
  RFC4180-taugliche Anführungszeichen-Behandlung inkl. echter
  Zeilenumbrüche innerhalb eines quotierten Feldes) und **Excel-Tabellen
  (.xlsx)** – Letztere werden wie .docx direkt im Browser über das bereits
  geladene JSZip gelesen (keine neue Bibliothek nötig), **alle** enthaltenen
  Arbeitsblätter werden ausgewertet. Tabellen-Kopfzeilen werden über
  dieselbe Alias-Tabelle wie beim Massenupload-Parser erkannt, erkennen
  also sowohl deutsche ("Schlüssel"/"Zusammenfassung") als auch englische
  ("Key"/"Summary") Spaltennamen. Ein optionales **Kommentarfeld** oberhalb des
  Datei-Uploads gilt für den jeweils nächsten Datei- oder
  Zwischenablage-Import und wird nach erfolgreichem Import automatisch
  geleert; der Kommentar erscheint danach überall dort, wo der Import zur
  Auswahl steht (Dateiverwaltung, "Datei auswählen" in Verarbeitung) und
  lässt sich in der Dateiverwaltung jederzeit nachträglich ergänzen oder
  ändern. Parsing/Bereinigung laufen vollständig im Browser, die
  Datei/der Text verlässt den Rechner nicht:
  - *Jira Massenupload* – Jira-HTML-Export (Issue-Navigator-Tabelle)
    oder klassischer XML-Export (JavaScript-Portierung von
    `parser_html.py`/`parser_xml.py`/`cleaner.py`).
  - *Jira Einzelticket* – einzelne Ticket-Detailseite (HTML, ein Ticket
    pro Datei, Überschrift + Feldtabellen).
  - *Releaseinfo / Confluence-Export* – Release-Notes-Text aus
    Confluence, als .txt (Tab-getrennt), als Word-Export (**.docx**) oder
    als **PDF-Export (.pdf)**. Die Tabellen aus dem .docx werden direkt
    im Browser über das bereits geladene JSZip aus `word/document.xml`
    extrahiert (keine neue Bibliothek nötig) und ergeben exakt dieselben
    Zeilen wie die .txt-Variante. Für .pdf wird der Text über pdf.js
    extrahiert und die Zeilen-/Spaltenstruktur aus den x/y-Positionen der
    Textfragmente rekonstruiert (Best-Effort wie die anderen Parser –
    Qualität hängt von der PDF-Struktur ab; reine Scan-/Bild-PDFs ohne
    Text werden ehrlich mit Fehlermeldung abgelehnt, kein OCR-Fallback).
    Tickets werden je Service-Abschnitt automatisch der dort genannten
    Domain zugeordnet und über den Schlüssel dedupliziert (mehrere
    Service-Zugehörigkeiten werden als Komponenten zusammengeführt). Das
    alte, binäre .doc-Format (vor Word 2007) lässt sich zwar auswählen,
    wird aber ehrlich mit einer Fehlermeldung abgelehnt statt fehlerhaft
    "geraten" – Word bietet dafür "Speichern unter" → .docx an. Eine
    Datei mit .doc/.docx-Endung wird zuerst anhand der ersten Bytes
    erkannt statt blind als .docx-ZIP behandelt: manche Export-Werkzeuge
    (u. a. Jira-/Confluence-Plugins) liefern unter .doc tatsächlich
    HTML aus (Word kann HTML rendern) – das wird automatisch als
    HTML-Export gelesen. Ein RTF-Dokument mit .doc/.docx-Endung wird mit
    einer eigenen, klaren Fehlermeldung abgelehnt statt der kryptischen
    rohen ZIP-Bibliotheksmeldung ("Can't find end of central directory").
  - *Word (DOC/DOCX)* – eigener Tab nur für .docx/.doc, sonst identisch zu
    "Andere Importe" (automatische Formaterkennung); reine Komfort-
    Filterung der Dateiauswahl auf Word-Dokumente.
  - *ZIP-Archiv* – ein .zip mit mehreren Exportdateien (beliebige Mischung
    aus .html/.htm/.xml/.txt/.docx/.doc/.pdf) hochladen; jede enthaltene
    Datei wird einzeln entpackt, automatisch erkannt und eingelesen, alle
    daraus gewonnenen Tickets landen als **ein** Import-Eintrag (benannt
    nach dem Archiv) in der Dateiverwaltung. Scheitert eine einzelne Datei
    im Archiv, werden die übrigen trotzdem verarbeitet – der Fehler
    erscheint mit Dateiname im Protokoll (Verarbeitung → 1. Jira
    Verarbeitung) sowie in der Erfolgsmeldung ("X von Y Dateien
    fehlgeschlagen"); nicht unterstützte Dateitypen im Archiv (z. B.
    .pdf-Anhänge außerhalb der erwarteten Formate) werden ohne
    Fehlermeldung übersprungen, da sie nicht zum Ticket-Export gehören.
    Während des Einlesens (Datei- oder ZIP-Upload) zeigt die Dropzone eine
    Sanduhr und ist bis zum Abschluss deaktiviert.
  - *Andere Importe* – probiert alle Parser automatisch durch (inkl. .docx/.pdf,
    .csv, .xlsx sowie reine Ticket-Nummern-Listen).
  - *Ticket-Splitt* – eine .docx mit mehreren Jira-Tickets (gleiche
    automatische Formaterkennung wie "Andere Importe"/"Word") wird wie ein
    normaler Import gespeichert (erscheint zusätzlich in Dateiverwaltung/
    Dashboard) **und** zusätzlich zerlegt: für jedes enthaltene Ticket wird
    eine eigene .docx-Datei erzeugt, im selben Feld/Wert-Ticket-Layout wie
    der bestehende Markdown-/PDF-Einzelticket-Export (`renderMarkdown()`),
    bereinigt/pseudonymisiert wie überall in der App. Dateiname je
    Einzeldatei = Jira-Nummer (z. B. `ONESCM-12345.docx`), alle zusammen als
    ein ZIP-Archiv zum Download.
  - **MD-Dateien** – liest zuvor von dieser App als Markdown exportierte
    Einzelticket-Dateien (aus "Output MD Tickets" oder Ticket-Splitt, selbes
    Feld/Wert-Tabellen-Format wie `renderMarkdown()`) wieder ein und fügt sie
    wie ein normaler Import zu den geladenen Tickets hinzu (erscheint in
    Dashboard, Verarbeitung und Dateiverwaltung). Entweder mehrere einzelne
    `.md`-Dateien auf einmal **oder** ein `.zip`-Archiv mit mehreren
    `.md`-Dateien hochladen – beides wird zu **einem** Import zusammengeführt
    statt je Datei einen eigenen anzulegen (anders als bei den übrigen
    Format-Tabs, bei denen jede ausgewählte Datei ein eigener Import wird).
    Erwartet exakt das von `renderMarkdown()` erzeugte Format (Überschrift
    `# SCHLÜSSEL – Zusammenfassung`, Feld/Wert-Tabelle, optionaler Abschnitt
    "## Beschreibung"). Eine Datei, deren erste Zeile dieses Schema klar
    nicht erfüllt (z. B. ein RAG-Batch-Teilschritt-Export mit mehrwortigem
    Titel statt Ticket-Schlüssel), wird als "kein Ticket-Export" erkannt und
    übersprungen statt als Fehler gezählt – mit Dateiname im Protokoll
    (Verarbeitung → 1. Jira Verarbeitung) und in der Erfolgsmeldung
    vermerkt. Sind in der Auswahl ausschließlich solche Nicht-Ticket-Dateien
    enthalten, wird kein Import angelegt und stattdessen eine Hinweismeldung
    ("Keine Ticket-Exporte gefunden") angezeigt. Ein echter Fehler (z. B.
    ein nicht lesbares ZIP) wird weiterhin als Fehler mit Dateiname
    gemeldet; die übrigen Dateien werden trotzdem übernommen.
  - **Dateiansicht** (am Ende des Import-Bereichs) – eine bereits
    importierte Datei auswählen und ihre daraus geladenen Tickets in einem
    lesbaren, XML-ähnlichen Format ansehen, unabhängig vom
    Originalformat (HTML, XML, .docx, .xlsx, .pdf, CSV, Ticket-Liste).
    **Wichtig:** gezeigt wird bewusst NICHT die Rohdatei, sondern
    dieselben bereits bereinigten Ticketdaten, die auch überall sonst in
    der App verwendet werden (Namen über `PersonAnonymizer`
    pseudonymisiert, E-Mail/VIN/Kennzeichen/Telefon/Adresse über die
    Muster-Erkennung entfernt) – ein blinder Redaktionsdurchlauf über die
    rohe Originaldatei könnte z. B. Personennamen in Freitext unbemerkt
    durchlassen, da diese nur sicher erkannt werden, wenn bekannt ist,
    welches Feld (Bearbeiter/Ersteller) einen Namen enthält. Bei einer
    Datei mit vielen Tickets werden aus Performance-Gründen maximal 100
    angezeigt (mit Hinweis, die Auswahl einzugrenzen).
  - **Dateiansicht-FastTrack** (drei gelbe Buttons rechts von
    "Dateiansicht", erst nach Klick auf "Dateiansicht" aktiv) – drei
    schnelle KI-gestützte Aktionen auf der aktuell gezeigten (bereinigten)
    Datei:
    - **Übersetzen (Deutsch)** – übersetzt den gesamten angezeigten
      Dateiinhalt (z. B. englischsprachige Jira-Tickets) ins Deutsche;
      ersetzt danach automatisch die Ansicht, ein Original/Übersetzung-
      Umschalter erscheint, damit jederzeit zwischen beiden gewechselt
      werden kann, ohne erneut zu übersetzen.
    - **Als Word exportieren** – exportiert die aktuell angezeigte Ansicht
      (Original oder Übersetzung, je nach Umschalter) als `.docx`-Datei.
    - **Datei zusammenfassen** – öffnet ein neues Fenster mit einer
      prägnanten KI-Zusammenfassung der Datei, wahlweise auf Deutsch oder
      English (Umschalter im Fenster, beide Sprachen werden je einmal
      erzeugt und danach gecacht). Die fertige Zusammenfassung lässt sich
      zusätzlich als CSV, Word (`.docx`) oder PDF herunterladen (eigene
      Export-Buttons im Fenster, erst nach erfolgreicher Erzeugung aktiv).

    Übersetzen und Zusammenfassen arbeiten auf denselben bereinigten
    Ticket-Rohdaten wie die Dateiansicht selbst (max. 100 Tickets) und
    nutzen dieselbe budget-chunkende, reaktiv gegen "zu viele Rohdaten für
    einen Durchlauf" bisektierende Architektur wie der Benutzerhandbuch-
    Kapitel-Generator (s. u.), damit auch Dateien mit vielen/langen Tickets
    nicht an diesem Limit scheitern. Während der Erzeugung zeigen alle drei
    Aktionen durchgängig eine Sanduhr (wie an anderen Verarbeitungsstellen
    in der App); ohne `window.claude`-Laufzeit (z. B. beim lokalen Öffnen
    der Datei) erscheint statt eines dauerhaft hängenden Ladezustands ein
    klarer Hinweis, dass die KI-Funktion hier nicht verfügbar ist.
  - **Import-Statistik** (am Ende des Import-Bereichs, letzter Abschnitt) –
    erscheint automatisch nach jedem Import (ohne Klick, neuester Import
    vorausgewählt; über die Auswahlbox auch für ältere Imports abrufbar)
    und zeigt je Kernfeld (Zusammenfassung, Typ, Status, Priorität,
    Projekt, Lösung, Bearbeiter, Ersteller, Erstellt/Aktualisiert, Labels,
    Komponenten, Fix-Version(en), Beschreibung, Verknüpfungen) die
    **Abdeckung**: bei wie vielen der aus dieser Datei eingelesenen
    Tickets das Feld tatsächlich einen Wert hatte (Zahl, Prozent, Balken).
    Zusatzfelder (`custom_fields`, z. B. Domain) werden in einem eigenen
    Abschnitt separat gelistet, ebenso Kommentare/Beobachter – letztere
    IMMER aus Datenschutzgründen entfernt (s. Dateiansicht), unabhängig
    vom Quellformat; ihre Abdeckung zeigt daher nur, wie viele Tickets sie
    laut Rohdaten *vor* der Entfernung hatten. Eine Abdeckung von 0 % kann
    zwei Ursachen haben: entweder war das Feld in der exportierten Quelle
    schlicht nicht enthalten (z. B. eine beim Jira-Export nicht mit
    ausgewählte Spalte), oder der Parser für dieses Format konnte es aus
    der jeweiligen Quellstruktur nicht erkennen – die Statistik selbst
    unterscheidet diese beiden Fälle bewusst nicht (das müsste pro Format
    exakt mitprotokolliert werden, was den Quellcode deutlich verkomplizieren
    würde), macht aber in jedem Fall sichtbar, WIE VOLLSTÄNDIG eine
    konkrete Datei tatsächlich ausgewertet werden konnte, statt es zu
    erraten. Die Feld-Alias-Tabelle (Massenupload-/Releaseinfo-/
    Einzelticket-Parser) wurde zusätzlich um weitere gängige deutsche/
    englische Jira-Feldbezeichnungen erweitert (z. B. "Vorgangsschlüssel",
    "Issuetype", "Owner", "Zielversion"), damit mehr Spalten als
    typisiertes Kernfeld statt nur als generisches Zusatzfeld erkannt
    werden.
- **Dateiverwaltung** – Liste aller Imports dieser Sitzung sowie ein
  Vergleich von Tickets, die in mehreren Imports mit unterschiedlichem
  Status/Datum/Zusammenfassung vorkamen (Vorher/Nachher inkl. Quelle).
  Tickets werden über ihren Schlüssel zusammengeführt; bei einem
  Teil-Import (z. B. ein Releaseinfo-Nachtrag, der nur Schlüssel/Status/
  Domain enthält) bleiben im vorherigen Import vorhandene, im neuen
  Import aber fehlende Felder unverändert erhalten und werden **nicht**
  als Änderung gewertet – nur tatsächlich abweichende Werte erscheinen im
  Vergleich. Im Dashboard markiert ein Punkt hinter dem Schlüssel
  geänderte Tickets. Jeder Import lässt sich über den Button "Löschen"
  einzeln wieder aus der Sitzung entfernen (mit Sicherheitsabfrage):
  Tickets, die ausschließlich aus diesem Import stammen, werden komplett
  entfernt; Tickets, die auch in anderen Imports vorkamen, bleiben mit
  ihrem aktuellen, bereits zusammengeführten Stand erhalten – da pro
  Import keine vollständige Rohkopie gespeichert wird, lassen sich
  einzelne Feldänderungen aus genau diesem Import nicht gezielt
  zurückrechnen. Import-Nummern werden nach dem Löschen nie wiederverwendet.
  Zusätzlich lässt sich jeder Import über eine **"Aktiv"-Checkbox**
  vorübergehend deaktivieren, statt ihn zu löschen – im Unterschied zu
  "Löschen" bleiben die Ticketdaten dabei vollständig erhalten und lassen
  sich jederzeit verlustfrei wieder aktivieren. Ein Ticket bleibt sichtbar,
  solange mindestens eine seiner Quell-Dateien aktiv ist. Die Checkbox
  wirkt bewusst nicht sofort (bei vielen Tickets/Imports spürbar
  Rechenzeit), sondern erst nach Klick auf den Button **"🔄 Aktualisieren
  (Aktiv/Inaktiv übernehmen)"** oberhalb der Import-Tabelle – ein Hinweis
  zeigt an, wenn noch nicht übernommene Änderungen vorliegen. Nach dem
  Übernehmen laufen **sowohl das Dashboard als auch alle Verarbeitung-Jobs**
  (3–7, inkl. RAG) einheitlich nur noch auf den aktiven Dateien, da die
  Filterung an einer einzigen Stelle (dem Aufbau der Ticketliste) erfolgt.
- **Gliederung** – Stichwort-Register je **Unterkapitel** der
  Benutzerhandbuch-Gliederung, optional zusätzlich nach **Label-
  Themengebiet** eingegrenzt (beides aus Einstellungen). Ein Klick auf
  **"Stichwörter erzeugen"** extrahiert für die gewählte Kombination
  **mindestens 80 Stichwörter** aus den zugeordneten Tickets – rein
  deterministisch über Text-Häufigkeitsanalyse (Zusammenfassung,
  Beschreibung, Domäne, Typ sowie die bereits automatisch erkannten Labels,
  letztere höher gewichtet), **kein KI-Aufruf**, daher immer verfügbar und
  die Mindestanzahl zuverlässig erreichbar; reicht der Ticket-Text nicht
  aus, wird mit passenden Begriffen aus der Label-Begriffsliste aufgefüllt
  (klar als "0 Tickets" gekennzeichnet). Innerhalb des durch die
  Kapitel-Domäne bestimmten Ticket-Pools wird zusätzlich versucht, auf
  Tickets einzugrenzen, deren Text ein Wort aus dem Unterkapitel-Titel
  selbst enthält – bei zu wenigen Treffern automatischer Rückfall auf den
  gesamten Kapitel-Pool. Alternative Datenquelle per Checkbox: statt
  Unterkapitel/Label die im **Dashboard per Checkbox ausgewählten Tickets**
  (dieselbe Auswahl wie bei Listenauswahl/Dashboard-Export) – mit Live-Zähler
  der aktuellen Auswahl; die Unterkapitel-/Label-Selects werden währenddessen
  deaktiviert, die zuvor erzeugte Unterkapitel-basierte Stichwortliste bleibt
  dabei unangetastet erhalten (eigener Sitzungseintrag je Datenquelle). Jedes Stichwort ist frei **umbenennbar** (Textfeld)
  und **löschbar**, neue lassen sich manuell **hinzufügen**; ein Klick auf
  den Pfeil klappt eine Box mit einem Text (bevorzugt aus einem bereits
  erzeugten Benutzerhandbuch-Kapitel, sonst ein Rohdaten-Auszug), der
  jeweiligen **Datenquelle** sowie den zugehörigen **Jira-Tickets** auf
  (Klick öffnet das Ticket-Detail). Zwei KI-Funktionen (sample-Capability,
  nur innerhalb der Claude-Artifact-Laufzeit) ergänzen die deterministische
  Liste, beide bewusst **nicht** Sitzungsdatensatz (wie RAG-Ausgaben): ein
  **Chat** (mehrstufiger Dialog mit den Stichwörtern/Ticket-Rohdaten als
  Kontext) sowie **"Grill me"** (einmaliger Kritik-Durchlauf, liefert
  strukturiert offene Themen, Widersprüche und Verbesserungsvorschläge).
  "Grill me" bezieht zusätzlich als **"Background" klassifizierte**
  Tickets/Massenverarbeitung-Textschnipsel desselben Kapitels als
  Zusatzkontext ein (s. Klassifizierung oben) – dient dort NICHT als
  Quelle für Handbuchtext, sondern ausschließlich dazu, unter "Offene
  Themen" auch Lücken zu benennen, die im Hintergrundwissen vorkommen,
  aber im regulären (genehmigt/in Prüfung) Kontext fehlen; der Chat nutzt
  bewusst nur den regulären Kontext. Eine **erweiterte Suche** durchsucht Zusammenfassung/Beschreibung/Labels/
  Domäne aller aktuell geladenen Tickets, zeigt die Trefferanzahl sowie
  **benachbarte Themenfelder** – bereits erzeugte Stichwörter aus
  beliebigen anderen Unterkapiteln, deren Ticket-Zuordnung sich mit den
  Suchtreffern überschneidet.

  **Gliederung exportieren & zuordnen** (neu, v2.85.0, umgebaut in
  v2.86.0): die aktuelle Gliederung (Kapitel/Unterkapitel) lässt sich als
  eigene JSON-Datei exportieren – z. B. zur Wiederverwendung in einem
  anderen Projekt oder als Zuordnungsgrundlage. Es lassen sich beliebig
  viele andere Gliederungen hochladen – eine zuvor exportierte Gliederung
  (.json) oder eine fremde Gliederung aus einem Word-Dokument (.docx,
  Formatvorlagen "Überschrift 1/2") – die eigene Gliederung bleibt dabei
  unverändert. Für jede hochgeladene Gliederung (per Dropdown umschaltbar)
  zeigt eine **Zuordnungstabelle** je Kapitel der aktuellen Gliederung ein
  automatisch per **Fuzzy-Matching** (wortbasierte Titel-Ähnlichkeit,
  dieselbe Logik wie beim Referenz-Handbuch-Mapping – erkennt auch leicht
  abweichende, nicht identische Titel) vorgeschlagenes Kapitel der
  hochgeladenen Gliederung, jederzeit per Dropdown manuell korrigierbar
  und dauerhaft gespeichert (unabhängig je hochgeladener Gliederung) –
  so lassen sich bestehende Kapitel-Inhalte mehreren Gliederungen
  zuordnen. Rein zur Übersicht/Dokumentation, kein automatischer
  Inhalts-Transfer und kein KI-Aufruf nötig.
- **Rovo Knowledge** (neu, v2.85.0, eigener Navigationspunkt direkt nach
  Import): eigenständiger Bestand für Textschnipsel aus Rovo-KI-Chats
  (Chatverlauf + Antwort als zwei getrennte Felder), importierbar über
  Zwischenablage (je ein eigener "Aus Zwischenablage einfügen"-Button für
  Chatverlauf und Antwort) oder durch Hochladen von Dateien – neben .md
  jetzt auch **.docx/.doc, .pdf und .pptx** (neu, v2.96.0, Mehrfachauswahl
  gemischter Formate in einem Rutsch möglich; bei .pptx wird der Text
  aller Textrahmen je Folie gelesen, nicht nur Bilder/Folientitel wie im
  Screens-Import) – eine eigene Zeile "---" im extrahierten Text trennt
  dabei Chatverlauf (davor) von Antwort (danach), ohne Trennzeile landet
  der gesamte Inhalt im Chatverlauf-Feld. Frisch importierte Zeilen werden
  kurz farblich hervorgehoben und die Übersicht dorthin gescrollt, damit
  neue Einträge sofort sichtbar sind; schlägt der Import einer einzelnen
  Datei fehl (z. B. beschädigte Datei), bricht das die übrigen
  Dateien im selben Upload nicht ab. Jeder Eintrag ist fest mit dem Label **"ROVO"**
  markiert. Ein Klick auf "KI-Zuordnung" ordnet alle noch offenen Einträge
  per Claude (sample-Capability) einem passenden Kapitel/Unterkapitel
  (wörtlich aus der Gliederung) sowie bis zu 3 weiteren Labels zu, ohne
  ein bereits gesetztes Kapitel zu überschreiben und ohne das feste
  ROVO-Label zu verlieren. Kapitel, Unterkapitel und Labels bleiben danach
  frei manuell nachpflegbar (neu, v2.87.0): Kapitel/Unterkapitel per
  Dropdown, Labels als entfernbare Chips ("×") mit eigenem
  "+ Label"-Auswahlfeld (wörtlich aus der Stammdaten-Labelliste, keine
  Freitext-Labels) – "ROVO" selbst bleibt fest und ist nicht entfernbar.
  **Vorrangige Quelle** (neu, v2.95.0): das "ROVO"-Label ist visuell
  hervorgehoben (eigener Chip-Stil, Tooltip erklärt den Grund), da diese
  Daten direkt aus dem Rovo-Quellsystem stammen – bei der EDITO-
  Kapitelerzeugung (s. u.) ist Rovo Knowledge als QUELLE 4 explizit
  vorrangig gegenüber den anderen Quellen markiert; widersprechen sich
  Quellen inhaltlich, ist Rovo Knowledge maßgeblich.
  **Automatische Bild-/Tabellen-Extraktion** (neu, v2.97.0): aus
  importierten .docx-/.pptx-Dateien werden zusätzlich enthaltene Bilder
  automatisch extrahiert und landen im Register "Bilder" (dieselbe
  Datenstruktur wie beim Screens-Import, inkl. Quelldatei-Kennzeichnung im
  Dateinamen), während enthaltene Tabellen strukturiert (Zeilen/Zellen,
  nicht nur Fließtext) ins neue eigenständige Register "Tabelle"
  übernommen werden; aus .md-Dateien werden zusätzlich einfache
  Markdown-Pipe-Tabellen (<code>| … |</code>) übernommen. PDF liefert
  weiterhin nur Fließtext, da es weder eingebettete Bilder noch
  Tabellenstrukturen zuverlässig liefert. Ein Fehler bei dieser
  Zusatz-Extraktion blockiert den eigentlichen Text-Import einer Datei
  nicht.
  Im Text vorkommende Jira-Ticketnummern werden
  automatisch erkannt und lassen sich je Eintrag über einen eigenen
  "Jira"-Button ein-/ausblenden (reiner Anzeige-Umschalter, keine
  Abgleich mit importierten Ticketdaten). Alle Einträge lassen sich über
  "Alle als ZIP exportieren" gesammelt als ZIP-Archiv herunterladen (je
  Eintrag eine eigene .md-Datei mit Metadaten-Kopf). **Vollbild-Ansicht per
  Doppelklick** (neu, v2.93.0): ein Doppelklick auf eine Eintrags-Zeile
  (außerhalb von Dropdowns/Buttons) öffnet Chatverlauf und Antwort
  ungekürzt nebeneinander in einem Vollbild-Overlay (schließen über ×,
  "Schließen"-Button, Escape oder Klick auf den Hintergrund). **Zusammen-
  fassung je Kapitel** (neu, v2.93.0): eigener Abschnitt am Ende des
  Registers listet jedes Kapitel mit mindestens einem zugeordneten Rovo-
  Eintrag; ein Klick auf "Erzeugen" lässt Claude aus allen diesem Kapitel
  zugeordneten Chatverlauf-/Antwort-Texten zusammenfassen, welche
  Informationen zu welchem Unterkapitel vorliegen (als Markdown mit einer
  Überschrift je Unterkapitel) – rein informativ, nicht editierbar, wird
  bei erneuter Zuordnung nicht automatisch neu erzeugt. "Alle
  Zusammenfassungen erzeugen" läuft den Sammel-Lauf über alle Kapitel mit
  zugeordneten Einträgen.
- **Rovo Summary** (neu, v2.108.0, eigener Navigationspunkt direkt nach
  Rovo Knowledge): nimmt beliebig viele voneinander unabhängige
  Quelldokumente auf – **.docx/.doc-Dateien, echte .html-/.htm-Dateien**
  (nutzt dieselbe bereits für Rovo Knowledge vorhandene, inhaltsbasierte
  statt endungsbasierte Formaterkennung, `extractTextFromDocx`/
  `extractWordLikeText`; eine echte HTML-Quelle wird zusätzlich von
  Skript-/Style-Blöcken und Tags befreit, bevor sie in den Prompt geht –
  ein echtes, binäres Legacy-.doc bleibt wie bei Rovo Knowledge mit
  klarer Fehlermeldung abgelehnt, als .docx neu speichern) sowie **aus der
  Zwischenablage eingefügten Text** (Titel optional, beliebig oft
  nacheinander hinzufügbar, "Aus Zwischenablage einfügen"-Button oder
  normales Einfügen per Strg+V in die Textarea) – per Datei-Dropzone bzw.
  Formular, mit Übersichtstabelle (Titel/Dateiname, Art, Zeichenanzahl,
  Zeitpunkt) und Entfernen-Button je Quelle. **Gesamtdokument erzeugen**:
  EIN Claude-Aufruf über alle hinzugefügten Quellen zusammen ordnet und
  verschmilzt deren Inhalte zu einem einzigen, zusammenhängenden Dokument
  – anders als bei der RAG-Bibliothek/Rovo Knowledge gibt es dabei
  **keine feste Kapitel-Zuordnung**: Claude wählt die Gliederung/
  Zwischenüberschriften selbst passend zu den tatsächlichen Inhalten und
  markiert erkennbare Widersprüche zwischen den Quellen statt sie
  stillschweigend aufzulösen. Das Ergebnis erscheint in einem frei
  editierbaren Textfeld (Nachbearbeitung vor dem Vergleich möglich) mit
  Text-Download. **Mit vorhandenen Informationen vergleichen**: ein
  zweiter Claude-Aufruf vergleicht das Gesamtdokument mit ALLEN bereits
  vorhandenen Informationen des Systems – Jira-Tickets (kompakte
  Schlüssel+Kurzbeschreibung-Liste), RAG-Bibliothek, Rovo-Bibliothek
  sowie bestehendem Benutzerhandbuch-Text (sowohl bereits veröffentlichter
  Stand als auch bereits erzeugte EDITO-Entwürfe) – und listet, analog zum
  bestehenden Handbuch-Vergleich (refCompare), **neue Informationen** und
  **Widersprüche zu bestehenden Quellen** in zwei getrennten Abschnitten.
  Beide Prompts sind unter Einstellungen → RAG-Prompts editierbar. Quellen,
  Gesamtdokument und Vergleichsergebnis werden mit der Sitzung gespeichert
  und bei "Alle Daten löschen"/"Sitzung zurücksetzen" geleert.
- **Massenverarbeitung** (neu, eigener Navigationspunkt direkt vor
  Verarbeitung) – bewusst **eigenständige** Funktion, unabhängig von der
  RAG-Bibliothek (Verarbeitung → 7. RAG, s. u.): eigener Datenbestand
  (`app.massFiles`), eigener Datei-Import (.md-Datei oder ZIP-Archiv mit
  mehreren .md-Dateien), eigene Domäne-/Kapitel-Zuordnung – beide
  Funktionen teilen sich keine Daten. Besonderheit: **"Vorhandene Inhalte
  einlesen"** übernimmt zusätzlich zum Datei-Upload alle bereits an
  anderer Stelle der App erzeugten MD-Inhalte (Benutzerhandbuch-Kapitel,
  Referenz-Handbuch-Kapitel) auf einen Klick – über einen internen
  Herkunfts-Schlüssel dedupliziert, ein erneuter Klick fügt also nichts
  doppelt hinzu. Als dritte Quelle steht **"Tickets aus Import
  übernehmen"** zur Verfügung: dieselbe Datei-/Listen-Auswahl sowie
  derselbe **Sparte-/Rollen-Filter** (Labels Pkw/Van/Markt bzw.
  Retail/Markt/MO/HQ) wie im Register Verarbeitung (geteilter, globaler
  Zustand – eine Änderung an einer Stelle wirkt sofort auch an der
  anderen) grenzt ein, welche importierten Jira-Tickets als Textschnipsel
  (Überschrift + Beschreibung) übernommen werden; auch hier über
  `ticket:<Jira-Nummer>` dedupliziert. Der Sparte-/Rollen-Filter wirkt
  zusätzlich in der Verarbeitung selbst (alle Jobs 1-7, die auf
  `scopedTickets()` aufbauen) als weitere Einschränkung neben der
  bestehenden Datei-/Listen-Auswahl. Die Anzeige gruppiert **je Domäne** (tatsächlich
  vorkommende Domänen der geladenen Tickets) und sortiert **innerhalb
  jeder Domäne automatisch nach der Reihenfolge der Gliederung**
  (`app.outline`, nicht alphabetisch) – "Ohne Domäne"/"Nicht zugeordnet"
  jeweils zuletzt. Jeder Eintrag trägt außerdem eine **Klassifizierung**
  (genehmigt/in Prüfung/intern/Background, dieselben vier Werte wie im
  Dashboard) – bei über "Tickets aus Import übernehmen" erzeugten
  Einträgen vom Ticket übernommen, sonst Standard "in Prüfung", manuell je
  Zeile änderbar. "Zusammenfassung je Kapitel" und "Kapitel als MD-Datei
  erstellen" (s. u.) schließen als "Intern"/"Background" klassifizierte
  Einträge bewusst aus (mit Hinweis auf die ausgeschlossene Anzahl in der
  Statuszeile bzw. im erzeugten Dokument). Hinter jedem Domänen-Gruppenkopf sitzt der Button
  **"Kapitel als MD-Datei erstellen"**: öffnet einen Dialog mit allen
  Textschnipseln dieser einen Domäne als eine MD-Datei (nach
  Gliederungsreihenfolge sortiert), direkt darin ansehen und editieren.
  Ein Download ist bewusst erst nach explizitem **"Speichern"** möglich –
  jede weitere Bearbeitung danach sperrt den Download wieder, bis erneut
  gespeichert wird. Der gespeicherte Stand bleibt je Domäne erhalten (auch
  beim erneuten Öffnen) und ist Teil der Sitzung (Speichern/Laden, "Alle
  Daten löschen"). Am Ende der Domänen-Liste steht zusätzlich der Button
  **"Alle MD-Dateien zusammenführen"**: fasst je Domäne den bereits über
  "Kapitel als MD-Datei erstellen" gespeicherten Stand zu einem
  Gesamtdokument zusammen (Domänen ohne gespeicherten Stand werden dafür
  automatisch frisch erzeugt, damit immer alle Domänen abgedeckt sind).
  Anders als beim einzelnen Domänen-Dialog ist der Download hier sofort
  nach jeder Bearbeitung aktiv (kein separater Speichern-Schritt) – auch
  dieser Gesamtstand ist Teil der Sitzung. Domäne/Kapitel sind je Eintrag editierbar (volle
  Gliederung zur Auswahl); bei hochgeladenen/eingelesenen Inhalten wird
  automatisch ein Vorschlag vorbelegt - **inhaltsbasiert**: durchsucht den
  GESAMTEN Text der Datei (nicht nur Dateiname/erste Überschriftzeile)
  danach, wie oft ein Domänenname wörtlich vorkommt (die Domäne mit den
  meisten Treffern gewinnt) sowie danach, ob der (von "Kapitel N:"
  befreite) Kapiteltitel als Wortfolge im Text vorkommt bzw. wie viele
  bereits erzeugte Gliederungs-Stichwörter (Einstellungen/Navigation →
  Gliederung, falls vorhanden) im Text auftauchen. Nur wenn der Text
  selbst keinen Anhaltspunkt liefert, greift ersatzweise dieselbe
  wortbasierte Titel-Ähnlichkeit wie bei der Referenz-Handbuch-Kapitel-
  Zuordnung auf Dateiname/erste Überschriftzeile zurück; findet auch das
  nichts, bleibt die Zuordnung bewusst leer statt geraten. Eine Änderung
  sortiert den Eintrag sofort live in die passende Domänen-Gruppe/Position
  ein. Hochgeladener
  Freitext wird wie überall in der App durch `redactText()` geleitet
  (PII-Schutz). Jeder Eintrag zeigt eine gekürzte **Textschnipsel-Vorschau**
  direkt in der Tabelle sowie einen Umschalter **"Ganzen Text anzeigen"**,
  der den vollständigen Text der jeweiligen Zeile einblendet. Für Einträge,
  denen die heuristische Zuordnung keine vollständige Domäne+Kapitel
  liefern konnte, gibt es zusätzlich den Button **"KI-Zuordnung"**: Claude
  liest den Textschnipsel und wählt Domäne/Kapitel **wörtlich aus der
  tatsächlich vorhandenen Liste** aus (nie eine erfundene Option, die es
  nicht gibt) oder lässt die Zuordnung bewusst leer, wenn nichts eindeutig
  passt; eine bereits vorhandene Zuordnung wird nie überschrieben. Läuft
  sequenziell (mit Stop-Button) statt parallel über alle unvollständigen
  Einträge, damit "Stop" jederzeit sauber zwischen zwei Einträgen greift.
  Analog zum Kapitel-Generator (s. o.) speichert die App dabei automatisch
  **im Hintergrund alle 50 verarbeitete Einträge eine Zwischenversion** von
  `app.massFiles` (als Liste sichtbar, kein echter Ordner) – mit
  **"Wiederherstellen"**, falls ein langer Lauf abbricht oder unerwünschte
  Zwischenstände übernommen wurden. **Performance**: während des Laufs wird
  bei einem Treffer nicht mehr die komplette Tabelle neu aufgebaut, sondern
  nur die beiden betroffenen Auswahlfelder der jeweiligen Zeile direkt
  aktualisiert; ein vollständiger Neuaufbau (inkl. korrekter
  Domänen-Gruppierung) erfolgt nur noch periodisch (alle 20 Treffer) sowie
  einmal abschließend – bei vielen hundert Einträgen spürbar schneller als
  zuvor (linearer statt quadratischer Gesamtaufwand über den Lauf).
  Neben Domäne/Kapitel lässt sich je Zeile zusätzlich ein **Unterkapitel**
  wählen (Liste hängt vom gewählten Kapitel ab, Standard "– keine –";
  ändert sich das Kapitel, wird die Unterkapitel-Auswahl zurückgesetzt) –
  dient als Grundlage der neuen Spalte **"Ref.-Nr."**: eine automatisch
  erzeugte, stabile Referenz-Nummer im Format
  "`<Domänen-Kürzel>-<Kapitelnr>.<Unterkapitelnr>-<Jahr>-<laufende Nummer>`"
  (z. B. "CM-04.01-2024-003"), mit der sich aus einem fertigen Text wieder
  auf das ursprüngliche Jira-Ticket zurückschließen lässt. Nur bei
  **ticketbasierten** Einträgen (über "Tickets übernehmen" hinzugefügt)
  ermittelbar – hochgeladene/eingelesene Inhalte ohne 1:1-Ticketbezug
  zeigen ehrlich "–" statt eine erfundene Nummer. Das Domänen-Kürzel kommt
  aus einer neuen Stammdaten-Tabelle (Einstellungen → Domänen-Kürzel,
  automatischer Vorschlag aus den Wortanfängen der Domäne, z. B. "Contract
  Management" → "CM", frei überschreibbar bei Kollisionen). Eine einmal
  vergebene Nummer bleibt stabil (auch nach erneutem Zuordnen derselben
  Kombination oder einem Sitzung-speichern/laden-Zyklus) und wird
  automatisch an jeden Textschnipsel im Domänen-MD-Export sowie im
  Gesamtdokument ("Zusammenfassung je Kapitel") als Zeile "_Referenz: ...
  (Jira: ...)_" angehängt. Dieselbe Referenz-Nummer-Logik liefert außerdem
  die **"Quellen"-Fußzeile**, die der Benutzerhandbuch-Kapitel-Generator
  und die RAG-Zusammenfassung/der Fließtext (Verarbeitung → 7. RAG) an
  ihren erzeugten Text anhängen: dort fließen pro Kapitel/Lauf mehrere
  Tickets in EINEN KI-Fließtext ein (keine 1:1-Zuordnung je Satz), daher
  eine gesammelte Liste aller Quell-Tickets mit Referenz-Nummer am Textende
  statt einer Nummer je Absatz.
  Zusätzlich lässt sich jede Zeile per **Checkbox** auswählen – über
  **"Alle auswählen"**, **"Auswahl aufheben"** oder **"Alle auswählen mit
  Name \*"** (einfaches Namensmuster mit `*`/`?` als Platzhalter, z. B.
  `Kapitel-*`, additiv zur bestehenden Auswahl) – und die Auswahl per
  **Massenzuordnung** (Domäne-/Kapitel-Dropdown + "Auf Auswahl anwenden")
  auf einen Schlag einer Domäne/einem Kapitel zuordnen. Anders als die
  vorsichtige heuristische/KI-Zuordnung (füllt nur leere Felder)
  überschreibt die Massenzuordnung bewusst auch eine bereits vorhandene
  Zuordnung – eine gezielte, manuelle Nutzeraktion auf einer selbst
  gewählten Auswahl. Sowohl **"KI-Zuordnung"** als auch **"Zusammenfassung
  je Kapitel"** (s. u.) zeigen während der Verarbeitung eine kleine
  drehende **Sanduhr** im Button, damit erkennbar bleibt, dass die App
  gerade arbeitet. Als dritter Schritt lässt sich mit dem Button
  **"Zusammenfassung je Kapitel erzeugen"** die gesamte Massenverarbeitung
  zu **einem** Textfile zusammenführen (eigenständiges Gegenstück zu "Alle
  zusammenführen" in der RAG-Bibliothek, s. u.): alle einzelnen
  MD-Textschnipsel werden sortiert nach Domäne, darunter je Kapitel in
  Gliederungsreihenfolge, aneinandergehängt. Das Ergebnis lässt sich direkt
  im Textfeld nachbearbeiten und als Textdatei speichern; der bearbeitete
  Stand ist Teil der Sitzung (Speichern/Laden, "Alle Daten löschen").
- **Verarbeitung** – sieben Jobs für wiederkehrende Arbeitsschritte rund
  um die geladenen Tickets, erreichbar über die Tab-Leiste oder das kompakte
  Burger-Menü (☰) daneben. Jeder Job zeigt oben seine **Prozessschritte**
  als visuelle Checkliste (grauer Kreis = ausstehend, grüner Haken =
  erledigt, roter Kreis = Fehler bei der Ausführung) und lässt sich
  komplett als **XLSX, DOCX oder PDF exportieren**. Der erste Schritt
  ("Datei(en) ausgewählt/importiert") trägt einen **🔄 Aktualisieren**-Button
  und lässt sich über einen Pfeil zu einer Unteraktivität **"Datei(en)/Liste(n)
  auswählen"** aufklappen: eine Mehrfachauswahl (Checkboxen statt
  Einzelauswahl) aus allen Importen (📄-Icon) UND allen in der Listenauswahl
  gespeicherten Listen (📋-Icon), immer als echte Auswahlmöglichkeit
  angezeigt (auch wenn aktuell nur eine Datei vorhanden ist). Werden ein
  oder mehrere Importe und/oder Listen gewählt, schränken die Jobs 3-7 ihre
  Tabellen/Exporte/Auswertungen auf die Vereinigung von deren Tickets ein,
  statt auf den über alle Importe zusammengeführten Stand – "Alle Importe"
  (Standard, hakt bei Auswahl automatisch alle Einzelauswahlen wieder ab)
  zeigt wieder alles. Der **🔄 Aktualisieren**-Button löscht (nach
  Bestätigung) alle bisher berechneten Zwischenergebnisse dieser Sitzung
  (Glossar-/Abkürzungs-Extraktion, Release-Abgleich, Benutzerhandbuch-
  Bewertung, RAG-Rohdaten und -Text) – die Importe/Tickets selbst bleiben
  dabei erhalten – sodass sich die Verarbeitung mit einer neuen Datei-/
  Listen-Auswahl sauber neu starten lässt.
  1. *Jira Verarbeitung* – chronologisches Protokoll aller Import-/Export-Aktionen.
     Über den Button **"Protokoll leeren"** (mit Sicherheitsabfrage) lässt
     sich nur das Protokoll selbst löschen – anders als "Alle Daten löschen"/
     "Sitzung zurücksetzen" bleiben Tickets, Imports und alle übrigen
     Zwischenergebnisse dabei unberührt. Der Löschvorgang wird danach selbst
     als neuer erster Eintrag protokolliert.
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
     tatsächlich vorkommende Werte gelistet; zusätzlich zeigt die
     Abkürzungs-Tabelle je Kürzel einen unverbindlichen Vorschlag für die
     deutsche und englische Bedeutung (kuratierte Liste bekannter
     IT-/Business-Kürzel) – bei firmenspezifischen oder mehrdeutigen
     Kürzeln bleibt das Feld bewusst leer ("–") statt geraten zu werden.
     Ergebnisse erscheinen zusätzlich in den neuen Registern **Glossar**
     (Abschnitt "Aus Ticket-Daten erkannte Begriffe") und **Abkürzungen**.
     Zwei Erweiterungen hierzu: (a) ein eigener Bereich
     **"Synonym-Kandidaten"** ("Suche weitere Synonyme") – dieselbe
     Stichwort-Extraktion wie bei den bestehenden Label-Kandidaten, aber
     gegen das Register **Synonyme** abgeglichen statt gegen Labels; ein
     Klick auf **"In Synonyme übernehmen"** legt den Begriff dort direkt
     als neuen Hauptbegriff an (bereits übernommene oder schon im
     Register vorhandene Begriffe erscheinen bei erneuter Extraktion
     nicht noch einmal als Kandidat). (b) die unverbindlichen
     Deutsch-/Englisch-Vorschläge der Abkürzungs-Tabelle bekommen einen
     Button **"In Abkürzungs-Übersetzungen übernehmen"**, der sie fest im
     Register **Abkürzungen → Manuell gepflegte Übersetzungen**
     speichert (dort zusätzlich um die neue Spalte **"Bedeutung
     (Deutsch)"** erweitert); ein bereits dort fixierter Eintrag wird
     dabei nicht überschrieben, sondern es erscheint ein entsprechender
     Hinweis.
  4. *Releaseversion* – tabellarische Übersicht aller geladenen Tickets
     mit Beschreibung (direkt neben dem Ticket-Schlüssel), Typ, Domäne,
     Priorität (Punkte) und Labels, ein Abgleich
     gegen eine eigene Release-Ticketliste (ein Key pro Zeile, zeigt
     fehlende Tickets, Web-App-Pendant zu `match-release` aus dem
     CLI-Tool) sowie eine Bewertung, welche Tickets anhand des Jira-Feldes
     "Typ" als Benutzerhandbuch-Kandidat gelten und welche nur intern/Bug
     sind (fehlt der Typ im Export, wird das als "Unbekannt" ausgewiesen
     statt geraten).
  5. *Jira Liste* – alle importierten Jira-Nummern mit Beschreibung (direkt
     daneben), Typ, Status, Datum, Domäne, Priorität (Punkte) und Labels, inklusive
     prominent angezeigter Gesamtanzahl der importierten Tickets.
  6. *Domänen-Übersicht* – alle geladenen Tickets werden thematisch nach
     Domäne gruppiert (eine eigene "Thema"-Kennzeichnung gibt es im
     Jira-Export nicht, die Domain ist die vorhandene thematische
     Einordnung) und innerhalb jeder Domäne chronologisch zusammengeführt
     (ältestes zuerst, nach letztem Aktualisierungs-, ersatzweise
     Erstellungsdatum); Domänen selbst alphabetisch, Tickets ohne Domäne
     bilden eine eigene Gruppe am Ende, zusätzlich mit Typ, Beschreibung,
     Priorität (Punkte) und Labels je Ticket. Export als XLSX/DOCX/PDF
     liefert dieselbe Gruppierung als einen eigenen Abschnitt pro Domäne.

  Die Spalte **Typ** (Jobs 4-6 sowie das Dashboard) zeigt das rohe
  Jira-Feld "Typ" (issue_type, z. B. Epic/Story/Feature/Bug) unverändert;
  fehlt es im Export, erscheint ehrlich "–" statt eines geratenen Werts.
  Die Spalten **Priorität (Punkte)** und **Labels** in Jobs 4-6 werden
  automatisch beim Verarbeiten befüllt (siehe Einstellungen unten):
  Priorität aus dem konfigurierbaren Punkte-System je Tickettyp (Jira-Feld
  "Typ"), Labels per reinem Text-Abgleich der konfigurierten Labelliste
  gegen Zusammenfassung/Beschreibung/Domäne des Tickets – keine KI, und
  fehlt ein Tickettyp im Punkte-System, wird ehrlich "Unbekannt" statt
  geraten angezeigt.
  7. *RAG: Zusammenfassung & Fließtext* – hat wie Jobs 1-6 eine eigene
     "Datei auswählen"-Prozessschritt-Karte (unabhängig von der Auswahl in
     anderen Jobs). Zweistufig. Schritt 1
     (**Retrieval**, rein deterministisch): Rohdaten (Überschrift +
     Beschreibung) der aktuell ausgewählten Datei nach Domäne, Status,
     **Label-Themengebiet** und **Gliederungskapitel** (Benutzerhandbuch)
     filtern (alle Mehrfachauswahl, kombinierbar) und als Tabelle anzeigen –
     die Gliederungskapitel-Auswahl listet dabei IMMER alle Kapitel der
     Benutzerhandbuch-Gliederung (Einstellungen), auch solche, denen aktuell
     noch kein Ticket zugeordnet ist (z. B. um das gezielt festzustellen),
     statt sich auf bereits "getroffene" Kapitel zu beschränken –
     Label-Themengebiet/Gliederungskapitel sorgen dafür, dass sich die
     Generierung gezielt auf ein Thema bzw. ein Kapitel eingrenzen lässt,
     statt Text aus allen Tickets zu vermischen; zeigt
     nur unverändert vorhandene Ticket-Daten, "–" bei fehlendem Text; die
     Rohdaten-Tabelle lässt sich wie bei Jobs 1-6 als XLSX/DOCX/PDF
     exportieren. Über den Button **"RAG-Daten löschen"** (mit
     Sicherheitsabfrage) lassen sich extrahierte Rohdaten und generierter
     Text/Übersetzung gemeinsam löschen – anders als "Alle Daten löschen"/
     "Sitzung zurücksetzen" bleiben Tickets, Imports und alle übrigen
     Verarbeitungsergebnisse dabei unberührt. Schritt 2 (**Generation**, echte KI): mit den Buttons "Zusammenfassung
     generieren" bzw. "Fließtext generieren" schickt die App die
     extrahierten Rohdaten über die `sample`-Laufzeit-Capability an Claude
     und lässt daraus einen endnutzergerechten Text schreiben (Live-Streaming
     der Antwort, Stop-Button, danach als Markdown speicherbar). Direkt
     daneben löscht der Button **"Löschen"** (mit Sicherheitsabfrage) nur
     den generierten Text/die Übersetzung – die extrahierte Rohdaten-Tabelle
     aus Schritt 1 bleibt dabei erhalten (anders als "RAG-Daten löschen",
     das beides gemeinsam löscht). Diese
     Funktion ist die einzige Stelle in der App, die echte KI-Textgenerierung
     nutzt (sonst ausschließlich deterministische Logik). Wie beim
     Benutzerhandbuch-Kapitel-Generator wird der Text durchgängig im
     **Präsens** verlangt (Gegenwartsform statt Präteritum/Futur) – der
     Releaseletter selbst (s. u.) verwendet dagegen ausschließlich
     deterministische Textbausteine direkt aus den Ticket-Feldern, keine
     freie KI-Formulierung, daher ist dort keine Zeitform-Vorgabe nötig.
     Diese Funktion ist nur
     innerhalb der veröffentlichten Claude-Artifact-Version verfügbar (nicht
     bei lokalem Öffnen der Datei), fragt beim ersten Aufruf um Zustimmung,
     kostet die Nutzung des Viewer-Kontos und liefert bei Fehlern
     (Ablehnung, Rate-Limit, keine Rohdaten, …) eine verständliche
     Meldung statt eines Absturzes. Ergebnis ist klar als KI-generiert
     gekennzeichnet und redaktionell zu prüfen. Verarbeitet bis zu **50000
     Tickets pro Durchlauf**: passen die Rohdaten in ein Zeichen-Budget,
     läuft wie zuvor ein einzelner Claude-Aufruf; sonst teilt die App sie
     automatisch in mehrere Batches auf ("Batch 1 von N", "Batch 2 von N"
     usw., aus der aktuellen Auswahl/Extraktion), lässt Claude je Batch
     einen Teiltext schreiben und führt diese am Ende in einem letzten
     Aufruf zu einem einzigen, redundanzbereinigten Endtext zusammen
     (Map-Reduce) – darüber (mehr als 50000 Tickets) lehnt die App die
     Generierung mit einer verständlichen Meldung ab, statt einen zu großen
     Prompt an Claude zu schicken. RAG als Herzstück der Verarbeitung: bei
     mehreren Batches wird jeder fertige Teilschritt intern als eigene
     Markdown-Datei gehalten (im Batch-Protokoll unterhalb der
     Generieren-Buttons live sichtbar, inkl. Zeichen-/Tokenschätzung je
     Batch) und lässt sich jederzeit – auch während ein Lauf noch läuft
     oder angehalten ist – als ZIP herunterladen (alle Teilschritt-Dateien
     plus, nach Abschluss, eine zusammenführende Gesamt-Zusammenfassungs-
     Datei). Ein laufender Batch-Durchlauf lässt sich per **Stop**-Button
     jederzeit anhalten, ohne bereits fertige Batches zu verwerfen; ein
     **"Fortsetzen"**-Button setzt exakt beim nächsten offenen Batch fort
     (kein erneutes Abfragen bereits abgeschlossener Batches). Nach jeder
     Generierung zeigt die App einen **geschätzten Tokenverbrauch**
     (Eingabe/Ausgabe, grobe Zeichen-basierte Schätzung ~4 Zeichen/Token) –
     die `sample`-Laufzeit-Capability liefert keine echte Token-/
     Nutzungszahl, daher bewusst als Schätzung ausgewiesen statt eine
     exakte Zahl vorzutäuschen. Ein neuer **"Übersetzen (Englisch)"**-Button
     übersetzt den zuletzt generierten Text per Claude ins Englische; ein
     erneuter Klick schaltet ohne weitere KI-Anfrage zum
     zwischengespeicherten deutschen Original zurück. Der Download als
     Markdown berücksichtigt die aktuell angezeigte Sprache
     (Dateiname/Inhalt).
- **Releaseletter / Benutzerhandbuch** – Textentwürfe aus ausgewählten
  Tickets (aktuelle Dashboard-Filterung oder Ticket-Keys), Vorschau +
  Download als Markdown, DOCX, PDF oder XLSX (Tickets-Tabelle mit
  Domäne/Status/Priorität-Punkte/Labels/Beschreibung). Jede Zeile im
  Entwurf zeigt zusätzlich, sofern vorhanden, Domäne, Priorität (Punkte)
  und automatisch erkannte Labels des jeweiligen Tickets (dieselbe
  Herleitung wie in Verarbeitung Job 4-6, siehe Einstellungen). DOCX/PDF
  werden direkt im Browser erzeugt (minimales OOXML über das bereits
  geladene JSZip bzw. jsPDF) – kein Server nötig.
- **Benutzerhandbuch – Kapitel-Generator (KI-Fließtext je Gliederungskapitel)**
  – zusätzlich zum Rohgerüst oben: analog zu RAG (Verarbeitung → 7. RAG),
  aber mit **Domäne/Label-Themengebiet/Gliederungskapitel** als Filter
  (Datei-Scope kommt von der bestehenden globalen "Datei(en)/Liste(n)
  auswählen"-Einschränkung, Verarbeitung Prozessschritt 1) – die
  Gliederungskapitel-Auswahl listet dabei IMMER alle Kapitel der
  Benutzerhandbuch-Gliederung (Einstellungen), auch solche ohne aktuell
  zugeordnete Tickets. Ein Klick auf
  **"Kapitel erstellen"** generiert je ausgewähltem Kapitel (oder, ist kein
  Kapitel aber eine Domäne gewählt, für **alle** Kapitel dieser Domäne)
  über Claude (sample-Capability) einen sachlichen, professionellen
  Fließtext im Softwarehandbuch-Stil für Fachanwender, mindestens 3,
  idealerweise bis zu 12 DIN-A4-Seiten – nutzt dabei einen reichhaltigeren
  Ticket-Datensatz als die RAG-Kurzfassung (zusätzlich Typ und
  automatisch erkannte Labels). Sehr umfangreiche Kapitel werden wie bei
  RAG per Zeichen-Budget in mehrere Teil-Durchläufe zerlegt und
  anschließend zu einem Text zusammengeführt (Map-Reduce). Inhalte, die
  ausschließlich für PKW/Van/einen Marktumfang gelten, werden mit den
  Tags "[Nur PKW]"/"[Nur Van]"/"[Nur Markt]" gekennzeichnet; zusätzlich
  kennzeichnet der Text, wo inhaltlich wirklich zutreffend (nicht
  erzwungen), wichtige Sicherheitshinweise/Warnungen mit "[Warnung]",
  hilfreiche Zusatzinformationen mit "[Hinweis]", praktische Tipps für
  den Arbeitsalltag mit "[Tipp]" sowie Querverweise auf andere Kapitel/
  Abschnitte mit "[Verweis]". Wo sich die
  Bedienung je Rolle unterscheidet, gliedert der Text mit eigenen
  Zwischenüberschriften "Retail"/"Markt"/"HQ"/"Sparte"/"MO" (Market
  Operation) und weist explizit auf Features hin, die dem Retail nicht
  zur Verfügung stehen. Alle 7 Tags sowie die Rollen-Zwischenüberschriften
  bleiben auch beim Zusammenführen sehr langer Kapitel (Map-Reduce)
  erhalten. Die Anweisung selbst ist unter Einstellungen →
  RAG-Prompts editierbar ("Benutzerhandbuch-Kapitel erstellen") – **und
  zusätzlich direkt hier** über den einklappbaren Bereich
  "KI-Anweisung (Prompt) für Kapitelerstellung/-zusammenführung
  anzeigen/bearbeiten" oberhalb von "Kapitel erstellen" (geteilter Zustand,
  beide Stellen bleiben synchron – praktisch, um den Prompt direkt am Ort
  der Nutzung anzupassen, ohne extra in die Einstellungen zu wechseln).
  Während ein Lauf arbeitet, zeigen Sanduhr (Spinner) und ein Statusbalken
  den Fortschritt ("Kapitel X von Y") zusätzlich zur Textstatuszeile.
  Ergebnis
  je Kapitel: editierbares Textfeld (im Browser gespeichert, übersteht
  Navigation, wird über Sitzung speichern/laden mit exportiert, aber bei
  "Alle Daten löschen"/"Sitzung zurücksetzen" geleert), ein
  "Ins Englische übersetzen"-Button (identischer Übersetzungs-Mechanismus
  wie bei RAG) sowie Export **"Als Markdown"/"Als PDF"/"Als Word"** – PDF/
  Word in einem eigenständigen, professionell formatierten Layout
  (Kapitel-Titel als Überschrift, "## "-Zwischenüberschriften als echte
  Word-Überschriften/fette PDF-Zwischentitel, alle 7 Tag-Zeilen
  ("[Nur PKW]"/"[Nur Van]"/"[Nur Markt]"/"[Warnung]"/"[Hinweis]"/"[Tipp]"/
  "[Verweis]") farbig/fett UND zusätzlich farbig hinterlegt
  (Word-Absatzschattierung bzw. PDF-Füllrechtecke je Tag-Typ in einem
  eigenen Farbton), ebenso der Fließtext innerhalb eines Rollen-Abschnitts
  ("## Retail" usw., je Rolle ein eigener dezenter Hintergrundton) –
  bewusst keine Bild-Icons/Emoji in PDF/Word, da jsPDFs Kernschriftart
  deren Glyphen nicht zuverlässig unterstützt. In der **Lese-Vorschau**
  ("Vorschau (Icons)"-Umschalter neben Deutsch/English) werden dieselben
  Tags dagegen mit echten Emoji-Icons (🚗/🚐/🏬/⚠️/ℹ️/💡/🔗) UND jeweils
  als eigene abgetrennte Box dargestellt; ein Rollen-Abschnitt rahmt dort
  zusätzlich alle zugehörigen Absätze bis zur nächsten Überschrift in
  einer eigenen Box, damit sparten-/rollen-/marktspezifische Inhalte auf
  einen Blick erkennbar sind, ohne den gespeicherten Rohtext zu verändern
  (Bearbeitung bleibt über Deutsch/English als Rohtext möglich). Alle
  Box-/Schattierungsfarben sind bewusst aus den bereits vorhandenen
  Status-/Akzentfarben des App-Farbschemas abgeleitet (keine neue Palette).
  Unterhalb aller Kapitel-Karten fasst die
  **Kapitel-Übersicht** jedes im aktuellen Lauf erzeugte Kapitel in einer
  kompakten Tabelle zusammen (Titel/Wörter/Tickets/Erzeugt), mit einem
  "MD herunterladen"-Button je Zeile sowie **"Alle als ZIP herunterladen"**
  (je Kapitel eine eigene .md-Datei in einem ZIP) für den schnellen
  Gesamtüberblick ohne jede Karte einzeln aufklappen zu müssen.
  **Gruppierung**: wahlweise "Nach Kapitel" (Standard, wie oben) oder "Nach
  Label-Themengebiet" – dann ein eigener Text je Label-Themengebiet (Karten-
  Titel z. B. "Zahlung & Rechnung (Label-Themengebiet)") statt je
  Gliederungskapitel, auf Basis derselben Filter/Tickets. Bei mehr als 20 in
  einem Lauf fertiggestellten Kapiteln/Labels erscheint zusätzlich zu den
  Einzel-Protokolleinträgen alle 20 Stück ein gebündelter
  "Zwischenstand"-Eintrag im Protokoll (Verarbeitung), damit sehr große Läufe
  nicht mit Einzelzeilen fluten. **Versionierung**: erneutes Erzeugen für ein
  bereits vorhandenes Kapitel/Label überschreibt die bisherige Fassung nicht,
  sondern legt sie mit Name (Standard: Zeitstempel, frei umbenennbar) und
  Datum in einer Versionsliste ab ("Versionen (N)", aufklappbar) – dort pro
  Version einsehbar ("Text anzeigen", schreibgeschützt zum Vergleich mit der
  aktuellen Fassung) und einzeln **wiederherstellbar** (die bis dahin aktuelle
  Fassung wird dabei selbst zur neuen Version, kein Datenverlust). Begrenzt
  auf die letzten 20 Versionen je Kapitel/Label. Der Fließtext wird
  durchgängig im **Präsens** verlangt (Gegenwartsform statt Präteritum/
  Futur). Zusätzlich zur normalen Versionierung speichert die App bei sehr
  langen Läufen (viele hundert Teil-Durchläufe bei einem einzelnen großen
  Kapitel, s. o.) automatisch **im Hintergrund alle 50 Durchgänge eine
  Zwischenversion** – ein vollständiger Schnappschuss aller bis dahin
  erzeugten Kapitel/Labels, damit bei einem Absturz/Abbruch nicht der
  gesamte Fortschritt verloren geht. Ohne gewählten Zielordner (s. u.) gibt
  es dafür **keinen echten Ordner**, da die App rein im Browser läuft: die
  Zwischenversionen erscheinen stattdessen als Liste direkt unter dem
  Statustext, mit **"Wiederherstellen"** (ersetzt den aktuellen
  Entwurfsstand) und **"Als ZIP herunterladen"** (ein .md je Kapitel) je
  Eintrag; Teil der Sitzung (Speichern/Laden, "Alle Daten löschen").
  **Zielordner wählen (optional)**: außerhalb der Claude-Artifact-Vorschau
  (z. B. direkt in Chrome/Edge geöffnet) lässt sich über die File System
  Access API ein lokaler Ordner auswählen – danach wird **jedes fertige
  Kapitel sofort** als eigene .md-Datei dort abgelegt (Dateiname wie die
  Kapitel-/Label-Bezeichnung, z. B. "Kapitel_4_Servicevertrag_anlegen.md"),
  ohne auf das Ende des gesamten Laufs zu warten. Der Ordner-Handle ist
  bewusst kein Sitzungsdatensatz (nicht serialisierbar, Browser-Berechtigung
  gilt ohnehin nur für die aktuelle Seite) und wird bei "Sitzung
  zurücksetzen"/"Alle Daten löschen" vergessen. Unabhängig davon lässt sich
  jederzeit über **"Alle Kapitel zusammenführen"** (unterhalb der
  Kapitel-Liste) der komplette bisherige Entwurfsstand zu einem
  Gesamtdokument in Gliederungsreihenfolge zusammensetzen – editierbar, als
  Datei herunterladbar und bei gewähltem Zielordner zusätzlich automatisch
  als "Gesamtdokument.md" dort gespeichert. Je Kapitel steht außerdem der
  Button
  **"Qualitätsprüfung (Grammatik/Lücken/Verbesserungen)"** zur Verfügung:
  ein separater, gezielt (auch wiederholt) auslösbarer KI-Durchgang NACH der
  Texterstellung, der den fertigen Text auf Grammatikfehler, inhaltliche
  Lücken und Verbesserungsvorschläge prüft und als dreigeteiltes Ergebnis
  unter dem Kapitel anzeigt. Oberhalb der Kapitel-Liste führt der Button
  **"Alle prüfen (Qualitätsprüfung)"** dieselbe Prüfung sequenziell (mit
  Stop-Button, analog zur KI-Zuordnung in der Massenverarbeitung) über
  **alle** vorhandenen Kapitel/Labels auf einmal aus, statt sie einzeln
  anstoßen zu müssen. Ein dritter Ansichts-Umschalter
  **"Vorschau (Icons)"** (neben "Deutsch"/"English") rendert denselben Text
  schreibgeschützt mit Icons: die Rollen-Zwischenüberschriften
  "Retail"/"Markt"/"HQ"/"Sparte"/"MO" bekommen ein Rollen-Icon, die
  "[Nur PKW]"/"[Nur Van]"/"[Nur Markt]"-Scope-Tags werden als farbiges
  Icon-Badge statt als roher Text dargestellt – macht rollen-/
  fahrzeugspezifische Abschnitte auf einen Blick sichtbar, ohne den
  bearbeitbaren Rohtext zu verändern. **Performance**: sowohl bei "Kapitel
  erstellen" als auch bei "Alle prüfen" wird die Kapitel-Liste nicht mehr
  bei jedem einzelnen Kapitel komplett neu aufgebaut – die Qualitätsprüfung
  aktualisiert nur noch die betroffene Karte direkt, die Erstellung baut
  die Liste nur noch periodisch (alle 20 Kapitel) sowie einmal abschließend
  neu auf; zusätzlich wird die Ticket-Auswahl für den Lauf nur noch einmal
  statt je Kapitel neu berechnet – bei vielen Kapiteln in einem Lauf
  spürbar schneller.
  **Automatische KPI-Bewertung** (neu, v2.77.0): direkt nach jeder
  Kapitel-Erzeugung (nicht bei "Alle prüfen" – das bleibt die separate
  Grammatik-/Lücken-Qualitätsprüfung) bewertet ein zusätzlicher, eigener
  KI-Aufruf den frisch erzeugten Text gegen die 3 KPI-Kriterien Quellenabdeckung/
  Prüf-Erfüllungsquote/Kritische Befunde (dieselbe Methodik wie im
  Arbeitsblatt "KPI_Definitionen" einer oneSCM-Excel-Matrix) und befüllt
  damit automatisch die **Steuerung & KPI**-Felder (Einstellungen →
  Gliederung & Steuerung) des zugehörigen Kapitels inklusive Prüf-Gate –
  ohne das händisch nachtragen zu müssen. Gilt nur für Kapitel-Gruppen
  (nicht für Label-Themengebiete, da Steuerung & KPI an Gliederungskapitel
  gebunden ist); eine unparsebare KI-Antwort überschreibt bestehende Werte
  nicht und bricht die Kapitel-Erstellung selbst nicht ab (eigener
  Protokoll-Hinweis statt Fehler-Toast).
  **Nicht mehr zugeordnete Kapitel austauschen** (neu, v2.77.0): lädt man
  über Einstellungen eine neue Excel-Matrix mit geänderter Gliederung hoch,
  werden bereits erzeugte Kapitel-Texte seitdem **nicht mehr automatisch
  gelöscht** (anders als zuvor), auch wenn ihr alter Titel in der neuen
  Gliederung nicht mehr vorkommt. Ein neuer Bereich "Nicht mehr
  zugeordnete, bereits generierte Kapitel" oberhalb der Kapitel-Liste zeigt
  solche "verwaisten" Kapitel mit einer Ziel-Auswahl aus der aktuellen
  Gliederung: **"Übernehmen"** verschiebt den alten Text auf das gewählte
  neue Kapitel (ersetzt dessen vorhandenen Entwurf unwiderruflich, alte
  Version landet in dessen Verlauf) oder **"Verwerfen"** löscht den
  verwaisten Eintrag endgültig. Bis dahin bleibt das verwaiste Kapitel ganz
  normal in der regulären Kapitel-Liste sichtbar/editierbar/exportierbar.
  **Neuer Navigationsbereich "Editor": Screens aus Word/PowerPoint
  extrahieren** (neu, v2.82.0): lädt Dateien mit Screens je Domäne
  (Überschrift + Bildschirmfoto, z. B. aus Word (.docx) oder PowerPoint
  (.pptx)) hoch – auch Exporte der separaten Screenrecorder-App, da diese
  laut Angabe ebenfalls Word/PowerPoint liefert und somit dieselbe
  Extraktion durchläuft, ohne eigene Pipeline. Die enthaltenen
  Bildschirmfotos werden automatisch erkannt (eingebettete Bilder über die
  OOXML-Beziehungen aufgelöst), nach ihrer Reihenfolge im Dokument
  nummeriert und mit dem jeweils zugehörigen Überschriften-/Folientiteltext
  als "Bildtext" versehen (bei Word: die zuletzt gesehene Überschrift bzw.
  der eigene Absatztext; bei PowerPoint: der Titel-Platzhalter der Folie).
  Eine Datei-Übersichtstabelle zeigt Dateiname, Typ (Word/PowerPoint),
  Domäne, Status und Anzahl extrahierter Screens je Datei, mit Löschen
  (entfernt dabei auch die zugehörigen Screens). Eine zweite Tabelle zeigt
  alle extrahierten Screens mit Vorschau, Bildnummer, Bildtext, Quelldatei,
  Domäne und einem Kapitel-Dropdown zur Zuordnung – wahlweise von Hand oder
  per **KI-Vorschlag** (analog zur "KI-Zuordnung" in der
  Massenverarbeitung): Claude schlägt anhand von Bildtext und Domäne ein
  passendes Gliederungskapitel vor, wörtlich aus der vorhandenen
  Gliederung, überschreibt dabei nie eine bereits gesetzte Zuordnung und
  lässt diese im Zweifel offen. Technisch nutzen die extrahierten Screens
  dieselbe Datenstruktur wie die bestehende "Bilder"-Galerie (keine
  doppelte Datenhaltung) und erscheinen deshalb automatisch auch dort.
  **Neuer Navigationsbereich "Bildband": Screens in den Benutzerhandbuch-
  Export einbetten** (neu, v2.83.0): verbindet die im Screens-Import-Register
  zugeordneten Screens mit dem im Benutzerhandbuch-Kapitel-Generator
  erzeugten Text. Dafür den Platzhalter `[Bild]` als eigene Zeile an der
  gewünschten Stelle im Kapiteltext einfügen – jedes Vorkommen wird in der
  Lese-Vorschau ("Vorschau (Icons)") sowie im DOCX- und PDF-Export durch
  das jeweils nächste diesem Kapitel zugeordnete Bild ersetzt (Reihenfolge:
  Quelldatei, dann Bildnummer aus dem Screens-Import-Register), inklusive
  automatischer Bildunterschrift "Abbildung N: &lt;Bildtext&gt;". Im DOCX-
  Export wird dabei ein echtes eingebettetes Bild erzeugt (OOXML-Relationship
  + Media-Datei im ZIP, kein bloßer Verweis), im PDF-Export über
  `jsPDF.addImage()` unter Beibehaltung des tatsächlichen Seitenverhältnisses
  des Bildes. Das neue Register zeigt je Kapitel eine Übersicht mit Anzahl
  Platzhalter im Text, Anzahl zugeordneter Screens, Status ("passt genau"/
  "Bild(er) fehlen"/"Bild(er) überschüssig"), Vorschau-Thumbnails sowie
  direkte DOCX-/PDF-Export-Buttons (dieselben wie im Benutzerhandbuch-
  Register – die Bildeinbettung wirkt überall dort automatisch mit, wo ein
  Kapiteltext exportiert wird). Zusätzlich lässt sich im Screens-Import-Register je
  Screen nun auch ein **Unterkapitel** zuordnen (dient nur der eigenen
  Übersicht/Filterung – die Platzhalter werden technisch pro Kapitel,
  nicht pro Unterkapitel-Abschnitt im Text, befüllt).
  **Bugfix (v2.81.0): Kapitel-Erstellung begann immer bei "Kapitel 4"
  statt bei "Willkommen"** – ist keine einzelne Domäne, sondern **alle**
  verfügbaren Domänen ausgewählt ("Alle auswählen"), wurden Gliederungs­
  kapitel ohne eigene Domänen-Zuordnung (z. B. "Willkommen",
  "Inhaltsverzeichnis", allgemeine Einführungskapitel) bisher bei JEDER
  Domänen-Auswahl dauerhaft aus der Kandidatenliste ausgeschlossen – die
  Kapitel-Erstellung begann dadurch immer beim ersten domänen-zugeordneten
  Kapitel statt wie in der aktuellen Gliederung nummeriert bei "Willkommen"
  zu starten. Domänenlose Kapitel gelten jetzt bei "Alle auswählen" als
  domänenübergreifend und werden korrekt als Kandidaten berücksichtigt
  (und – mangels Tickets, da ihnen ohne Domäne grundsätzlich kein Ticket
  zugeordnet werden kann – ehrlich als "übersprungen (keine passenden
  Tickets)" angezeigt, statt stillschweigend zu verschwinden). Bei einer
  einzelnen/eingeschränkten Domänen-Auswahl bleibt das bisherige, engere
  Verhalten unverändert.
  **Qualitätsprüfung-Dashboard + 3 Verbesserungs-Varianten** (neu, v2.78.0):
  nach einer durchgeführten Qualitätsprüfung erscheint unter dem
  dreigeteilten Ergebnis ein kleines Dashboard mit der aktuellen Wortanzahl
  sowie – sofern das Kapitel einer Gliederungs-Nummer zugeordnet ist – den
  Steuerung & KPI-Werten (Quellenabdeckung/Prüf-Erfüllungsquote/Kritische
  Befunde/Gate). Darunter stehen 3 neue Buttons, die den Kapiteltext für
  eine andere Zielgruppe neu schreiben und dabei die
  Verbesserungsvorschläge der Qualitätsprüfung einarbeiten – das Ergebnis
  landet in einer **neuen, zusätzlichen, farblich markierten Textbox**
  unterhalb der Karte, der ursprüngliche Kapiteltext bleibt dabei
  unverändert:
  - **😊 Enduser-Text**: aus Sicht eines Endanwenders, flüssiger und
    kompakter formuliert, ohne Floskeln und ohne technische Deep-Dives –
    der Nutzen für den Anwender steht im Fokus.
  - **🛠️ Fachtext**: präzise und technisch, für erfahrene Power-User/
    Administratoren, mit allen relevanten Details.
  - **⚡ Kurzfassung**: stark komprimierte Management-Zusammenfassung (ca.
    ein Viertel der ursprünglichen Länge), nur die wichtigsten
    Kernaussagen.

  Jede Variante bekommt eine eigene Rahmenfarbe und nutzt zur farblichen
  Kennzeichnung/Icon-Darstellung dieselbe Lese-Vorschau-Logik wie die
  bestehenden Pkw/Van/Markt- und Warnung/Hinweis/Tipp/Verweis-Tags sowie
  die Rollen-Zwischenüberschriften. Jeder Button lässt sich beliebig oft
  erneut auslösen ("… neu erzeugen"), ohne die anderen Varianten oder den
  Haupttext zu beeinflussen. Die 3 zugrundeliegenden Prompts sind unter
  Einstellungen → Design einsehbar/editierbar (geteilter Zustand mit der
  allgemeinen RAG-Prompts-Liste), zusammen mit der Icon-/Farblegende der
  3 Varianten.
- **Ergebnisse** (neu, v2.79.0) – eigener Navigationspunkt direkt nach
  "Benutzerhandbuch": Übersichtstabelle **aller** im Benutzerhandbuch-
  Kapitel-Generator erzeugten Dokumente – der Haupttext **und** jede
  bereits erzeugte Verbesserungs-Variante (Enduser-Text/Fachtext/
  Kurzfassung, s. o.) je Kapitel als eigene Zeile, mit Datum, Kapitel,
  Typ (inkl. Icon) und Status (das Steuerung & KPI-Prüf-Gate des
  zugehörigen Gliederungskapitels – dieselbe Quelle wie das KPI-Dashboard,
  kein zweiter, eigener Status-Datensatz; Label-Themengebiete ohne
  Gliederungskapitel zeigen "–"). Jedes Dokument lässt sich direkt aus der
  Zeile heraus einzeln als Markdown oder Word exportieren – für die
  Verbesserungs-Varianten (bisher nur in der Kapitel-Karte lesbar) stehen
  damit erstmals eigene Export-Funktionen zur Verfügung. Darunter eine
  **Designvorlagen-Vorschau**: Farb-/Icon-Legende, die genau die im Word-
  und PDF-Export bereits fest hinterlegte Gestaltung zeigt (Rollen-
  Zwischenüberschriften-Schattierung und Hinweis-/Scope-Tag-Hervorhebung,
  s. "Icons/Boxen"-Export weiter oben) – reine Anzeige der schon
  verwendeten Werte, keine zusätzliche, separate Theming-Konfiguration.
  **Professionelle Schwarz-Weiß-Icons + bessere Lesbarkeit** (neu, v2.80.0):
  alle Rollen-/Scope-/Hinweis-/Varianten-Icons in der Lese-Vorschau, dem
  KPI-Dashboard, der Design-Legende und dem Register "Ergebnisse" sind von
  farbigen Emoji auf monochrome Unicode-Symbole (geometrische Formen/
  Dingbats, z. B. ◆ ■ ▲ ● ▶ für die Rollen, ⚠ ℹ ✎ → für Warnung/Hinweis/
  Tipp/Verweis, ☆ ⚙ Σ für Enduser-Text/Fachtext/Kurzfassung) umgestellt –
  diese Zeichen besitzen keine Emoji-Darstellung und werden daher in jeder
  Standardschrift schwarz/weiß statt farbig gerendert. Zusätzlich wurde die
  Lese-Vorschau selbst leserlicher gestaltet: volle Textkontrastfarbe statt
  des zuvor gedämpften Grautons in Hinweis-/Rollenboxen (diese enthalten
  oft die wichtigsten Inhalte), großzügigerer Zeilenabstand und
  Absatzabstand, begrenzte Textbreite für eine angenehme Zeilenlänge sowie
  deutlichere Zwischenüberschriften mit Trennlinie zum schnellen
  Überfliegen längerer Kapitel. Der Word- und PDF-Export war von den
  farbigen Icons nie betroffen (dort wird ausschließlich mit Farbschattierung
  der Tag-Zeilen gearbeitet, s. o.) und bleibt unverändert.
- **Referenz-Handbuch-Import + Handbuch-Änderung nach Kapitel** – Import →
  eigener Bereich "Referenz-Handbuch" zum Hochladen eines bereits
  bestehenden, veröffentlichten Word-Benutzerhandbuchs (z. B. eine ca.
  200-seitige aktuelle Version) mit frei vergebener Versionsbezeichnung.
  Bewusst **kein Ticket-Import**: die Datei enthält keine Jira-Tickets,
  erscheint daher nicht in Dashboard/Verarbeitung/Dateiverwaltung, sondern
  dient ausschließlich als Vergleichsgrundlage ("alter Stand") für
  Releaseletter/Benutzerhandbuch. Kapitel werden über die
  Word-Formatvorlagen ("Überschrift 1/2/…", auch als interne Style-ID
  "berschrift1" o. Ä.) erkannt – Text vor der ersten Überschrift landet in
  einem eigenen "Vorspann"-Kapitel, ein leeres Vorspann-Kapitel (Dokument
  beginnt direkt mit einer Überschrift) wird nicht mitgezählt. Der erkannte
  Text durchläuft dieselbe musterbasierte PII-Bereinigung wie überall in
  der App. Es können mehrere Versionen parallel gespeichert werden; die
  Auswahl, welche gerade als Vergleichsgrundlage dient, lässt sich jederzeit
  umschalten. Im Benutzerhandbuch (unterhalb des Kapitel-Generators, s.
  oben) ordnet ein neuer Abschnitt "Handbuch-Änderung nach Kapitel" jedes
  erkannte Referenz-Kapitel automatisch einem Kapitel der
  Benutzerhandbuch-Gliederung zu (Vorschlag anhand wortbasierter
  Titel-Ähnlichkeit) – bei zu geringer Ähnlichkeit bewusst **kein**
  Vorschlag (ehrlich anzeigen statt zu raten), stattdessen manuell per
  Dropdown zuordenbar; einmal gesetzte Zuordnungen bleiben bei erneutem
  Rendern erhalten. Ein Klick auf **"Vergleichen"** zeigt "alter Stand"
  (Referenz-Handbuch-Kapitel) und "neuer Stand" (der für das zugeordnete
  Kapitel bereits erzeugte Kapitel-Generator-Text) nebeneinander in zwei
  Textfenstern sowie darunter eine über Claude (sample-Capability)
  erzeugte **Änderungsanalyse** mit den Abschnitten "Neue Features" (im
  neuen Stand beschriebene, im alten Stand fehlende Inhalte) und
  "Widersprüche" (Aussagen im alten Stand, die der neue Stand entkräftet
  oder überholt) – die Anweisung dafür ist unter Einstellungen →
  RAG-Prompts editierbar ("Handbuch-Änderung nach Kapitel"). Setzt voraus,
  dass für das zugeordnete Kapitel oben bereits ein Kapitel-Generator-Text
  erzeugt wurde, sonst erscheint ein verständlicher Hinweis statt eines
  stillen Fehlschlags. Dieselbe Zuordnungstabelle und Vergleichsansicht
  erscheint zusätzlich im Releaseletter – praktisch, um beim Verfassen des
  Releaseletters direkt zu sehen, welche Kapitel sich inhaltlich geändert
  haben. Beide Ansichten teilen sich dieselbe Zuordnung und dasselbe aktive
  Referenz-Handbuch (an einer Stelle geändert, überall aktuell), haben aber
  je ein eigenes, unabhängiges Vergleichsergebnis-Fenster.
- **Rollen-Navigation (oneSCM)** – Einstellungen → eigener Bereich
  "Rollen-Navigation": aus einer vom Nutzer hochgeladenen Navigationsvorlage
  (Bildschirmaufnahmen + Beschriftungen der oneSCM-Menüstruktur) abgeleitete,
  je Rolle **eigenständige** Menü-/Modulliste für **Retail**, **Markt**,
  **MO** (Market Operation) und **HQ** (Headquarters) – reine
  Referenzanzeige, nicht editierbar. "Markt" ist in der Quellvorlage am
  vollständigsten dokumentiert und dient als Basis; für "Retail" ist nur
  eine explizite Einschränkung belegt, für "MO" nur ein einzelner
  Prüfschritt (MO-Check in der Vertragsanlage) und für "HQ" **keine einzige**
  Bildschirmaufnahme. Nicht bzw. nicht vollständig belegte Bereiche sind
  transparent mit einem "Lücke"-Badge und Begründungstext gekennzeichnet,
  statt eine nicht abgesicherte Struktur zu erfinden. Kapitel 13-15 der
  Benutzerhandbuch-Gliederung (Markt-/MO-/HQ-Rolle) zeigen denselben
  Lücke-Hinweis direkt in der Gliederungstabelle. Darauf aufbauend gibt es
  einen **Rollen-Filter**: im Benutzerhandbuch-Kapitel-Generator steuert die
  Rollenwahl eine Zusatzanweisung an die KI (auf für diese Rolle nicht
  verfügbare Funktionen sowie bekannte Dokumentationslücken ausdrücklich
  hinweisen, nicht verschweigen); im Releaseletter fügt eine Rollenwahl
  einen zusätzlichen "Rollenhinweis"-Abschnitt mit den für die Rolle
  relevanten Navigationsbereichen (inkl. Lücken) an – hier bewusst als
  Textbaustein statt als Ticket-Filter, da kein belastbares
  Rolle-zu-Ticket-Datenfeld existiert.
- **Importformat (Spalten je Vorgangstyp)** – Einstellungen → eigener
  Bereich "Importformat": legt je Vorgangstyp (**Epic**, **Feature**,
  **Bug**, **Incident**, **Change Request**) fest, welche Spalten aus dem
  Jira-Export erwartet werden – jede Spalte einzeln **aktivierbar/
  deaktivierbar**, **umbenennbar**, **löschbar**; neue Spalten lassen sich
  einzeln oder per **Mehrfach-Einfügen** (eine pro Zeile, oder Tab-/Komma-
  getrennt – z. B. direkt aus Excel eingefügt) ergänzen. Nur "Change
  Request" ist mit einer echten, ca. 120 Spalten umfassenden Liste (aus
  einem realen Jira-Tabellenexport) vorbefüllt; die anderen 4 Typen starten
  bewusst leer und werden bei Bedarf nachgereicht. Deaktivierte Spalten
  werden beim Einlesen (Einzel-/Massenupload) NICHT übernommen – dieser
  Filter greift NACH der bestehenden automatischen Bereinigung
  personenbezogener Daten (Pseudonymisierung/Redaktion läuft davon
  unabhängig immer zuerst) und kann Daten daher nur **entfernen**, nie die
  Bereinigung umgehen; er wirkt zudem nur auf künftige Importe, nicht
  rückwirkend auf bereits geladene Tickets. Vorgangstyp und Icon werden
  automatisch anhand des Jira-Felds "Vorgangstyp" erkannt (gängige
  deutsche/englische Schreibweisen) und zusammen mit den aktiven Spalten
  zur Grundlage des **Datenprofils** im Dashboard (s. oben).
- **Clickanweisung** – bewusst **kein** Ticket-Protokoll: erzeugt eine
  Bedienungsanleitung für die Benutzung in oneSCM, zusammengestellt aus
  den Beschreibungstexten der ausgewählten Tickets und nach Domäne
  gegliedert (Domäne als Überschrift), **ohne** Jira-Ticket-Referenzen
  (Schlüssel/Zusammenfassung) im Fließtext. Download ebenfalls als
  Markdown/DOCX/PDF; die separate XLSX-Tabelle bleibt bewusst
  Ticket-bezogen (Nachvollzieh-Grundlage für die Redaktion).
- **Clickanweisung – 5 Design-Vorlagen (Layout-Export)** – zusätzlich zum
  einfachen Markdown/DOCX/PDF gibt es einen gestalteten Export mit
  Deckblatt, farbigem Abschnitts-Banner je Domäne und nummerierten
  Schritten, wählbar aus 5 Design-Vorlagen (Corporate Blau, Dunkel
  Professionell, Minimal Hell, Grün Nachhaltig, Warm Orange) als DOCX
  oder PDF. Inhaltlich identisch zum normalen Klickanweisung-Entwurf
  (gleiche Domänen-Gruppierung, keine Ticket-Referenzen); die Gestaltung
  besteht bewusst nur aus selbst erzeugten Farben/Formen/Typografie,
  **keine Fotos/Stockbilder** – dafür hat die App keine Bildquelle und
  würde sonst etwas vortäuschen, das nicht vorhanden ist.
- **Sprachauswahl "Deutsch" / "English"** – Releaseletter, Benutzerhandbuch
  und Clickanweisung haben in der Vorschau einen Umschalter, der die
  komplett zweisprachig hinterlegte **Vorlage** (Überschriften,
  Feldbezeichnungen wie "Status"/"Domäne"/"Priorität", Rohgerüst-Hinweise)
  zwischen Deutsch und Englisch umschaltet. Der Ticket-Freitext
  (Zusammenfassung/Beschreibung) wird in **beiden** Sprachmodi unverändert
  in seiner Originalsprache angezeigt (meist Englisch, da unverändert aus
  Jira übernommen) – die App übersetzt ihn bewusst nicht automatisch
  (Risiko fachlicher Verfälschung; es gibt keine Übersetzungs-Engine und
  keinen Server/keine externe API für diese drei Generatoren), ein
  eingeblendeter Hinweis macht das transparent. Downloads verwenden die
  gerade aktive Sprache (Dateiname erhält den Zusatz `_de`/`_en`).
- **Endnutzer-Framing der Tab-Texte** – Die Beschreibungstexte von Import,
  Verarbeitung, Releaseletter, Benutzerhandbuch, Prozessbild und
  Clickanweisung machen explizit, dass diese vier Medien aus **denselben**
  importierten Ticket-Beschreibungen erzeugt werden und für Endnutzer bei
  der Bedienung von oneSCM gedacht sind (nicht nur als interne
  Release-Doku). Die Navigation selbst blieb unverändert.
  Prozessbild-Diagramme (SVG/Mermaid) bleiben davon unberührt und zeigen
  weiterhin deutsche Status-Bucket-Beschriftungen (Erledigt/Offen/…) sowie
  den unveränderten Ticket-Freitext als Knotenbeschriftung.
- **Prozessbild** – Prozessdiagramm aus ausgewählten Tickets mit **10
  Design-Vorlagen** (Farben: OnePaper Dunkel/Hell, Corporate Blau,
  Silber/Schwarz, Forest, Sunset, Pastell, Monochrom, Royal,
  Druckfreundlich S/W) und **10 Bildformaten/Visual-Arten**, frei
  kombinierbar:
  1. Mermaid-Flussdiagramm (klassisch, wie bisher, native Diagramm-Anzeige)
  2. Nummerierte Schritt-Karten im Raster (Pfeile + Status-Fußzeile)
  3. Vertikale Zeitleiste (Karten abwechselnd links/rechts)
  4. Horizontale Prozesskette (eine Zeile, große Pfeile)
  5. Swimlane nach Status (gemeinsame Zeitachse, Bahnen je Status)
  6. Kanban-Board nach Status (Spalten mit gestapelten Karten)
  7. Prozessrad (Schritte kreisförmig um den Prozessnamen)
  8. Matrix-Poster nach Domain (reines Raster ohne Pfeile)
  9. Trichter/Funnel (sich verengende Stufen mit Anmerkungen)
  10. Checkliste (minimalistisch, druckfreundlich)

  Die 9 neuen Formate werden als eigenständiges, direkt im Browser
  erzeugtes SVG gerendert (kein Server, keine externe Grafikbibliothek)
  und lassen sich als `.svg` herunterladen; das klassische
  Mermaid-Format bleibt Standardauswahl und unverändert. Jedes generierte
  SVG bekommt `role="img"` und einen `<title>`/`aria-label` mit dem
  Release-/Prozessnamen, damit es auch für Screenreader zugänglich ist.
  Zusätzlich lässt sich die zugrundeliegende Schritt-Tabelle
  (Ticket/Typ/Titel/Status/Domäne/ Priorität-Punkte/Labels/Beschreibung)
  unabhängig vom Bildformat als XLSX/DOCX/PDF exportieren.
- **Screens-Import** (neu, v2.82.0, bis v2.89.0 "Editor" genannt – umbenannt
  in v2.90.0, da "Editor" seitdem das EDITO-Register bezeichnet, s. u.) –
  Word- (.docx) oder PowerPoint-Dateien (.pptx)
  mit Screens je Domäne hochladen (auch Exporte der separaten
  Screenrecorder-App, die ebenfalls Word/PowerPoint liefert). Enthaltene
  Bildschirmfotos werden automatisch erkannt, nach Dokumentreihenfolge
  nummeriert und mit dem zugehörigen Überschriften-/Folientiteltext als
  Bildtext versehen. Datei-Übersichtstabelle (Typ/Domäne/Status/Anzahl
  Screens) und Screens-Übersichtstabelle (Vorschau/Nr./Bildtext/
  Quelldatei/Domäne/Kapitel-Dropdown) – Kapitel-Zuordnung von Hand oder per
  **KI-Vorschlag** (überschreibt nie bereits gesetzte Zuordnungen). Screens
  nutzen dieselbe Datenstruktur wie "Bilder" und erscheinen dort
  automatisch mit. Details siehe Abschnitt weiter unten. Zusätzlich je
  Screen ein **Unterkapitel**-Dropdown (nur für die eigene Übersicht im
  Register "Bildband", s. u.). **OCR: Alle Screens interpretieren** (neu,
  v2.102.0, zusätzlich zum bestehenden, rein auf dem Bildtext
  basierenden KI-Vorschlag): erkennt per OCR (Tesseract.js, derselbe
  wiederverwendete Worker-Pool wie im Register "Bilder" – mehrere Screens
  parallel statt sequenziell) den tatsächlich AUF dem Screenshot
  sichtbaren Text (nicht nur die aus der Quelldatei übernommene
  Überschrift) und lässt Claude anhand dieses Texts Kapitel, Unterkapitel
  UND eine Kurzbeschreibung vorschlagen – überschreibt dabei nie bereits
  gesetzte Felder, ergänzt nur, was noch leer ist.
- **Bildband** (neu, v2.83.0) – verbindet Editor-Screens mit dem
  Benutzerhandbuch-Kapiteltext über den Platzhalter `[Bild]` (eigene
  Zeile): jedes Vorkommen wird in Vorschau sowie DOCX-/PDF-Export durch das
  jeweils nächste zugeordnete Bild ersetzt (inkl. automatischer
  Bildunterschrift). Übersichtstabelle je Kapitel mit Anzahl Platzhalter/
  zugeordneter Screens, Status und direktem DOCX-/PDF-Export. Details siehe
  Abschnitt weiter unten. (v2.84.0: Bild-Maße für den DOCX-/PDF-Export
  werden jetzt parallel statt sequentiell ermittelt – deutlich schnellerer
  Export bei mehreren Bildern je Kapitel.)
- **Editor** (neu, v2.88.0 unter dem Namen "EDITO", umbenannt in "Editor"
  in v2.90.0 – das vorherige Register "Editor" heißt seitdem
  "Screens-Import", s. o., damit es nicht zwei gleichnamige
  Navigationspunkte gibt) – erstellt eine NEUE Fassung des
  Benutzerhandbuchs je Rolle/Sparte aus 6 internen Quellen gleichzeitig:
  importierten Jira-Tickets, der RAG-Bibliothek, dem bereits bestehenden
  Benutzerhandbuch-Text, Rovo-Knowledge-Textschnipseln (als QUELLE 4 im
  Prompt explizit als vorrangige Quelle markiert, neu v2.95.0 – diese
  Daten stammen direkt aus dem Rovo-Quellsystem und sind bei
  inhaltlichen Widersprüchen zu den anderen Quellen maßgeblich),
  zugeordneten Bildern (Bildband-Platzhalter `[Bild]`) sowie
  zugeordneten, aus Rovo Knowledge extrahierten **Tabellen** (neu,
  v2.99.0, Platzhalter `[Tabelle]`, QUELLE 6 im Prompt – s. u. "Tabellen-
  Einbettung") – ein eigener, von
  `app.manualChapters` unabhängiger Bestand, existiert also bewusst
  parallel zum bestehenden Stand. Nutzt für die Rolle/Sparte-Auswahl
  dieselben 6 Gliederungsversionen wie "Verarbeitung → Gliederung-
  Versionen" (Markt/MO/Dealer/IT/Van/Pkw): nur Kapitel, die für die
  gewählte Version zutreffen, werden angeboten, zusätzlich werden je
  Kapitel nur die TICKETS berücksichtigt, deren Sparte-/Rollen-Tags zur
  Version passen (die anderen 4 Quellen tragen keine solchen Tags und
  fließen vollständig ein). Erzeugung je Kapitel einzeln oder über einen
  Sammel-Lauf "Alle Kapitel erzeugen", Vorschau frei editierbar, Export je
  Kapitel als DOCX/PDF/Markdown. **Automatische Dokumentenablage** (neu,
  v2.90.0): nach jedem Erzeugen (einzeln oder im Sammel-Lauf) werden
  automatisch ein Word- (.docx) und ein PDF-Dokument mit Datum im
  Dateinamen abgelegt (als Daten-URL im Sitzungsstand, kein automatischer
  Download-Dialog) – eine Übersichtstabelle "5. Alle erzeugten Dokumente"
  listet je Kapitel Rolle/Sparte, Erzeugungsdatum sowie Word-/PDF-Datei zum
  direkten Herunterladen, über alle Rollen/Sparten hinweg (unabhängig von
  der aktuell gewählten Version). Bei erneutem Erzeugen eines Kapitels wird
  die vorherige Datei desselben Kapitels ersetzt. **Checkbox-Auswahl +
  Mehrfach-Export** (neu, v2.91.0): in "2. Kapitel & Quellen" lässt sich
  je Kapitel eine Checkbox anhaken, dazu "Alle auswählen"/"Auswahl
  aufheben" für die gesamte aktuell angezeigte Kapitelliste; der neue
  Bereich "3. Ausgewählte Kapitel exportieren" erzeugt per Klick für JEDES
  ausgewählte Kapitel separat ein Word- bzw. PDF-Dokument (je eine eigene
  Datei, kein zusammengeführtes Gesamtdokument) und legt es ebenfalls in
  der Dokumenten-Übersicht ab – Kapitel ohne bereits erzeugten Text werden
  dabei übersprungen (Hinweis statt Absturz). Die Auswahl ist reiner
  Sitzungs-Anzeigezustand (nicht Teil von "Sitzung speichern") und wird bei
  Versionswechsel geleert. Fünf Prüf-Agenten (reine Befund-Reports, keine
  Auto-Korrektur): **Agent 1** validiert jede fachliche Aussage im
  erzeugten Text gegen die Rovo-/Jira-Quellen (nicht belegte Aussagen/
  Widersprüche), **Agent 2** prüft Grammatik, Sprachstil, Wiederholungen
  und roten Faden. **Agent 3** (neu, v2.100.0, Struktur-Prüfung des
  Gesamtdokuments, Abschnitt "6.") läuft bewusst OHNE KI-Aufruf – ein rein
  deterministischer Befund-Report anhand des tatsächlich gerenderten
  Gesamtdokument-PDFs (dieselbe Layout-Logik wie beim regulären
  PDF-Export, nur alle bereits erzeugten Kapitel der Version in EINEM
  Dokument statt separater Einzel-Exporte): nennt die ECHTE, gerenderte
  Seitenanzahl (keine Schätzung – Zeilenumbrüche, eingebettete Bilder UND
  Tabellen fließen genauso ein wie beim echten Export), gleicht je Kapitel
  die Anzahl [Bild]-/[Tabelle]-Platzhalter gegen die Anzahl tatsächlich
  zugeordneter Screenshots/Tabellen ab (meldet Kapitel mit Überschuss –
  mehr Platzhalter als Zuordnungen – explizit mit Warnsymbol) und weist
  auf das Inhaltsverzeichnis hin (Umfang + Seitenanzahl, s. u.). **Agent 4**
  und **Agent 5** (beide neu, v2.104.0, ebenfalls Abschnitt "6.", EIN
  Claude-Call über ALLE bereits erzeugten Kapitel der Version zusammen,
  anders als Agent 1/2 die je EINZELNES Kapitel prüfen): **Agent 4**
  vergleicht die Kapitel UNTEREINANDER und meldet Widersprüche bzw.
  inhaltliche Redundanzen zwischen verschiedenen Kapiteln (benötigt
  mindestens 2 bereits erzeugte Kapitel); **Agent 5** prüft je Kapitel, ob
  die ihm zugeordneten Jira-Tickets erkennbar im Kapiteltext aufgegriffen
  werden, und meldet nicht abgedeckte Tickets (bereits ab 1 erzeugtem
  Kapitel nutzbar). Beide sind reine Befund-Reports (keine Auto-Korrektur)
  und wie Agent 3 reiner Sitzungs-Anzeigezustand, der bei Versionswechsel
  zurückgesetzt wird. **Gesamtdokument** (neu, v2.94.0, Abschnitt "6."):
  führt alle bereits erzeugten Kapitel der oben gewählten Rolle/Sparte in
  Gliederungs-Reihenfolge zu EINEM Dokument zusammen – als Word UND
  (neu, v2.104.0) als PDF, echter Seitenumbruch zwischen den Kapiteln,
  Bildband-Platzhalter werden wie beim Einzel-Export eingebettet; noch
  nicht erzeugte Kapitel werden übersprungen, der Status-Hinweis nennt die
  Anzahl. Beide Fassungen erhalten (neu, v2.104.0) automatisch ein
  vorangestelltes Inhaltsverzeichnis: in der PDF-Fassung mit der REALEN,
  tatsächlich gerenderten Seitenzahl je Kapitel (dafür werden zunächst
  genug Seiten für das Verzeichnis reserviert, dann alle Kapitel gerendert
  und zuletzt per Rücksprung auf die reservierten Seiten die echten
  Startseiten eingetragen – keine Schätzung), in der Word-Fassung nur mit
  der Kapitel-Reihenfolge (Word berechnet Seitenzahlen erst beim Öffnen
  selbst, abhängig von Schriftart/Zoom/Drucker des Lesers – eine erfundene
  Seitenzahl wäre dort nicht ehrlich). Die zusammengeführte Fassung wird
  vor dem Download zusätzlich als Lesevorschau angezeigt. Rein
  Sitzungs-Anzeigezustand (nicht Teil von "Sitzung speichern"), wird bei
  Versionswechsel oder erneutem Zusammenführen verworfen bzw. neu
  aufgebaut. **Tabellen-Einbettung**
  (neu, v2.99.0): dem Kapitel im
  Register "Tabelle" zugeordnete, aus Rovo Knowledge extrahierte Tabellen
  (s. o.) werden der KI als eigene QUELLE 6 genannt (je Tabelle mit
  Quelldatei und Zeilen-/Spaltenanzahl) – die KI fügt dafür eine eigene
  Zeile `[Tabelle]` an passender Stelle ein, genau wie beim bestehenden
  `[Bild]`-Platzhalter, nie mehr Platzhalter als zugeordnete Tabellen.
  Beim Export (Einzelkapitel wie Gesamtdokument, Word UND PDF) wird der
  Platzhalter durch die ECHTE Tabelle ersetzt – als strukturierte
  Word-Tabelle mit festem, auf die Seitenbreite normiertem Spaltenlayout
  bzw. als gezeichnete PDF-Tabelle (dieselbe Spalten-Fit-Logik wie beim
  eigenständigen druckbaren Tabellen-Export im Register "Tabelle"), nicht
  als Bild. Der Platzhalter-Mechanismus ist dabei bewusst allgemein
  gehalten (dieselben gemeinsam genutzten Export-Funktionen wie beim
  Benutzerhandbuch-Kapitel-Generator) – eine Zeile `[Tabelle]` im
  Kapiteltext wird daher auch bei manuell bearbeitetem oder von Hand
  geschriebenem Text ersetzt, unabhängig davon, ob sie von der KI oder
  von Hand eingefügt wurde.

- **Unterkapitel** (neu, v2.106.0) – eigener Bereich, baut bewusst auf
  EDITO auf (teilt sich dieselbe Rolle/Sparte-Auswahl und denselben
  Quellen-Bestand, `app.editoVersionKey` geteilter Zustand, an einer
  Stelle geändert überall aktuell), arbeitet aber auf UNTERKAPITEL-Ebene
  mit einem eigenen, iterativen Workflow statt nur je ganzem Kapitel.
  Nach Kapitel-/Unterkapitel-Auswahl zeigt die **Quellen-Übersicht**, was
  diesem Unterkapitel bereits zugeordnet ist: zugeordnete Jira-Tickets
  (nur auf Kapitel-Ebene möglich, da Tickets keine Unterkapitel-Zuordnung
  kennen – im UI klar ausgewiesen), sowie RAG-Bibliothek-Einträge,
  Rovo-Wissens-Notizen, Bilder und Tabellen, die zusätzlich zur
  Kapitel- auch mit einer Unterkapitel-Zuordnung versehen wurden (`.subTitle`
  bzw. `.subchapter`-Feld, dieselben Dropdowns wie in den jeweiligen
  Registern). Darunter ein **Eingabe-Formular** für eigene Vorgaben je
  Unterkapitel: Kurzbeschreibung, relevante Stichwörter, explizit
  auszuschließende Stichwörter/Inhalte sowie Formatregeln. Ein Klick auf
  **"Bearbeiten"** erzeugt per Claude-Aufruf eine neue Fassung dieses
  EINEN Unterkapitels aus den obigen Vorgaben + Quellen (Prompt editierbar
  unter Einstellungen → RAG-Prompts, "Unterkapitel-Werkstatt") und
  vergleicht sie automatisch mit der vorherigen eigenen Fassung – ein
  selbst geschriebener, leichtgewichtiger zeilenbasierter Diff (LCS-Algorithmus,
  kein externes Diff-Utility im Code vorhanden) zeigt hinzugefügte/entfernte
  Zeilen farblich markiert an. Vorgaben anpassen und erneut auf
  "Bearbeiten" klicken wiederholt den Zyklus beliebig oft (Loop) – jede
  vorherige Fassung bleibt im Versionsverlauf des Unterkapitels erhalten.
  Ein **Freigabe-Status** (Entwurf / Zur Prüfung / Genehmigt) lässt sich
  je Unterkapitel UND je Rolle/Sparte-Version UNABHÄNGIG setzen (eigener
  Eintrag pro Rolle/Sparte-Version, anders als bei den EDITO-Kapiteln,
  wo nur die zuletzt erzeugte Fassung gehalten wird) – eine Übersichtstabelle
  listet alle bereits erzeugten Unterkapitel mit Status und erlaubt direktes
  Zurückspringen. **Export**: je Unterkapitel einzeln als Word/PDF, sowie
  "Alle genehmigten Unterkapitel zusammenführen" als Gesamtdokument für die
  aktuell gewählte Rolle/Sparte-Version (Word **und** PDF, Seitenumbruch
  zwischen den Unterkapiteln, Sortierung nach Gliederungsreihenfolge) – beide
  Export-Wege mit einem Schalter **"Bilder einbetten"**: ausgeschaltet werden
  `[Bild]`-Platzhalterzeilen vor dem Export entfernt und keine Bilddateien
  eingebettet (Tabellen bleiben davon unberührt), für schlanke Text-Only-Fassungen.
  **Professionelles Druckerzeugnis** (neu, v2.106.0, gilt für BEIDE Gesamtdokument-
  Exporte – EDITO-Benutzerhandbuch UND Unterkapitel-Werkstatt, jeweils Word **und**
  PDF): ein **Deckblatt** (Titel, Rolle/Sparte-Version als Untertitel, Erstellungsdatum,
  zentriert) wird jetzt automatisch VOR das Inhaltsverzeichnis gesetzt. Jede Seite
  erhält eine **Kopf-/Fußzeile**: in der PDF-Fassung ein kleiner Dokumenttitel oben
  links und "Seite X von Y" unten rechts (nachträglich über alle bereits gerenderten
  Seiten gezeichnet, da die Gesamtseitenzahl erst nach dem vollständigen Rendern
  feststeht); in der Word-Fassung ein natives **Seitenzahl-Feld** (`PAGE`/`NUMPAGES`,
  zentriert, über eine eigene `footer1.xml` referenziert) – Word berechnet den
  angezeigten Wert selbst beim Rendern/Drucken, genau wie bei jedem regulären
  Word-Dokument. Zusätzlich bekommt die PDF-Fassung echte, im PDF-Reader anklickbare
  **Lesezeichen** zum Inhaltsverzeichnis (jsPDF-Outline-API, `doc.outline.add()`,
  keine Simulation) – ein Klick auf ein Kapitel/Unterkapitel im Lesezeichen-Panel
  springt direkt zur passenden Seite. Alle drei Merkmale sind standardmäßig aktiv,
  aber über optionale Parameter der jeweiligen Builder-Funktionen (`buildMergedEditoPdfDoc`/
  `buildMergedEditoDocxBlob`/`buildSubchapterMergedPdfDoc`/`buildSubchapterMergedDocxBlob`)
  einzeln abschaltbar. Word-Fußzeile und Deckblatt sind bewusst über eigene,
  separate Builder-Funktionen umgesetzt (nicht in der für Einzelkapitel/-unterkapitel
  gemeinsam genutzten Export-Grundfunktion) – der Einzelkapitel-/Einzelunterkapitel-Export
  bleibt dadurch unverändert. **Konsistenz- & Vollständigkeitsprüfung** (neu, v2.107.0,
  analog zu EDITO Agent 4/5): zwei weitere Prüf-Buttons laufen über ALLE genehmigten
  Unterkapitel der aktuell gewählten Rolle/Sparte-Version zusammen (ein Befund-Report, der
  nur im Zusammenspiel mehrerer Unterkapitel sinnvoll ist – deshalb EIN Claude-Aufruf über
  den gesamten Bestand statt je Unterkapitel einzeln, Prompts editierbar unter
  Einstellungen → RAG-Prompts). **Agent 4** vergleicht die genehmigten Unterkapitel
  UNTEREINANDER auf Widersprüche und Redundanzen (mindestens 2 genehmigte Unterkapitel
  nötig). **Agent 5** prüft JE Unterkapitel, ob dessen eigene zugeordnete Quellen (Jira-
  Tickets des übergeordneten Kapitels, RAG-Bibliothek-Einträge, Rovo-Wissens-Notizen –
  dieselbe Quellen-Zuordnung wie im Eingabe-Formular oben) im erzeugten Text erkennbar
  aufgegriffen wurden (mindestens 1 genehmigtes Unterkapitel nötig). Beide Ergebnisse sind
  reiner Sitzungs-Anzeigezustand (nicht Teil von "Sitzung speichern", wie bei EDITO Agent
  4/5) und werden bei Rolle/Sparte-Versionswechsel sowie "Alle Daten löschen" zurückgesetzt.

- **FINAL** (neu, v2.109.0, eigener Navigationspunkt direkt nach Unterkapitel – letzter
  Schritt vor der Ablieferung): **mehrere** Benutzerhandbuch-.docx-Dateien hochladen,
  Kapitel werden je Datei über dieselbe Formatvorlagen-Erkennung wie beim bestehenden
  Referenz-Handbuch-Import gefunden (`docxXmlToFinalChapters`, eine neue, eigenständige
  Variante von `docxXmlToChapters` – der bestehende Referenz-Handbuch-Import bleibt
  dadurch unverändert). **Interne Vermerke erkennen**: anders als reine Textmarkierungen
  erwartet FINAL ECHTE Word-Kommentare (Überprüfen → Kommentar) – der per Kommentar
  markierte Textbereich (`w:commentRangeStart`/`w:commentRangeEnd` in der OOXML-Struktur,
  der Kommentarinhalt selbst wird bewusst nicht gelesen, nur die Bereichsmarkierung) gilt
  als „intern" und lässt sich über die Option „Interne Vermerke ausblenden" aus der
  bereinigten Fassung herausnehmen; eine zweite, unabhängige Option „Jira-Nummern
  ausblenden" entfernt zusätzlich erkannte Ticket-Schlüssel (dieselbe Erkennung wie bei
  Rovo Knowledge, `ROVO_JIRA_KEY_RE`) samt dadurch leer gewordener Klammern. Eine
  Live-Vorschau je Kapitel zeigt sofort, wie sich beide Schalter auswirken. **Mehrfach
  vorkommende Kapitel** (derselbe Titel in mehreren hochgeladenen Dateien) erscheinen in
  einer eigenen Tabelle – dort wird je Kapitel manuell gewählt, welche Datei die
  maßgebliche Fassung für das Master-Dokument liefert. **Screens-Datei hochladen**: eine
  zusätzliche, separate .docx-/.pptx-Datei mit eingebetteten Bildschirmscreens je Rolle/
  Sparte/Sprache/Markt (Rolle/Sparte als Dropdown mit den bestehenden Werten aus
  `OUTLINE_VERSIONS`, Sprache/Markt als freie Textfelder – beides komplett neue
  Zuordnungs-Achsen, die extrahierten Screens landen – wie bei Editor/Rovo Knowledge
  üblich – in der gemeinsamen Bilder-Liste, zusätzlich markiert mit den vier neuen
  Feldern); jeder extrahierte Screen wird anschließend einem erkannten Kapitel
  zugeordnet (dieselbe Liste wie bei den Benutzerhandbuch-Kapiteln – Word-Unterkapitel-
  Überschriften erscheinen darin automatisch als eigene Einträge). **Master
  zusammenführen**: baut EIN Gesamtdokument (Word **und** PDF, mit Deckblatt/
  Inhaltsverzeichnis/Fußzeile/Lesezeichen – dieselben generischen Bausteine wie bei
  EDITO/Unterkapitel-Werkstatt) aus der je Kapitel gewählten Quelle in der aktuellen
  Bereinigungsstufe, ergänzt um die zur gewählten Rolle/Sparte/Sprache/Markt passenden
  Screens als eingebettete Bilder (ein leeres Filterfeld passt auf jede Ausprägung dieser
  Achse). **Ergebnis am Ende**: Quellversion (vollständiger, unbereinigter Originaltext
  der gewählten Quelldatei) und neue Zusammenführung (bereinigter Master-Text inkl.
  lesbarer Bild-Hinweise) stehen für das zuletzt zusammengeführte Dokument nebeneinander
  zum Vergleich.

- **OpenCV ohne Internet-CDN (v2.169.0)**: OpenCV.js (4.11, Apache-2.0, ca. 11 MB) wird jetzt **zusammen mit dem
  Artifact veröffentlicht** (`vendor/opencv-4.11.0.js`, Lizenz in `vendor/opencv-LICENSE.txt`) und zuerst von dort
  geladen; cdn.jsdelivr.net und unpkg.com dienen nur noch als Rückfall. Damit funktioniert die Bildprüfung auch, wenn
  diese CDNs gesperrt sind (in Chromium mit vollständig gesperrtem Internet nachgeprüft). Geladen wird weiterhin erst
  beim ersten Gebrauch; die Statuszeile nennt die Quelle („OpenCV geladen aus: …“). Beim lokalen Bauen ohne die Datei
  greift wie bisher das CDN.

- **„Speicher voll“ im echten Browser nachgeprüft (v2.168.0)**: In Chromium mit auf 2 MB begrenztem Speicher (per
  DevTools) zeigte sich zweierlei: (1) Der Browser **schätzt 3 GB frei**, lehnt aber trotzdem ab – die Warnleiste nennt
  das jetzt ehrlich („Die Schätzung des Browsers … ist hier nicht verlässlich“) statt „voll … frei 3 GB“; Dashboard-Kachel
  „Frei“ und Hinweis reagieren auf den tatsächlichen Fehler, nicht nur auf die Schätzung. (2) Ein **fehlgeschlagener
  Versuch zählt weiter als belegt** (6,2 MB bei einer 40-KB-Sitzung), sodass danach selbst kleine Sitzungen abgelehnt
  werden. **„Erneut versuchen“** entfernt nach „Speicher voll“ deshalb zuerst die alte Sicherung und speichert dann neu
  (Belegt danach 86 KB) – nur auf Klick, mit Hinweis in der Leiste.

- **OpenCV und SVG (v2.167.0)**: SVG-Grafiken werden jetzt auch geprüft (beim Hochladen in Bilder und bei „Alle Bilder
  analysieren“): sehr ähnliche Bilder / schon im Archiv und Kontrast. SVGs ohne width/height bekommen für die Analyse
  die Größe aus der viewBox. Als Vektorgrafik gelten sie nie als „unscharf“ und werden nie zugeschnitten.
  **Behoben**: „Speicher sparen“ (v2.158) konnte eine große SVG durch ein PNG/JPEG ersetzen, wenn das Rasterbild
  kleiner war – Vektorgrafiken bleiben jetzt immer unverändert.

- **Dashboard: alte FINAL-Stände archivieren (v2.166.0)**: Varianten und Review-Übernahmen werden als FINAL-Stände
  gespeichert – nach den Bildern meist der größte Posten. „Aufräumen“ zeigt jetzt **„FINAL – nicht mehr benötigte
  Stände“** mit Anzahl und Größe. **„Sichern und löschen“** speichert sie zuerst als Archivdatei
  (`FINAL-Staende-Archiv_<Datum>_<n>.json`) und entfernt sie erst danach; wird der Download abgelehnt, bleibt alles.
  **Geschützt** sind immer: aktiver Stand, veröffentlichte Stände, Basis und Ergebnisse von Varianten, der Stand im
  Editor und Stände aus dem Dokument-Review. **„FINAL-Stände-Archiv einlesen“** holt archivierte Stände mit neuen IDs
  zurück (Vermerk in der Status-Historie).

- **Release-Paket: Vorprüfung auf Verweise zu gelöschten Bildern (v2.165.0)**: Die Vorprüfung je Dokument nennt jetzt
  auch **Verweise auf gelöschte Bilder** („1 Verweis(e) auf gelöschte Bilder (Dashboard → Aufräumen)“) – in Varianten
  und Review-Dokumenten, in Statuszeile, Paket-Liste und LIESMICH.md. **Behoben**: Im Review-Dokument galt ein
  Bild-Platzhalter, dessen einziges Bild gelöscht war, als zugeordnet; er zählt jetzt als offen.

- **Dashboard: verwaiste Bild-Verweise aufräumen (v2.164.0)**: „Aufräumen“ zeigt zusätzlich **Verweise auf gelöschte
  Bilder** – Reste aus Löschungen vor v2.161 in FINAL-Kapiteln, Screens-Platzhaltern (inkl. Trefferwert) und im
  Dokument-Review, mit Anzahl und betroffenen Registern. Solche Platzhalter wirkten zugeordnet, obwohl das Bild fehlt;
  „Löschen“ entfernt nur die toten Verweise, gültige bleiben, die Platzhalter sind danach wieder offen.

- **Dashboard: Aufräumen entbehrlicher Kopien (v2.163.0)**: Unter der Speicher-Tabelle listet „Aufräumen – entbehrliche
  Kopien“ mit Anzahl, Größe und Hinweis: ältere **Zwischenversionen** des Benutzerhandbuchs (bis zu 10 vollständige
  Kopien aller Kapitel) und der Massenverarbeitung (die neueste bleibt jeweils), **Bild-Originale vor dem Verpixeln**
  (enthalten die unverpixelten Namen/FIN – Löschen entfernt sie auch aus der Sitzungsdatei) und **Bild-Originale vor dem
  Zuschneiden**. Je Zeile „Löschen“ mit Bestätigung; der aktuelle Stand bleibt unverändert, „Belegt“ wird sofort neu
  berechnet. Der Hinweis bei wenig freiem Speicher verweist darauf.

- **Bilder: OpenCV-Prüfung beim Hochladen (v2.162.0)**: Auch im Register Bilder prüft OpenCV neu hochgeladene Bilder
  (Schalter „Beim Hochladen mit OpenCV prüfen“, standardmäßig an, gemeinsam mit dem Screens-Import und in der Sitzung
  gespeichert): unscharf, kontrastarm, leerer Rand – und **„schon im Archiv“**: Ist ein neues Bild einem vorhandenen
  (analysierten) Bild sehr ähnlich, nennt der Hinweis beide mit Abweichung in % und legt sie in eine gemeinsame Gruppe;
  der Knopf „→ Sehr ähnliche Bilder bereinigen“ führt direkt dorthin. Noch nicht analysierte Archivbilder werden gezählt.
  SVG-Bilder werden nicht geprüft. **Behoben**: Gruppen aus der Prüfung im Screens-Import („I1“ …) brachten die
  Bereinigung (v2.159) zum Absturz, weil die Gruppennummer als Zahl gelesen wurde.

- **Bild löschen räumt Verweise auf (v2.161.0)**: Wird im Register Bilder ein Bild gelöscht, das noch verwendet wird,
  nennt die Bestätigung jetzt die Verwendungen („Es wird 4× verwendet (FINAL, Screens-Import, Dokument-Review)“).
  Beim Löschen werden die Verweise mit entfernt – FINAL-Kapitel-Screens, Zuordnung und Trefferwert in den
  Screens-Platzhaltern, Bild-Platzhalter im Dokument-Review (wieder offen); eingebettete Handbuch-Bilder behalten ihren
  Platz. Bisher blieben verwaiste Verweise zurück. Das Protokoll nennt die Zahl der entfernten Verweise.

- **Warnung, wenn das automatische Speichern fehlschlägt (v2.160.0)**: Bisher stand ein Fehlschlag nur als Statuszeile in
  den Einstellungen – bei vollem Browser-Speicher ging die Arbeit beim nächsten Absturz verloren, ohne dass es auffiel.
  Jetzt erscheint oben eine **rote Warnleiste** mit Grund („Browser-Speicher ist voll“ bzw. Fehlername), Größe der
  Sitzung, freiem Speicher laut Browser, Zeitpunkt des letzten erfolgreichen Speicherns und Anzahl der Fehlversuche,
  dazu die Knöpfe **„Sitzung als Datei speichern“**, **„Speicher sparen (Bilder)“**, **„Speicher je Register
  (Dashboard)“**, **„Erneut versuchen“** und **„Ausblenden“** (gilt bis zum nächsten Erfolg). Je Fehlerserie einmal
  ein Hinweis und ein Protokolleintrag; klappt das Speichern wieder, verschwindet die Leiste („funktioniert wieder“).
  Im Dashboard zeigt die neue Kachel **„Automatisch gespeichert“** ok/fehlgeschlagen.

- **Bilder: sehr ähnliche Bilder bereinigen (v2.159.0)**: Nach der OpenCV-Analyse zeigt das Register Bilder je Gruppe sehr
  ähnlicher Bilder Vorschau, Auflösung, Größe und **Verwendungen mit Register** (FINAL, Screens-Import, Dokument-Review …).
  Ein Bild ist zum **Behalten** vorgewählt (meiste Verwendungen, dann größte Auflösung, dann ältestes) und lässt sich
  umstellen. **„Andere entfernen“** entfernt die übrigen Bilder der Gruppe und stellt alle Verweise auf das behaltene Bild
  um: FINAL-Kapitel-Screens, eingebettete Handbuch-Bilder, Screens-Platzhalter (inkl. Trefferwert, der höhere bleibt) und
  Bild-Platzhalter im Dokument-Review; doppelte Einträge entfallen. Vorher fragt eine Bestätigung mit Anzahl, Verweisen,
  Ersparnis und der Abweichung in der Gruppe („sehr ähnlich heißt nicht gleich“).

- **Bilder: Speicher sparen (v2.158.0)**: Neuer Abschnitt **„Speicher sparen“** im Register Bilder. Er verkleinert
  übergroße Bilder auf eine **maximale Kantenlänge** (1280/1600/**1920**/2560 px oder „nicht verkleinern“) und speichert
  Bilder ohne Transparenz als **JPEG** (Qualität 90 %), wenn das deutlich kleiner ist. Ersetzt wird ein Bild nur, wenn es
  mindestens **15 % kleiner** wird; Bild-IDs, Zuordnungen und ein erkannter leerer Rand (mitskaliert) bleiben erhalten.
  Optional werden die beim Zuschneiden aufbewahrten **Originale verworfen**. Vorher fragt eine Bestätigung mit Anzahl,
  Größe vorher → nachher und Ersparnis; „Abbrechen“ ändert nichts. Einstellungen werden in der Sitzung gespeichert; läuft
  ohne OpenCV-Download. Im **Dashboard** hat die Zeile „Bilder“ den Knopf **„Speicher sparen“**, und der Hinweis bei wenig
  freiem Speicher verweist darauf.

- **„Neu“ verschwindet nach dem Besuch, OpenCV beim Screens-Import, Vorprüfung im Release-Paket (v2.157.0)**:
  (1) Das Label **„Neu“** in der Navigation verschwindet, sobald das Register geöffnet wurde (im Browser gemerkt; das beim
  Start automatisch geöffnete Dashboard zählt nicht; kommt eine neue Funktion hinzu, erscheint es wieder).
  (2) **Screens-Import**: neue Option „Screens beim Import mit OpenCV prüfen“ (standardmäßig an, in der Sitzung
  gespeichert). Nach dem Import prüft OpenCV die neuen Screens und meldet z. B. „2 Screen(s) – 1 unscharf, 0 kontrastarm,
  2 mit leerem Rand, 0 sehr ähnliche Screen(s) (Nr. 2 Vertragsmaske unscharf)“ mit Sprung ins Register Bilder; in der
  Screens-Tabelle tragen auffällige Screens einen Hinweis. Ohne OpenCV (offline) erscheint nur ein Hinweis, die Prüfung
  lässt sich im Register Bilder nachholen.
  (3) **Release-Paket – Vorprüfung** je Dokument: Varianten auf **Jira-Nummern**, **offene Bild-Platzhalter** und
  **unscharfe/kontrastarme Bilder**, Review-Dokumente auf offene Platzhalter und Bildqualität (Jira-Nummern entfernt die
  Verteilfassung dort selbst). Ergebnis als Hinweis je Datei in der Paket-Liste, in der Statuszeile und in der
  **LIESMICH.md**; noch nicht mit OpenCV geprüfte Bilder werden gezählt, Knopf **„Bilder mit OpenCV prüfen (n)“** prüft
  sie direkt. Das Paket wird trotzdem erstellt – die Vorprüfung warnt, sie blockiert nicht. Nebenbei: doppelter Punkt am
  Ende der Paket-Statuszeile behoben.

- **VARIANTE: Jira-Nummern entfernen (v2.156.0)**: Varianten gehen an Kunden, übernahmen aber bisher Jira-Nummern aus
  dem FINAL-Stand (z. B. „km pro Jahr (ONESCM-73)“), solange dort „Jira-Nummern ausblenden“ aus war – gefunden beim
  Rendern der Varianten-Word-Dateien. Neue Option **„Jira-Nummern entfernen“** in VARIANTE (Schritt 4), **standardmäßig
  an** (wie in der Verteilfassung des Dokument-Reviews), abschaltbar und in der Sitzung gespeichert; der FINAL-Stand
  selbst behält die Nummern. Das Entfernen räumt jetzt auch Reste mehrerer Nummern auf („(ONESCM-73, ONESCM-74)“ →
  nichts statt „(, )“) und entfernt Leerzeichen vor Satzzeichen („angelegt (ONESCM-12).“ → „angelegt.“) – das gilt auch
  für „Jira-Nummern ausblenden“ in FINAL und „Jira-Nummern löschen“ im Dokument-Review.

- **Dokument-Review: Bildqualität mit OpenCV prüfen (v2.155.0)**: Stufe 3 (Bilder) hat den Knopf **„Bildqualität mit
  OpenCV prüfen“**. Er prüft nur die im Dokument verwendeten Bilder (gleiche Analyse wie im Register Bilder, v2.153):
  unscharf, kontrastarm, leerer Rand und **sehr ähnliche Bilder innerhalb des Dokuments** (z. B. dasselbe Bild an zwei
  Stellen oder eine verkleinerte Kopie). Jedes betroffene Vorschaubild trägt einen Hinweis („unscharf“, „kontrastarm“,
  „12 % Rand“, „ähnlich A“ – gleiche Buchstaben = gleiche Gruppe), darüber steht eine Zusammenfassung mit Sprung ins
  Register **Bilder** (dort Ränder zuschneiden oder Bilder ersetzen). Ergebnis und Zeitpunkt werden beim Dokument
  gespeichert und im Verlauf (Stufe 3) protokolliert.

- **Navigation nach Workflow: Input · Operation · Output (v2.154.0)**: die Navigation ist nach den drei Gruppen
  **Input**, **Operation**, **Output** und darin nach den 9 Stufen geordnet: 1 Quellen (Import, Dateiverwaltung,
  Rovo Knowledge, Screens-Import, Bilder, Tabelle) → 2 Extraktion (Verarbeitung, Rovo Summary, Massenverarbeitung,
  Listenauswahl) → 3 Normalisierung (Gliederung, Glossar, Synonyme, Abkürzungen) → 4 Traceability (Ticket Graph, Trend,
  Mitteilungen) → 5 Validierung (CROSS_X, AGENT) → 6 Generierung (Releaseletter, Benutzerhandbuch, Prozessbild,
  Clickanweisung, Editor, Unterkapitel, Bildband) → 7 E2E-QA (FINAL, VARIANTE mit Dokument-Review) → 8 Testing
  (Datenqualität, Ergebnisse) → 9 Documentation (Output MD/PDF, Infobox); Dashboard oben, Einstellungen unten.
  **Burger-Menü** klappt die Navigation ein (öffnen über das Burger-Symbol oben links), Gruppen lassen sich einzeln oder
  alle zusammen einklappen (gemerkt im Browser; das offene Register bleibt sichtbar). Jeder Registereintrag zeigt die
  **Anzahl seiner Einträge**, neue Funktionen tragen das Label **„Neu“** (Hinweis per Mauszeiger), jede Stufe und Gruppe
  ihren **Stand** („Register mit Inhalt / Register“, Punkt grau = leer, orange = teilweise, grün = alle). **Oben in jedem
  Register** steht die **Workflow-Leiste** mit allen 9 Stufen, Stand je Stufe und der aktuellen Stufe hervorgehoben; ein
  Klick auf eine Stufe öffnet deren erstes Register. Zahlen und Stand aktualisieren sich bei jeder Änderung.

- **Bildverarbeitung mit OpenCV (v2.153.0)**: neuer Abschnitt „Bildverarbeitung mit OpenCV“ im Register **Bilder**.
  OpenCV.js (`@techstark/opencv-js@4.11.0-release.1`, WebAssembly, ca. 11 MB, von jsDelivr bzw. unpkg) wird erst beim
  ersten Klick geladen. **Alle Bilder analysieren**: Schärfe (Varianz des Laplace-Operators – „unscharf“ unter 60),
  Kontrast (Standardabweichung der Grauwerte – „kontrastarm“ unter 20), **leerer Rand** (Inhaltsrechteck gegenüber
  der Randfarbe, ab 4 % Rand) und **sehr ähnliche Bilder** (mögliche Dubletten: 256-Bit-Fingerabdruck als Vorfilter,
  dann Pixelvergleich 80×50 – höchstens 0,2 % deutlich abweichende Pixel; Kopien, auch neu gespeichert oder verkleinert,
  liegen bei 0,00 %, ein anderes Thema bei ~0,5 %; Screens, die sich nur in einer Zahl unterscheiden, sind von einer
  Kopie nicht zu trennen und erscheinen daher ebenfalls – mit angezeigter Abweichung „bitte prüfen“). Ergebnis als
  Tabelle (Vorschau, Größe, Schärfe, Kontrast, Rand, Gruppe) und je Bild in der Sitzung. **Leere Ränder zuschneiden**
  (je Bild oder alle) mit **„Original wiederherstellen“**. **OCR mit OpenCV-Vorverarbeitung** (abschaltbar, in der
  Sitzung gespeichert): Graustufen, Bilder unter 1000 px Kantenlänge doppelt so groß, Otsu-Binarisierung (dunkle Schrift
  auf hellem Grund) – gilt für Einzel-OCR, OCR-Stapel und die OCR im Screens-Import. Im Browser gemessen: 80 Screens
  (1280×800) in ca. 3 s inkl. Laden von OpenCV, längste Blockade der Oberfläche ca. 0,1 s.

- **Dokument-Review: Bilder mit KI auswählen (v2.152.0)**: Stufe 3 hat neben „Bildvorschläge übernehmen“
  (Textähnlichkeit) den Knopf **„Bilder mit KI auswählen“**: für jeden leeren Platzhalter (bis zu 40 je Lauf) bekommt
  die KI die 8 besten Kandidaten aus dem Bildarchiv (Bildtext, OCR-Text, Kapitel) und wählt höchstens 3, die den
  beschriebenen Bildschirm wirklich zeigen – im Zweifel keines (gleiche Regeln wie „Mit KI verfeinern“ im
  Screens-Import, Prompt „screenPhMatch“ editierbar). Nur IDs aus der Kandidatenliste werden übernommen, doppelte nur
  einmal; Ergebnis wird protokolliert (Stufe 3), B1 neu bewertet, ein erneuter Lauf fragt nur noch leere Platzhalter
  an. Ohne Bildarchiv ist der Knopf gesperrt; eine ungültige KI-Antwort ändert nichts und wird gemeldet.

- **PowerPoint aus FINAL: Listen, Bildunterschriften, Tabellen (v2.151.0)**: die PowerPoint-Fassung wurde mit
  LibreOffice gerendert und Folie für Folie angesehen. Behoben: nummerierte Listen hatten zusätzlich einen
  Aufzählungspunkt („• 1. Daten erfassen“) – jetzt Nummer ohne Folien-Aufzählungszeichen, „•“-Zeilen nutzen das
  Aufzählungszeichen der Vorlage, „◦“/„▪“ werden zweite/dritte Ebene. Die Original-Bildunterschrift stand zusätzlich
  als Textpunkt auf der Folie, obwohl das Bild mit Unterschrift auf eigener Folie folgt – jetzt nur noch am Bild.
  Tabellen (vorher Tabulator-Textzeilen) kommen als echte PowerPoint-Tabelle auf eine eigene Folie (Kopfzeile fett und
  hinterlegt, Rahmen, Spaltenbreite nach Inhalt, Schriftgröße nach Spaltenzahl; mehr als 10 Zeilen werden auf
  Folgefolien mit wiederholter Kopfzeile verteilt); Text davor und danach bleibt in der Reihenfolge.

- **Echte Tabellen in FINAL und im Review-PDF, fortlaufende Abbildungsnummern im PDF (v2.150.0)**: Tabellen aus einem
  in FINAL hochgeladenen Handbuch erschienen im Word/PDF als zusammengeklebte Textzeilen („Feld Bedeutung“,
  „LaufzeitMonate“) – jetzt setzt die Ausgabe aufeinanderfolgende Tabellenzeilen wieder als echte Tabelle (Spaltenbreiten
  nach Inhalt, Kopfzeile fett, leere Zellen bleiben erhalten), an derselben Stelle im Kapitel. Dasselbe gilt für das PDF
  des Dokument-Reviews und für Stände, die aus dem Review nach FINAL übernommen werden (vorher „Feld | Wert“-Textzeilen).
  Im PDF waren die Abbildungen je Kapitel neu ab 1 nummeriert („Abbildung 1“ in Kapitel 4) – jetzt fortlaufend über das
  ganze Dokument wie im Word.

- **FINAL: eingebettete Bilder des Handbuchs bleiben an ihrer Stelle (v2.149.0)**: bisher übernahm FINAL aus einem
  hochgeladenen Handbuch nur den Text – eingebettete Bilder fehlten im Master (Word, PDF, PowerPoint), Screens kamen nur
  aus separaten Screens-Dateien ans Kapitelende. Jetzt kommen eingebettete Bilder ins Bildarchiv (Quelldatei = Handbuch,
  Bildtext aus der Bildunterschrift „Abbildung N: …“ darunter bzw. der Kapitelüberschrift) und stehen im Kapiteltext als
  „[Bild: Bildtext]“ genau an ihrer Stelle. Beim Zusammenführen werden sie dort als Bild eingesetzt, mit genau einer
  Bildunterschrift. „[Bild]“-Platzhalter aus dem Text erhalten wie bisher die Screens der gewählten Screens-Datei,
  übrige Screens folgen am Kapitelende; ein „[Bild]“ ohne Screen bleibt offen (Struktur-Prüfung zählt ihn) – nur wenn
  danach im Kapitel noch ein eingebettetes Bild folgt, steht dort „[Bild: kein Screen zugeordnet]“, damit die Bilder
  nicht verrutschen. Hinweis beim Hochladen nennt die Zahl der übernommenen Bilder. Im Beispiel (12 Kapitel, 6 Bilder)
  enthält das FINAL-Word jetzt alle 6 Bilder (vorher 0).

- **FINAL: nummerierte Listen und Aufzählungen bleiben erhalten (v2.148.0)**: beim Hochladen eines Handbuchs in FINAL
  gingen die Nummern Word-nummerierter Listen verloren („Daten erfassen / Prüfen / Speichern“ statt „1. 2. 3.“) –
  gefunden beim Rendern der Word-Ausgaben in v2.146. Jetzt liest FINAL die Listenformate des Dokuments (wie das
  Dokument-Review): nummerierte Listen erhalten „1.“, „2.“ …, Unterebenen werden eigenständig gezählt, Aufzählungen
  erhalten „•“ (Unterebenen „◦“, „▪“); jede neue Liste beginnt wieder bei 1. Ohne Listenformat-Definition in der Datei
  wird eine Liste als Aufzählung übernommen. Im Word-Export stehen Listenzeilen mit hängendem Einzug (Nummer, Tabulator,
  Text) – auch in Editor-, Unterkapitel- und Varianten-Ausgaben, die Listenzeilen enthalten.

- **Dashboard: Einträge und Speicherplatz je Register (v2.147.0)**: neuer, aufklappbarer Bereich „Register – Einträge
  und Speicherplatz“ im Dashboard. Kacheln: Register mit Inhalt (und Einträge gesamt), **belegt** (Größe der Sitzung =
  Sitzungsdatei bzw. automatisches Speichern), **Browser-Speicher belegt** (mit Anteil an der Obergrenze) und **frei**
  (Obergrenze minus belegt, aus `navigator.storage.estimate`). Tabelle mit allen 23 Registern (Import/Tickets, Rovo
  Knowledge, Rovo Summary, Dateiverwaltung, Listenauswahl, Gliederung, Massenverarbeitung, Verarbeitung/RAG, Releaseletter,
  Benutzerhandbuch, Screens-Import, Editor, Unterkapitel, FINAL, VARIANTE, Dokument-Review, Mitteilungen, CROSS_X, AGENT,
  Bilder, Tabelle, Glossar/Synonyme/Abkürzungen, Einstellungen & Protokoll), größtes zuerst: **Einträge**, **belegt**,
  Anteil an der Sitzung (Balken), Ø je Eintrag, **frei** und „Platz für ca. N weitere“ (freier Speicher geteilt durch die
  Durchschnittsgröße des Registers), „→ öffnen“ springt ins Register; Summenzeile. Jedes Feld der Sitzung ist genau einem
  Register zugeordnet, die Summe entspricht der Sitzungsdatei. **Warnung**, wenn der freie Speicher kleiner als die
  doppelte Sitzung ist (automatisches Speichern kann dann fehlschlagen). Liefert der Browser keine Angabe, steht dort
  „unbekannt“. Wird beim Öffnen des Dashboards und per „Aktualisieren“ neu berechnet (bei 3 MB Sitzung ohne spürbare
  Blockade).

- **Optik der Word- und PDF-Ausgaben (v2.146.0)**: die erzeugten Dateien wurden mit LibreOffice gerendert und
  Seite für Seite angesehen (großes Handbuch, 60 Kapitel mit Unterkapiteln, 30 Bilder, Tabellen). Behoben:
  **Inhaltsverzeichnis** (Word) ohne doppelte Nummer – Titel mit eigener Nummer werden nicht mehr zusätzlich
  durchgezählt („1 Verträge anlegen“ statt „1. 1 Verträge anlegen“), Hauptkapitel fett, Unterkapitel eingerückt.
  **Seitenumbruch nur vor Hauptkapiteln**: Unterkapitel laufen auf derselben Seite weiter (Word und PDF; im PDF
  beginnt ein Unterkapitel nur dann auf einer neuen Seite, wenn auf der aktuellen kaum noch Platz ist) – im Beispiel
  Word 124 → 65 Seiten, PDF 143 → 99 Seiten. **Bildunterschrift nicht mehr doppelt**: ein Bildtext, der schon mit
  „Abbildung N:“ beginnt, ergab „Abbildung 1: Abbildung 1: …“, und die Original-Unterschrift des Entwurfs stand
  zusätzlich unter dem Bild – jetzt genau eine Unterschrift (Word, PDF, PowerPoint, Vorschau). **Berichte als Word**
  (Reviewbericht, CROSS_X-Prüfbericht, Releaseletter je Rolle u. a.) mit Formatvorlagen: Überschriften wie im App-Design
  „Standard“, Seitenränder, echte Aufzählungen, **fett** übernommen, Status-Kennungen farbig ([OK] grün, [Hinweis]
  orange, [Fehler] rot, [offen] grau); vorher sahen Überschriften wie Fließtext aus.

- **CROSS_X als Chat mit Zugriff auf alle Register (v2.145.0)**: CROSS_X › „3. Chat mit allen Registern (KI)“
  beantwortet Fragen über **alle Register**: zusätzlich zu Ständen, Matrix, Varianten, Notizen, Verbesserungen, Reviews,
  Tickets, Rollen-Navigation und Glossar jetzt auch **Dokument-Review** (Status/Prüfungen je Dokument, Kapiteltexte,
  KI-Befunde und Verlauf als intern), **AGENT** (Wissensobjekte, Quality-, Impact-, Publishing-Ergebnisse), **Rovo
  Knowledge** (Einträge intern, Zusammenfassungen), **Texte** (Releaseletter, Benutzerhandbuch, Clickanweisung,
  Prozessbild, Rollen-Texte, Handbuch-Kapitel, EDITO, Unterkapitel), **RAG-Bibliothek**, **Bilder** (Beschreibung,
  OCR-Text, Kapitel), **Tabellen**, **Begriffe**, **Gliederung** (inkl. Screen-Platzhalter) und **Protokoll** (intern) –
  jede Quelle einzeln abwählbar mit Anzahl. **Nichts hinzudichten**: der Chat-Prompt erlaubt ausschließlich Inhalte aus
  der Wissensbasis, jede Aussage braucht einen Beleg [#n]; fehlt die Information, lautet die Antwort „Dazu finde ich in
  den Registern keine Information.“ Die App prüft jede Antwort: **ungültige Belegnummern** werden entfernt („[#?]“) und
  gemeldet, **Aussagen ohne Beleg** werden markiert und gezählt, eine Antwort ganz ohne Beleg erhält die Warnung
  „Antwort ohne Quellenbeleg – nicht verwenden.“ **Quellen nach jeder Antwort** („Quellen (n):“) aufklappbar mit dem
  belegten Text und Knopf **„→ Register“**, der das Ursprungsregister öffnet; interne Quellen sind als INTERN markiert
  und mit „Interne Quellen einbeziehen“ abschaltbar (dann auch interne Vermerke im Review-Text entfernt). **Chat-Verlauf**:
  älteste Frage oben, **Folgefragen** berücksichtigen die letzten drei Fragen/Antworten, **Enter sendet**.

- **Dokument-Review: Bilder in Tabellen, Grenzwerte, KI-Konsistenz, vollständigere Übersetzung (v2.144.0)**:
  **Bilder in Tabellen** eines Entwurfs kommen ins Bildarchiv und als belegte Platzhalter direkt hinter die Tabelle
  (Bildtext = Text der Zelle bzw. Zeile); Bilder aus **Kopf-/Fußzeilen** (meist Logos) kommen nur ins Bildarchiv.
  **Prüf-Grenzwerte einstellbar** (aufklappbar unter der Ablage, 22 Werte: Schriftarten, Schriftgrößen inkl.
  Fließtext-Bereich, Zeilenabstand, Farben, Icons, unmarkierte Tipps, Formfehler, KI-Befunde, kurze Kapitel, Satzlänge,
  Schreibweisen, KI-Widersprüche, Qualität OK/Hinweis) – gelten für alle Dokumente der Ablage, bewerten sofort neu,
  „Standard wiederherstellen“. **KI-Konsistenzprüfung** in Stufe 6: Widersprüche zwischen Kapiteln als Tabelle mit
  Vorschlag, einzeln als erledigt markierbar; offene Widersprüche fließen in A1 ein (neuer Prompt). **Übersetzung**:
  Bild- und Tabellen-Platzhalter werden vor der KI geschützt (vorher konnte „[Bild: …]“/„[Tabelle]“ mitübersetzt und
  damit Bilder bzw. Tabellen verloren gehen) und danach wiederhergestellt – auch wenn die KI eine Platzhalterzeile
  weglässt; Bildtexte der Platzhalter, Bildunterschriften im Word und Tabellenzellen werden in einem eigenen
  KI-Aufruf übersetzt (neuer Prompt). Der Translation Agent (AGENT) schützt die Platzhalter ebenfalls.

- **Dokument-Review im Team, kleinere Sitzungsdatei (v2.143.0)**: **Team-Ablage** (VARIANTE › Dokument-Review, sichtbar
  mit geteilter Datenhaltung): je Dokument „Im Team teilen“ bzw. „Team aktualisieren“ – geteilt werden Text (inkl.
  Tabellen), Prüfergebnisse, Stufen, Qualität, KI-Befunde, Änderungen, Verlauf und Ausgabe-Optionen, ohne Bilddaten
  (Bilder als Referenz mit Bildtext). Die Liste „Team-Ablage“ zeigt live alle geteilten Dokumente mit Version, Status,
  Qualität, Stufen, wer geteilt/aktualisiert hat und wann; „Übernehmen“ legt ein lokales Dokument an, „Lokal
  aktualisieren“ holt den neuesten Team-Stand – Bilder werden über Bild-ID und Bildtext dem eigenen Bildarchiv
  zugeordnet (fehlende werden gemeldet). Der Status ist gemeinsam: Änderungen in der Team-Liste oder in der eigenen
  Ablage gelten für alle und erscheinen live bei den anderen; „Team aktualisieren“ überschreibt den gemeinsamen Status
  nicht und nutzt eine kurze Sperre gegen gleichzeitiges Überschreiben. **Kleinere Sitzungsdatei**: abgelegte Dateien
  aus demselben Stand (z. B. Word + PDF + intern) speichern den Text nur einmal; die Blöcke des Registers AGENT werden
  nicht gespeichert (nach dem Laden ist die Extraction „veraltet“ und läuft beim nächsten Orchestrator-Lauf automatisch
  in Millisekunden neu). Im End-to-End-Beispiel sinkt die Sitzung von 5,2 MB auf 4,8 MB (Rest überwiegend Bilder).

- **End-to-End-Test: Korrekturen und Optimierungen (v2.142.0)**: Ergebnis eines Durchlaufs im echten Browser mit großen
  Dokumenten (Handbuch mit 120 Kapiteln/Unterkapiteln, 30 Bildern, Tabellen, Listen, Kommentaren; 80 Screens).
  **PDF-Export**: Bilder werden jetzt komprimiert und je Bild nur einmal eingebettet – das PDF des großen Handbuchs
  schrumpft von 90 MB auf 0,7 MB (betrifft alle PDF-Exporte der App). **Dokument-Review**: KI-Prüfung (Stufe 4) und
  Übersetzung (Stufe 5) bearbeiten 3 Kapitel gleichzeitig statt nacheinander (mit echter KI bei 100+ Kapiteln deutlich
  schneller); die übersetzte Kopie behält jetzt die Tabellen des Entwurfs (fehlten vorher); Statusangaben (verfügbar,
  in Abnahme, in Entwicklung, geplant) erscheinen im Word farbig hinterlegt (Stufe 7, abschaltbar); „Bildvorschläge
  übernehmen“ meldet, wenn bereits alle Platzhalter belegt sind. **AGENT**: Dubletten werden als Gruppen gemeldet
  (Textbausteine ergaben vorher hunderte Einzelpaare, jetzt z. B. 14 Gruppen) und über einen Index der 3-Wort-Folgen
  gesucht statt „jeder mit jedem“; der Classification Agent weist darauf hin, wenn in VARIANTE keine Domänen angelegt
  sind.

- **Register AGENT: 8 Agenten mit Orchestrator (v2.141.0)**: neues Register „AGENT“ (nach CROSS_X). Tabelle der Agenten
  mit Eingabe, Ausgabe, Status und Ergebnis; Auswahl per Häkchen, „Ausführen“ je Agent oder „Orchestrator starten“.
  Der **Orchestrator** führt die gewählten Agenten in fester Reihenfolge aus, ergänzt fehlende oder veraltete
  Vorgänger automatisch (z. B. Knowledge → Extraction + Quality), überspringt abhängige Agenten nach einem Fehler,
  protokolliert jeden Schritt mit Dauer und lässt sich stoppen. **Extraction** (Dateien .docx/.md/.txt, FINAL-Stände,
  Review-Dokumente, Rovo Knowledge → strukturierte Blöcke: Überschrift, Absatz, Liste, Tabelle, Bild, Hinweis; interne
  Vermerke gekennzeichnet). **Classification** (Domäne/Unterdomäne aus VARIANTE, Rolle aus [Rolle: …]-Markierung,
  Quelle oder Schlüsselwörtern, Markt aus einstellbarer Marktliste, Sprache per Texterkennung). **Quality**
  (Gültigkeitsregeln an-/abwählbar, eigene verbotene Begriffe; Lücken, Konflikte – auch zwischen Quellen –, Dubletten
  über Textähnlichkeit, Regelverstöße). **Media** (Bildvorschläge aus dem Bildarchiv je Platzhalter anhand des
  Textumfelds, Untertitelvorschläge aus Bildtext/OCR; ins Bildarchiv übernehmbar). **Knowledge** (Wissensobjekte je
  Kapitel aus geprüften Blöcken – Funktion, Anleitung, Begriff – mit Domäne/Rolle/Markt/Sprache; nach Rovo Knowledge
  übernehmbar, Label „AGENT“). **Translation** (nur freigegebene Revisionen; Glossar, Übersetzungsspeicher, KI;
  Vorschlag als Review-Dokument übernehmbar). **Impact** (alte vs. neue Revision: geänderte/neue/entfernte Kapitel,
  Schlüsselbegriffe; betroffene Handbücher – FINAL-Stände, Varianten, Review-Dokumente – mit Einstufung hoch/mittel).
  **Publishing** (Vorprüfung: Freigabe, leere Kapitel, Lücken, Statusangaben, Jira, interne Vermerke, Bilder, Review-
  Stufen, Quality-Befunde → bereit / mit Hinweisen / blockiert; Renderingauftrag als JSON; „Rendering ausführen“ erzeugt
  Word/PDF). Mit „mit KI verfeinern“ verbessert Claude Klassifikation, Qualitätsprüfung, Untertitel und Wissensobjekte
  (4 neue, bearbeitbare Prompts; nur erlaubte Werte werden übernommen). Laufbericht (Markdown) und Ergebnisse als Excel.

- **Dokument-Review: Dateien je Version, PDF, Übergabe an FINAL und Release-Paket (v2.140.0)**: **Ablage bewahrt
  Dateien auf** – jedes erzeugte Word (Verteilung/intern), PDF und jeder Reviewbericht wird mit Zeitpunkt, Version und
  Status beim Dokument abgelegt (Spalte „Dateien“, aufklappbare Liste, höchstens 25 je Dokument) und lässt sich später
  erneut herunterladen – aus dem damaligen Stand (Text, Bilder, Design-Wahl, Deckblatt-Datum), auch wenn der Text
  inzwischen geändert wurde. Eine neue Version startet ohne abgelegte Dateien. **PDF für die Verteilung** in Stufe 7
  (Deckblatt, Inhaltsverzeichnis, Seitenzahlen; ohne interne Vermerke und Jira-Nummern; Tabellen als Textzeilen).
  **Als Stand nach FINAL übernehmen**: legt die Verteilfassung als neuen FINAL-Stand (Herkunft „Review“, Status
  Entwurf) mit den zugeordneten Bildern an – nutzbar für Varianten und CROSS_X. **Release-Paket** (Schritt 5): neue
  Option „Geprüfte Dokumente aus dem Review“ – freigegebene und verteilte Dokumente kommen als Word in den Ordner
  „Dokumente“ (bzw. „Alle“ bei Ordnern je Rolle); die LIESMICH.md weist auf nicht abgeschlossene Review-Stufen hin.

- **Dokument-Review: Formatierung erhalten, Inhalt bereinigen, Design korrigieren (v2.139.0)**: **Formatierung** – beim
  Einlesen eines Entwurfs bleiben Fett (`**…**`), Kursiv (`__…__`), Aufzählungen (• / ◦ / ▪ je Ebene, nummerierte
  Listen als „1.“, „2.“ – aus der Word-Nummerierung) und Tabellen (Platzhalter `[Tabelle]` mit gesicherten Zellen)
  erhalten; die Word-Ausgabe setzt sie wieder als echte Fett-/Kursiv-Läufe, eingerückte Aufzählungen und Word-Tabellen
  um. Jira-Nummern in Tabellen werden mitgezählt, mit „Jira-Nummern löschen“ entfernt und in der Verteilfassung
  ausgelassen. **Inhalt (Stufe 2)** – neue Knöpfe „Planungen als intern markieren“, „Test-Hinweise als intern markieren“
  (die Zeilen fehlen in der Verteilfassung und erscheinen intern als „[Intern: …]“) und „Interne Vermerke löschen“ (nach
  Bestätigung). **Design (Stufe 1)** – Ziel-Design für die Ausgabe wählbar (Entwurf, FINAL-Originaldesigns, eigene
  Vorlage, App-Designs); „Ausgabe prüfen“ bewertet D1–D4 an der tatsächlichen Word-Ausgabe. „Tipps/Hinweise markieren“
  setzt `[Tipp]`, `[Hinweis]` bzw. `[Warnung]` vor Zeilen wie „Tipp:“, „Info:“, „Achtung:“ (im Word farbig hervorgehoben);
  D5 prüft das jetzt am aktuellen Text und meldet mehr als 5 verschiedene Icons als uneinheitlich.

- **Dokument-Review: Bilder aus Entwürfen, Status-Legende, Ablage als Excel (v2.138.0)**: **Eingebettete Bilder** eines
  hochgeladenen Entwurfs (.docx) kommen ins Bildarchiv (Screens-Import/Bilder, Quelldatei = Entwurf); an ihrer Stelle
  steht ein Platzhalter „[Bild: Bildunterschrift]“, der gleich mit dem Bild belegt ist – die Bilder bleiben so in der
  Word-Ausgabe erhalten und lassen sich in Stufe 3 tauschen oder ergänzen. Bildunterschrift: Text im Bild-Absatz, sonst
  die folgende Zeile „Abbildung …“/„Bild …“, sonst die Kapitelüberschrift. **Status-Legende**: in Stufe 7 optional ein
  Kapitel „Statusangaben“ am Anfang des Word-Dokuments mit der Erklärung der im Text vorkommenden Status (verfügbar,
  in Abnahme, in Entwicklung, geplant). **Ablage als Excel**: Blatt „Ablage“ (je Dokument Version, Status, Quelle,
  Sprache, Qualität jetzt/Start, Stufen, Änderungen, Zählung und alle 20 Prüfergebnisse), „Befunde“ (20 je Dokument mit
  Stufe und Befundtext) und „Verlauf“ (Status-/Versionsverlauf und Änderungen).

- **VARIANTE: Dokument-Review – 20 Prüfungen in 7 Stufen (v2.137.0)**: neuer Abschnitt „6. Dokument-Review“
  im Register VARIANTE. **Eingang**: Entwürfe als Word (.docx, mehrere auf einmal) hochladen oder einen bestehenden
  Stand aus FINAL/VARIANTE übernehmen. **Ablage**: alle Dokumente mit Version (1.0, „Neue Version“ → 1.1), Status
  (Entwurf, In Review, Geprüft, Freigegeben, Verteilt – automatisch fortgeschrieben und manuell änderbar), Quelle,
  Qualitätswert, abgeschlossenen Stufen, Anzahl Änderungen und Verlauf; je Dokument Reviewbericht, Word, neue Version,
  Löschen. **Dashboard**: Kacheln (Qualität 0–100 mit Startwert, Prüfungen OK/Hinweis/Fehler/offen, Stufen, Änderungen,
  Jira-Nummern, interne Vermerke, belegte Bild-Platzhalter) und 20 farbige Prüf-Chips. **Die 7 Stufen** (einzeln
  abschließbar, „weiter“ zur nächsten): 1 *Design* – Schriftarten, Schriftgrößen, Zeilenabstand und Farbpalette aus
  Formatvorlagen, Theme und direkter Formatierung der .docx, Icons/Symbole, markierte und unmarkierte Tipps/Hinweise,
  interne Bemerkungen (Kommentare, Hervorhebungen); bestehende Stände werden über ihre Word-Ausgabe analysiert.
  2 *Inhalt* – Jira-Nummern (Anzeige mit/ohne, „Jira-Nummern löschen“), Planungen/Termine, interne Vermerke, Test-
  Hinweise und Statusangaben (verfügbar, in Abnahme, in Entwicklung, geplant) mit Legende und Tabelle; „geplant“/„in
  Entwicklung“ zusammen mit „steht ab sofort zur Verfügung“ wird als Widerspruch markiert. 3 *Bilder* – Platzhalter
  („[Bild]“, „[Bild: …]“, „Screenshot: …“) mit Bildvorschlag aus dem Bildarchiv, je Platzhalter bis zu 3 Bilder.
  4 *Qualität* – Form-/Tippfehler (mit automatischer Korrektur), KI-Prüfung Grammatik/Fehler/Lücken je Kapitel mit
  übernehmbaren Vorschlägen (neuer bearbeitbarer Prompt), leere/kurze Kapitel, Satzlänge. 5 *Übersetzung* – Kopie
  der Version in einer Zielsprache als eigenes Dokument (Glossar und Übersetzungsspeicher, interne Vermerke
  geschützt). 6 *Abschluss* – Änderungen je Stufe, Vergleich vorher/nachher je Kapitel, Qualität vorher → jetzt,
  Konsistenz (Schreibweisen wie E-Mail/Email, Nummerierung). 7 *Finalisierung* – Word für die Verteilung (ohne
  Kommentarbereiche, Intern/TODO-Zeilen und Jira-Nummern, Bilder an den Platzhaltern, Design des Entwurfs bzw. aus
  FINAL) oder intern mit Vermerken als „[Intern: …]“. **Reviewbericht** als Word oder Markdown. Text je Kapitel mit
  Markierungen ansehen und direkt bearbeiten. Alles wird in der Sitzung gespeichert.

- **Screens zu Platzhaltern: OCR vorab, Excel-Liste, fehlende Screens (v2.136.0)**:
  **OCR vor dem Zuordnen** – Option „Vorher Bildtext per OCR erkennen“: Screens ohne erkannten
  Bildtext (z. B. nur „Abbildung 3“ als Überschrift) werden vor dem Zuordnen per OCR gelesen
  (derselbe Tesseract-Worker-Pool wie im Register „Bilder“, nur Text, keine Kapitel-KI); bereits
  gelesene Screens werden nicht erneut verarbeitet. Ohne OCR-Bibliothek gibt es einen Hinweis und
  die Zuordnung läuft trotzdem. **Liste als Excel** mit drei Blättern: „Platzhalter“ (Nr., Kapitel,
  Beschreibung, Status aus der Quelle und neuer Status, Screens als „Quelldatei #Screen-Nr.“,
  Trefferquote, Zuordnung Text/KI/manuell), „Zuordnung“ (je zugeordnetem Screen eine Zeile mit
  Quelldatei, Screen-Nr., Bildtext, Trefferquote, Rolle, Sprache) und „Fehlende Screens“ (offene
  Platzhalter mit Rollen-/Sprachfilter, bester zu schwacher Kandidat, leere Spalte „Aufgenommen am“).
  **Fehlende Screens** werden unter der Tabelle genannt und lassen sich als Aufnahme-Liste
  (Markdown, Checkboxen je Platzhalter, nach Hauptkapitel gruppiert) herunterladen.

- **Screens-Import: schneller, Rolle/Sprache je Datei, Screens zu Platzhaltern (v2.135.0)**:
  **Performance** – gemessen mit 4 Word-Dateien / 240 Screens (44 MB) im Browser: Import von
  ~10,6 s auf ~1,9–2,8 s, längste Blockade der Oberfläche von ~3,4 s auf ~0,3–0,7 s. Ursachen laut
  CPU-Profil: Tabelle und Galerie im Register „Bilder“ wurden nach jeder Datei komplett neu gezeichnet
  (auch unsichtbar), die Screens-Tabelle schrieb alle Bilder als Base64 ins HTML, Bilddaten wurden in
  JavaScript Base64-kodiert. Jetzt: Galerie wird nur vorgemerkt und beim Öffnen gezeichnet, die
  Screens-Tabelle einmal je Upload-Stapel mit schlanken Blob-Vorschauen (lazy), Bilddaten nativ und
  parallel umgewandelt; Dateien erscheinen sofort mit Status „Wartet …“/„Wird verarbeitet …“.
  **Metadaten** – Rolle und Sprache für neu hochgeladene Dateien wählbar; die Dateiübersicht zeigt je
  Datei Rolle, Sprache (änderbar, wirkt auf deren Screens) und Einlesedatum; die Screens-Tabelle zeigt
  „Rolle · Sprache“. **Screens zu Platzhaltern** – neuer Bereich am Ende: Platzhalter-Datei einlesen
  (Excel, Word-Tabelle, Text/CSV/TSV oder Zeilen einfügen; je Zeile Nr., Kapitel, Beschreibung
  „Screenshot: …“, Status), je Platzhalter bis zu 1–3 passende Screens zuordnen (idf-gewichtete
  Begriffe aus Bildtext, OCR-Text, Kapitel/Unterkapitel; Teilwort-Treffer, Kapitel-Bonus; Filter nach
  Rolle/Sprache; ohne ausreichenden Treffer bleibt der Platzhalter „offen“), Screens entfernen (×) oder
  ergänzen, optional „Mit KI verfeinern“ (neuer RAG-Prompt, JSON, nur vorgeschlagene Kandidaten), und
  „Datei mit Screens herunterladen (Word)“: Tabelle Nr. | Kapitel | Beschreibung | Screens (Bilder mit
  Bildunterschrift) | Status. Gespeichert in der Sitzung.
  Test: `webapp/tests/screens_placeholder_test.js`.
- **Register CROSS_X – Wissensagent für Cross-Reference-Prüfungen über Kapitel und Rollen (v2.134.0)**:
  Neues Register nach „Mitteilungen“. (1) **Wissensbasis** aus wählbaren Quellen: Kapiteltexte der
  gewählten FINAL-Stände (Basis + Varianten, inkl. interner Vermerke als ⟦INTERN: …⟧ und
  Rollen-Bedingungen), Matrix (aktive Rollen je Kapitel), Varianten (Inhaltsverzeichnis, Verweise,
  Status), interne Mitteilungen, ROVO-Verbesserungen mit Status, Prüfberichte und letzte
  Review-Ergebnisse, Jira-Tickets mit Rollen (inkl. manueller Zuordnung), Rollen-Navigation, Glossar;
  interne Quellen sind als INTERN gekennzeichnet und per Schalter ausschließbar; Einträge mit
  Nummer [#n] einsehbar. (2) **Cross-Reference-Prüfung nach Regeln (ohne KI)**: Kapitelverweise
  („siehe/vgl. Kapitel n“) ins Leere, auf je Rolle ausgeblendete Kapitel oder mit geänderter Nummer
  in der Rollen-Variante; Rollen-Verweise ohne passende Rollen-Variante in derselben Sprache; Themen
  in keiner Rolle; unbekannte Rollen in Rollen-Bedingungen; Kapitel, die durch Rollen-Bedingungen
  leer würden; Jira-Tickets im Text, deren Rolle nicht zu den aktiven Rollen des Kapitels passt bzw.
  nicht geladen sind; offene ROVO-Punkte in veröffentlichten Varianten; fällige interne Mitteilungen –
  mit Schweregrad (Fehler/Warnung/Hinweis) und Filter. (3) **Wissensagent (KI)**: Fragen über alle
  Kapitel und Rollen; die passendsten Einträge werden ausgewählt, die Antwort belegt Aussagen mit
  [#n] (zitierte Quellen aufklappbar, interne markiert); **KI-Cross-Check** über Kapitel & Rollen auf
  Basis von Wissensbasis und Regel-Befunden. Zwei neue, unter RAG editierbare Prompts. (4) **Interner
  Prüfbericht** als Markdown/Word (als INTERN gekennzeichnet). Verlauf, Quellen- und Stand-Auswahl
  werden in der Sitzung gespeichert; nichts davon gelangt in Dokumente, Releaseletter oder das
  Release-Paket. Test: `webapp/tests/crossx_test.js`.
- **Release-Paket – alle Ergebnisse eines Releases in einer ZIP (v2.133.0)**: Neuer Schritt
  „5. Release-Paket“ im Register VARIANTE. Bündelt die Releaseletter je Rolle (aus dem Register
  Releaseletter, Word und optional Markdown), die erzeugten Benutzerhandbuch-Varianten (Word im
  Design aus FINAL) und die Übersichten als Excel (Varianten-Übersicht, Tickets je Rolle) – wahlweise
  in Ordnern je Rolle (`Retail/…`, `MO/…`, `Uebersichten/…`) oder je Dokumentart (`Releaseletter/…`,
  `Benutzerhandbuch/…`). „Paket-Inhalt anzeigen“ listet jede Datei mit Art, Rolle, Sprache und Hinweis;
  die beiliegende `LIESMICH.md` enthält diese Tabelle und Hinweise auf veraltete Varianten, Stände
  noch nicht im Status „Veröffentlicht“ und Rolle/Sprache-Kombinationen, für die nur ein Releaseletter
  oder nur ein Benutzerhandbuch vorliegt. Release-Name frei wählbar (Vorgabe aus dem Releaseletter);
  interne Mitteilungen und Prüfberichte sind nie enthalten.
  Test: `webapp/tests/release_package_test.js`.
- **Releaseletter je Rolle – Rollen-Zuordnung prüfen, manuell setzen, per KI vorschlagen (v2.132.0)**:
  Der aufklappbare Bereich „Rollen-Zuordnung prüfen (n manuell)“ zeigt die Tickets der aktuellen
  Auswahl (wahlweise nur die ohne Rolle) mit den Rollen aus Jira-/automatischen Labels und je Rolle
  einem Häkchen. Geänderte Häkchen setzen eine manuelle Zuordnung, die Vorrang vor den Labels hat
  (↺ zurück zu den Labels). „Rollen per KI vorschlagen“ fragt für die angezeigten Tickets (max. 60)
  anhand von Zusammenfassung und Beschreibung Rollen ab (neuer, unter RAG editierbarer Prompt;
  Antwort als JSON, nur gültige Rollen werden übernommen); Vorschläge werden erst nach „Übernehmen“
  bzw. „Alle Vorschläge übernehmen“ wirksam, ungültige Antworten werden verständlich gemeldet. Die
  Releaseletter je Rolle und die Excel-Übersicht (neue Spalte „Quelle“: Label/manuell) nutzen die
  manuelle Zuordnung; sie wird in der Sitzung gespeichert.
  Test: `webapp/tests/releaseletter_role_assign_test.js`.
- **Releaseletter je Rolle und Sprache (v2.131.0)**: Im Register Releaseletter erzeugt der neue
  Bereich „Releaseletter je Rolle“ aus derselben Ticket-Auswahl wie der Haupt-Entwurf (Name,
  gefilterte Tickets bzw. Ticket-Liste) je gewählter Rolle (Retail, Markt, MO, HQ, IT) und Sprache
  (Deutsch/Englisch) einen eigenen Releaseletter. Ein Ticket gehört zu einer Rolle über sein
  Rollen-Label (Jira-Label oder automatisches Label); Tickets ohne Rollen-Label werden wahlweise in
  alle Releaseletter aufgenommen. Jeder Brief enthält den passenden Rollenhinweis (oneSCM-Navigation)
  und optional den Abschnitt „Änderungen für andere Rollen“ (Ticket, Zusammenfassung, betroffene
  Rollen). Tabelle mit Ticketzahlen je Brief, Vorschau, Download je Brief als Markdown oder Word,
  „Alle als ZIP (Word + Markdown)“ und „Übersicht Ticket × Rolle (Excel)“.
  Test: `webapp/tests/releaseletter_roles_test.js`.
- **FINAL Schritt 7 – Rollen-Markierungen sichtbar, „Ansicht als Rolle“ (v2.130.0)**: Enthält die neue
  Zusammenführung Rollen-Markierungen, zeigt Schritt 7 sie als farbige Badges („Nur: Retail, MO“,
  „Nicht: IT“, „Ende Rollen-Block“) statt als Rohtext. Darunter erscheint „Ansicht als Rolle“: mit
  gewählter Rolle werden Absätze, die diese Rolle nicht sieht, durchgestrichen und abgeschwächt
  dargestellt – oder mit „ausgeblendete Absätze weglassen“ ganz entfernt, sodass der Text wie in der
  späteren Variante aussieht; ein Hinweis zählt die betroffenen Absätze. Screens bleiben dabei
  korrekt zugeordnet (auch wenn ein [Bild] im ausgeblendeten Block liegt). Gilt auch für „Gesamtes
  Dokument“ und die Vollbild-Ansicht; Kapitel ohne Markierungen und die Quellversion bleiben
  unverändert, bei Dokumenten ohne Markierungen ist die Steuerung ausgeblendet. Rollenliste aus
  VARIANTE (inkl. eigener Rollen). Test: `webapp/tests/final_role_view_test.js`.
- **VARIANTE – Übersetzungsspeicher (v2.129.0)**: Jede KI-Übersetzung eines Kapitels wird je
  Sprache unter einem Fingerabdruck der Quelle gespeichert (Titel, Text nach Rollen-Bedingungen und
  Verweis-Hinweisen, verwendete Glossar-Begriffe). Beim Neu-Erzeugen werden unveränderte Kapitel ohne
  KI-Aufruf aus dem Speicher übernommen – nur geänderte Kapitel (oder solche mit geändertem
  Glossar-Begriff) werden neu übersetzt; die Bilanz zeigt „n übersetzt, m aus Übersetzungsspeicher“.
  **„Korrekturen merken“** (bei übersetzten Varianten) übernimmt im Stand korrigierte Titel/Texte –
  z. B. nach Überarbeitung im Editor – in den Speicher, sodass Neu-Erzeugen die korrigierte Fassung
  behält (abgelehnt, wenn die Kapitelstruktur des Stands verändert wurde). Anzeige „Übersetzungs-
  speicher: n Kapitel (EN …, FR …)“ und „Übersetzungsspeicher leeren“ (mit Rückfrage); gespeichert in
  der Sitzung (Herkunft „KI“ bzw. „Korrektur“). Ohne KI werden vorhandene Speichertreffer trotzdem
  übernommen. Test: `webapp/tests/variante_tm_test.js`.
- **VARIANTE – Glossar für Übersetzungen, Volltext-Vorschau (v2.128.0)**: Neuer Bereich „Glossar
  für Übersetzungen (n)“ mit verbindlichen Fachbegriffen je Zielsprache (Begriff → Übersetzung),
  manuell pflegbar (gleicher Begriff/Sprache wird aktualisiert statt doppelt angelegt), als Excel
  exportierbar und aus Excel ladbar – breit (Spalte „Begriff“ und je Sprache eine Spalte EN, FR, …)
  oder lang („Begriff“, „Sprache“, „Übersetzung“). Beim Übersetzen bekommt die KI je Kapitel nur die
  Glossar-Begriffe der Zielsprache, die im Kapitel vorkommen; anschließend wird geprüft, ob die
  vorgegebene Übersetzung verwendet wurde – Abweichungen erscheinen je Variante aufklappbar
  („„Vertrag“ → „contract“ nicht verwendet“). Glossar-Änderungen machen nur Varianten der
  betroffenen Sprache „veraltet“. In der Inhaltsverzeichnis-Vorschau zeigt **„Volltext anzeigen“**
  den Text der Variante, wie ihn die Rolle sieht (Rollen-Bedingungen angewendet, Verweis-Hinweise,
  Screens als Platzhalter; bei Fremdsprachen vor der Übersetzung).
  Test: `webapp/tests/variante_glossary_test.js`.
- **VARIANTE – saubere Ausgaben, alle Varianten als ZIP, Varianten-Übersicht (v2.127.0)**:
  Rollen-Markierungen (`[Rolle: …]`, `[Nicht Rolle: …]`, `[/Rolle]`) erscheinen in keiner Ausgabe
  des Basisdokuments mehr – FINAL Word und PowerPoint, Schritt 9 (Gesamtdokument-Vorschau, Word,
  PDF, Agenten-Prompts) –, der Inhalt aller Absätze bleibt dabei vollständig; im Stand selbst bleiben
  sie zum Bearbeiten erhalten. Neu in VARIANTE: **„Alle Varianten als ZIP (Word)“** (je erzeugter
  Variante ein Word im Word-Design aus FINAL; Hinweis, wenn darunter veraltete sind) und
  **„Varianten-Übersicht als Excel“** mit Blatt „Kapitel je Variante“ (Basis-Kapitel × Varianten:
  neue Nummer bzw. „→ Rollen“ als Verweis oder „–“) und Blatt „Varianten“ (Rolle, Sprache, Kapitel
  aktiv/ausgelassen, Verweise, Stand, Status aktuell / veraltet / nicht erzeugt).
  Test: `webapp/tests/variante_exports_test.js`.
- **VARIANTE – Rollen-Bedingungen im Text, veraltete Varianten, Matrix als Excel (v2.126.0)**:
  (1) **Rollen-Bedingungen auf Absatz-Ebene** im Basisdokument: `[Rolle: Retail, MO] Text` bzw.
  `[Nicht Rolle: IT] Text` gilt für diesen Absatz; steht die Markierung allein in einer Zeile, gilt
  sie für alle folgenden Absätze bis `[/Rolle]`. Screens ([Bild]) in ausgeblendeten Absätzen
  entfallen mit; die Markierungen erscheinen in keiner Variante; Schritt 2 zählt die Bedingungen je
  Kapitel. (2) **Veraltete Varianten**: Jede erzeugte Variante merkt sich einen Fingerabdruck von
  Basisdokument und Plan (Matrix, Optionen, Sprache); weicht er ab, zeigt die Tabelle „veraltet:
  Basisdokument geändert / Matrix/Optionen geändert“, und „Veraltete Varianten aktualisieren (n)“
  erzeugt genau diese neu. Ist ein anderes Basisdokument gewählt, überträgt „Varianten auf dieses
  Basisdokument übertragen (n)“ die Varianten (bestehende Rolle/Sprache-Kombinationen werden
  übersprungen); beim Neu-Erzeugen wird derselbe FINAL-Stand mit neuer Basis aktualisiert.
  (3) **Matrix als Excel** (Typ, Domäne, Unterdomäne, Kapitel, je Rolle „x“ = aktiv, Hinweis auf
  manuelle Abweichungen) exportieren und bearbeitet wieder einlesen: fehlende Domänen/Unterdomänen
  und neue Rollen werden angelegt, Kapitel-Zuordnungen übernommen, abweichende Kapitel als „manuell“
  geschaltet, unbekannte Kapitel übersprungen (mit Bilanz).
  Test: `webapp/tests/variante_conditions_test.js`.
- **Register VARIANTE – Varianten je Rolle & Sprache aus einem Dokument (v2.125.0)**: Neues Register
  nach FINAL. (1) **Basisdokument**: ein FINAL-Stand und seine Sprache. (2) **Domänen &
  Unterdomänen** anlegen bzw. aus Gliederung (Kapitel-Domänen) und Tickets übernehmen; jedes Kapitel
  (auch Unterkapitel) einer Domäne/Unterdomäne zuordnen – automatisch über Gliederung bzw.
  Domänen-Namen in Titel/Text oder per Auswahl; Unterkapitel ohne eigene Zuordnung folgen ihrem
  Kapitel, Kapitel ohne Domäne gelten als „Allgemein“ (alle Rollen). (3) **Matrix Domäne · Rolle ·
  Kapitel**: Spalten = Rollen (Markt, MO, Retail, IT, HQ, eigene Rollen ergänzbar), Zeilen = Domäne ›
  Unterdomäne › Kapitel; Domänen und Unterdomänen je Rolle aktivieren/deaktivieren, einzelne Kapitel
  abweichend schalten („manuell“, ↺ zurücksetzen); Fußzeile zählt die aktiven Kapitel je Rolle.
  (4) **Varianten** je Rolle und Sprache (einzeln oder als Kombinationen Rollen × Sprachen), mit
  Vorschau des **geänderten Inhaltsverzeichnisses** (neu nummeriert 1, 1.1 …; ausgelassene Themen
  durchgestrichen mit Verweis-Rollen). Beim Erzeugen entsteht je Variante ein eigener FINAL-Stand
  (Herkunft „Variante“, Konfiguration „Variante Rolle · Sprache aus …“) mit Screens und
  ROVO-Verbesserungen der übernommenen Kapitel; **Verweise auf andere Rollen** als Hinweis an der
  Stelle des ausgelassenen Themas und als Verweis-Kapitel „Themen in anderen Rollen-Handbüchern“
  am Ende (Texte in DE/EN/FR/IT/ES/NL). Fremdsprachige Varianten übersetzt die KI kapitelweise
  (neuer RAG-Prompt); Übersetzungen, die Bild-Platzhalter oder Jira-Nummern verändern, werden
  verworfen (Kapitel bleibt unverändert, Bilanz in der Tabelle). Erneutes Erzeugen aktualisiert den
  Stand (veröffentlichte Stände bleiben unangetastet, dann neuer Stand); „In FINAL öffnen“ und
  „Word“ (Deckblatt in Zielsprache, Word-Design aus FINAL) je Variante. Alles wird in der Sitzung
  gespeichert. Test: `webapp/tests/variante_test.js`.
- **FINAL Schritt 9 – Review-Befunde übernehmen, Ergebnisse je Stand (v2.124.0)**: Unter den
  Agenten-Berichten listet „Befunde übernehmen (n)“ alle Stichpunkte der KI-Berichte (ohne
  „Keine gefunden.“ und ohne die deterministische Struktur-Prüfung) mit Agent und automatisch
  erkanntem Kapitel – aus dem Stichpunkt selbst (voller Titel oder Kurzname ohne „Kapitel n:“)
  oder aus der vorangehenden Kapitel-Zeile/Überschrift; das Kapitel ist je Befund änderbar.
  Markierte Befunde lassen sich **als Verbesserungen** übernehmen (beim Kapitel mit Herkunft
  „[Review – Agent]“ und Status „offen“, sichtbar in Schritt 7 und in der Struktur-Prüfung, und
  direkt vom Editor-Agenten „Verbesserungen einarbeiten“ umgesetzt) oder **als interne Mitteilung
  „Offene Punkte“** (wöchentliches Intervall) am Stand festhalten. Bereits übernommene Befunde sind
  gesperrt; bei veröffentlichten Ständen ist die Übernahme als Verbesserung gesperrt. Die
  Review-Ergebnisse werden je Stand gespeichert (auch in der Sitzung) und beim Wechsel zurück
  wiederhergestellt. Test: `webapp/tests/final_review_findings_test.js`.
- **FINAL Schritt 9 – Gesamtdokument & Review mit Agenten (v2.123.0)**: Die Stufe „6. Gesamtdokument“
  aus dem Register Editor steht jetzt auch am Ende von FINAL. Für den gewählten Stand (Auswahlfeld
  synchron zu Schritt 7/8) wird ein Gesamtdokument als Word (im gewählten Word-Design) **und** PDF
  erzeugt – mit Deckblatt, Inhaltsverzeichnis, Seitenzahlen und den zugeordneten Screens; Vorschau
  aller Kapitel. Danach prüfen frei auswählbare Agenten das Dokument, nacheinander und jederzeit
  stoppbar: **Struktur-Prüfung** (ohne KI: reale PDF-Seitenzahl, Screens je [Bild]-Platzhalter,
  leere Kapitel, Screens ohne Untertitel, offene ROVO-Verbesserungen, Inhaltsverzeichnis),
  **Inhalt & Qualität**, **Sprache & Stil** (Bericht, ohne Umschreiben), **Kapitelübergreifende
  Konsistenz** und **Vollständigkeit & Abdeckung** (ROVO-Verbesserungen mit Status, Tickets, Lücken
  im Ablauf). Die Agenten ändern nichts; der Gesamtbericht lässt sich an den Stand anhängen
  („Prüfbericht (n)“ in den Ständen), als Word/Markdown herunterladen, und der Stand lässt sich
  direkt im Editor optimieren. Interne Mitteilungen gelangen weder ins Gesamtdokument noch in die
  Agenten-Prompts. Zwei neue, unter RAG editierbare Prompts (Sprache & Stil, Vollständigkeit).
  Test: `webapp/tests/final_review_agents_test.js`.
- **Register „Mitteilungen“ – Übersicht aller internen Mitteilungen (v2.122.0)**: Neues Register
  direkt nach FINAL. Es bündelt die internen Mitteilungen aller FINAL-Stände und der Register
  Releaseletter, Benutzerhandbuch, Prozessbild und Clickanweisung in einer Tabelle (Fälligkeit,
  Kategorie, Titel/Inhalt, Ort, zuletzt aktualisiert von), fällige zuerst. Filter nach Ort,
  Kategorie, Fälligkeit (fällig / aktuell / ohne Intervall) und Volltextsuche. Je fälliger Zeile
  „Geprüft – unverändert“, zusätzlich „Alle angezeigten fälligen: Geprüft – unverändert“ (mit
  Rückfrage); „Öffnen“ springt an den Ort (FINAL-Stand bzw. Register mit aufgeklappten
  Mitteilungen). Die gefilterte Liste lässt sich als Excel bzw. Markdown herunterladen –
  ausdrücklich als interne Liste gekennzeichnet; Dokumente und Releaseletter bleiben unberührt.
  Ein Zähler am Navigationspunkt zeigt die Zahl der fälligen Mitteilungen.
  Test: `webapp/tests/notes_overview_test.js`.
- **Interne Mitteilungen auch in den Registern + Dashboard-Übersicht (v2.121.0)**: Die Register
  Releaseletter, Benutzerhandbuch, Prozessbild und Clickanweisung haben oben einen aufklappbaren
  Abschnitt „Interne Mitteilungen (n)“ mit denselben Funktionen wie in FINAL (Kategorie, Titel,
  Text, Intervall, Speichern mit Verlauf, „Geprüft – unverändert“, Löschen). Die Mitteilungen
  erscheinen nie in Vorschau oder Exporten dieser Register (Markdown, Word, PDF, Excel). Das
  Dashboard zeigt alle fälligen Mitteilungen aus Registern und FINAL-Ständen mit „Öffnen“, das
  direkt ins Register (aufgeklappt) bzw. zum Stand springt. Gespeichert in der Sitzung
  (`docNotes`); die Karten-Darstellung und die Aktionen sind jetzt eine gemeinsame Komponente
  für FINAL und Register.

- **FINAL – Interne Mitteilungen je Dokument (v2.120.0)**: Jeder Stand (internes Dokument) hat
  eigene interne Mitteilungen – z. B. „Version Screen“, „Ideenspeicher“, „Neue Features“, „Offene
  Punkte“ oder eigene Kategorien –, die **nie** im Dokument (Word, PDF, PowerPoint, Ergebnis in
  Schritt 7) oder im Releaseletter erscheinen.
  - „Mitteilungen (n)“ in der Stände-Tabelle öffnet die Liste: Kategorie, Titel, Text und ein
    Aktualisierungs-Intervall (ohne, wöchentlich, alle 2 Wochen, monatlich, quartalsweise).
  - Je Mitteilung „zuletzt aktualisiert … von …“ und „nächste Aktualisierung fällig am …“;
    überfällige Mitteilungen werden hervorgehoben und in einer Übersicht über alle Stände sowie
    als „x fällig“ am Stand und im Register Editor angezeigt.
  - „Speichern“ übernimmt Änderungen (der vorherige Text bleibt im Verlauf), „Geprüft – unverändert“
    bestätigt die regelmäßige Durchsicht ohne Änderung und setzt die Fälligkeit neu.
  - Mitteilungen lassen sich aus einem anderen Stand kopieren; sie werden beim Optimieren im
    Editor in den neuen Stand übernommen und im Team (nur mit Konto-IDs) mitgeteilt bzw.
    beim Übernehmen eines Team-Stands mitgeholt. Gespeichert in der Sitzung.

- **FINAL – Team-Arbeit an gemeinsamen Ständen (v2.119.0)**: nutzt die geteilte Datenhaltung des
  Artifacts (Fähigkeit `db`, Standardrechte: alle mit Zugriff lesen, ab „Contributor“ schreiben).
  - **Im Team teilen**: Ein lokaler Stand wird als Team-Stand veröffentlicht (Sammlung
    `teamstands`, ein Dokument je Stand, max. ca. 240 KB Text). Bilddaten werden nicht geteilt – je
    Screen nur Referenz und Bildunterschrift; gespeichert werden nur Konto-IDs, Namen werden beim
    Anzeigen über `user.profiles()` aufgelöst. „Team-Stand aktualisieren“ schreibt eine neue Fassung
    (auch eine im Editor optimierte) zurück; Status und Historie des Team-Stands bleiben dabei
    maßgeblich.
  - **Live für alle**: Liste der Team-Stände mit „geteilt von … am …“, Status (gemeinsam setzbar, mit
    Historie und Konto-ID; Regeln wie lokal: Bearbeiter nötig, Veröffentlichen nur mit
    Bearbeitungsrecht, Zurücksetzen mit Bestätigung), Bearbeitungsstand und Kommentaren
    (`teamstands/<id>/comments`, live). Verknüpfte lokale Stände übernehmen den Team-Status automatisch.
  - **Bearbeitungssperre**: „Bearbeitung übernehmen“ holt eine kurze Lease (2 min, automatisch
    verlängert) und markiert den Stand für alle als „wird bearbeitet von …“; andere können dann weder
    Status setzen noch überschreiben. „Bearbeitung beenden“ gibt den Hinweis frei, die Lease läuft
    spätestens nach zwei Minuten ab (auch wenn die App einfach geschlossen wird).
  - **Übernehmen**: holt einen Team-Stand als lokalen Stand (Status, Historie, Verbesserungen,
    Prüfberichte); Screens werden über eigene Bilder zugeordnet, sonst als „(Screen: Bildunterschrift)“.
  - Ohne geteilte Datenhaltung (lokal geöffnet) bleibt der Bereich mit Hinweis deaktiviert.
  - Test mit zwei gleichzeitigen Nutzern (zwei Browser-Instanzen, gemeinsame simulierte Datenhaltung).

- **FINAL/Editor – Anmeldung, Prüfbericht-Ablage, Stände vergleichen (v2.118.0)**:
  - **Bearbeiter aus dem claude.ai-Konto**: Die App fragt über die Artifact-Fähigkeit `user`
    (Scope „profile“) die angemeldete Person ab. Ist ein Name verfügbar, wird das Bearbeiter-Feld
    automatisch gefüllt und schreibgeschützt („Angemeldet als …“); Statuswechsel speichern zusätzlich
    die Konto-ID, die Anzeige „von …“ wird bei jedem Rendern über `profiles()` aufgelöst (gespeicherter
    Name nur als Rückfall). „Veröffentlicht“ ist nur mit Bearbeitungsrecht am Artifact möglich. Ohne
    Konto-Identität (lokal geöffnet) bleibt das Namensfeld wie bisher.
  - **Prüfbericht**: im Register Editor „An den Stand anhängen“ (mehrere Berichte je Stand, mit Datum
    und Bearbeiter), „Als Word herunterladen“ und „Als Markdown herunterladen“. In der Stände-Tabelle
    lädt „Prüfbericht (n)“ den neuesten angehängten Bericht als Word.
  - **Stände vergleichen** (Schritt 6): Stand A/B wählen; Kapitel werden über den Titel zugeordnet,
    bei gleicher Kapitelzahl (z. B. Deutsch/Englisch) ersatzweise über die Reihenfolge. Je Kapitel
    „unverändert“, „geändert (+x / −y Zeilen)“, „nur in A/B“, Screens A/B und Zeilenvergleich
    („Unterschiede“). „Inhaltlicher Vergleich (KI)“ bewertet fehlende/abweichende Inhalte auch über
    Sprachgrenzen (neuer editierbarer Prompt, insgesamt 35).

- **FINAL/Editor – Freigabe, Sperre, Verbesserungen ohne Agent, geschützte Vermerke (v2.117.0)**:
  - **Verbesserungen ohne Agent**: Option in Schritt 6 „Verbesserungen … direkt als interne Vermerke
    übernehmen“ – die zugeordneten ROVO-Verbesserungen werden je Kapitel als gelber interner Vermerk
    („Verbesserung (ROVO): …“) vor den Screens angefügt und erscheinen im Export, solange interne
    Vermerke eingeblendet sind.
  - **Status je Verbesserung**: offen / umgesetzt / als Vermerk übernommen / abgelehnt – in Schritt 7
    je Eintrag wählbar (Zähler „x offen von n“), im Vollbild als Kennzeichnung, im Editor je Kapitel
    „x offen / n“. Der Agent „Verbesserungen einarbeiten“ bekommt nur offene Verbesserungen; nach
    „Als neuen Stand übernehmen“ gelten sie in optimierten Kapiteln als „umgesetzt“.
  - **Freigabe**: Feld „Bearbeiter für Prüfung/Freigabe“; „Geprüft“ und „Veröffentlicht“ nur mit
    Namen (steht als „von …“ am Status und in der Historie). Veröffentlichte Stände sind gesperrt
    (nicht löschbar); den Status zurückzusetzen verlangt eine Bestätigung.
  - **Agenten schützen Vermerke und Jira-Nummern**: Interne Vermerke gehen als
    `⟦INTERN⟧…⟦/INTERN⟧` an den Agenten und werden danach wieder als Vermerk markiert; Antworten,
    die Bild-Platzhalter, Vermerk-Markierungen oder Jira-Nummern verändern bzw. verlieren, werden mit
    Begründung verworfen. Zusätzliche, nicht editierbare technische Regeln im Prompt.
  - **Editor – Kapitelerzeugung mit internem Dokument**: In Schritt 1 des Editors lässt sich als
    Grundlage für Quelle 1 ein interner FINAL-Stand wählen (Kapitel per gleichem/ähnlichem Titel;
    ohne Treffer gilt weiterhin der bestehende Benutzerhandbuch-Text).
  - FINAL: Ablageflächen kompakt.

- **FINAL – mehrere Quelldateien, Verbesserungen aus ROVO, Stände; Editor-Agenten (v2.116.0)**:
  - **Quelldateien mit Merkmalen (Schritt 1)**: Je hochgeladener Benutzerhandbuch-Datei werden
    Rolle, Sparte, Sprache und Markt gespeichert (z. B. eine deutsche und eine englische Fassung,
    Fassungen je Rolle/Markt) und in der Tabelle angezeigt.
  - **Verbesserungen aus ROVO (Excel, Schritt 1)**: .xlsx-Upload; Spalten über die Kopfzeile
    erkannt („Kapitel“/„Unterkapitel“, „Verbesserung“/„Vorschlag“/„Empfehlung“, optional
    „Priorität“/„Status“; sonst A = Kapitel, B = Verbesserung). Jede Zeile wird automatisch einem
    Kapitel der Quelldatei zugeordnet, die die meisten Treffer liefert (gleicher Titel ohne
    „Kapitel n:“, gleiche Kapitelnummer, sonst ähnlichster Titel ab 34 % Wortüberschneidung) –
    Quelldatei je Excel umstellbar, Zuordnung je Zeile änderbar („manuell“), Trefferart sichtbar.
  - **Auswahl je Schritt**: Schritt 3 Quelldatei + Verbesserungen (Vorschau zeigt die
    Verbesserungen des Kapitels), Schritt 5 Screens-Datei (Filter der Übersicht), Schritt 6
    Quelldatei, Verbesserungen, Screens-Datei und Name des Stands, Schritt 7 und 8 der Stand.
  - **Stände (Outputs)**: Jede Zusammenführung in Schritt 6 erzeugt einen eigenen Stand mit
    Konfiguration (Quelle · Verbesserungen · Screens, Rolle/Sparte/Sprache/Markt-Filter), Kapiteln,
    Screens und den zugeordneten Verbesserungen. Status Entwurf → Geprüft → Veröffentlicht mit
    Zeitpunkt und Historie; „Anzeigen“ macht einen Stand aktiv (Ergebnis, Word/PDF/PowerPoint).
    Ältere Sitzungen: ein vorhandener Master wird als „Stand 1“ (Entwurf) übernommen.
  - **Register Editor – interne Dokumente**: Liste aller Stände mit Datum und Status. Für das
    gewählte Dokument laufen Agenten kapitelweise (mit Stop): „Verbesserungen einarbeiten“
    (nur Kapitel mit hinterlegten ROVO-Verbesserungen), „Sprache & Stil optimieren“ und
    „Prüfbericht“. Antworten, die die Zahl der `[Bild]`-Platzhalter verändern, werden verworfen
    (Kapitel bleibt unverändert, Screens bleiben korrekt zugeordnet). Vergleich Bisher/Optimiert
    je Kapitel; „Als neuen Stand übernehmen“ legt einen neuen Entwurf in FINAL an (aktiv, mit
    Vermerk „im Editor optimiert“). Aus der Stände-Tabelle führt „Im Editor optimieren“ direkt
    dorthin. Drei neue editierbare Prompts (insgesamt 34).

- **FINAL – Ergebnis im Vollbild, Gesamtes Dokument (v2.115.0, Schritt 7)**:
  - **Gesamtes Dokument**: Die Kapitel-Auswahl in Schritt 7 bietet an erster Stelle
    „— Gesamtes Dokument —“ – Quellversion und neue Zusammenführung zeigen dann alle Kapitel
    des Masters nacheinander, jeweils mit Kapitelüberschrift. Vorausgewählt bleibt das erste
    Kapitel.
  - **Vollbild-Fenster**: Je Spalte ein Button „Vollbild“ (Quellversion bzw. neue
    Zusammenführung) sowie „Beide im Vollbild“ (zwei Fenster nebeneinander; in der Ansicht
    über „Nur aktives Fenster“/„Beide Fenster“ umschaltbar). Die Ansicht füllt das ganze
    Fenster und fordert zusätzlich den Browser-Vollbildmodus an (in eingebetteten Ansichten
    ggf. nicht erlaubt – dann bleibt es beim fensterfüllenden Overlay). Die neue
    Zusammenführung zeigt die Screens dort als Bilder mit Bildunterschrift statt als
    „[Bild: …]“-Hinweis.
  - **Je Fenster unabhängig**: eigene Kapitel-Auswahl (inkl. „Gesamtes Dokument“), Blättern
    „Zurück“/„Weiter“ (Kapitel für Kapitel; im Gesamtdokument Sprung zur vorigen/nächsten
    Kapitelüberschrift) mit Positionsanzeige „Kapitel 2 von 5“, Zoom 50–300 % (−/+, Klick auf
    die Prozentanzeige setzt auf 100 % zurück, Strg + Mausrad). Tastatur im zuletzt bedienten
    Fenster: ←/→ bzw. Bild↑/Bild↓ blättern, +/−/0 zoomen, Esc schließt.
  - **Fix**: Das Master-Dokument bettet die Screens eines Kapitels jetzt in der Seitenreihenfolge
    der Quelle ein (vorher in Upload-/Zuordnungsreihenfolge, neueste zuerst) – gilt für Ergebnis,
    Word, PDF und PowerPoint.

- **FINAL – Screens in Seitenreihenfolge der Quelle (v2.114.0)**:
  - **Seite je Screen**: Beim Hochladen einer Screens-Datei (Schritt 4) wird für jedes Bild die
    Seite in der Originalquelle bestimmt (`finalDocxPageWalker`). Word schreibt beim Speichern an
    jeden tatsächlichen Seitenanfang ein `w:lastRenderedPageBreak` – sind solche Marken vorhanden,
    zählen nur sie; sonst manuelle Seitenumbrüche, „Seitenumbruch oberhalb“ und Abschnittswechsel
    mit neuer Seite. Inhaltssteuerelemente (z. B. Inhaltsverzeichnis) werden mitgezählt. Bei
    .pptx entspricht die Seite der Foliennummer.
  - **Reihenfolge**: Die Übersicht in Schritt 5 (und damit auch „Bilder zuordnen“ und der
    Master) ordnet die Screens nach Screens-Datei (Upload-Reihenfolge), Seite und Position auf
    der Seite – statt wie bisher neueste zuerst.
  - **Seitenanzahl**: Spalte „Seiten“ in den Tabellen der Handbuch-Dateien (Schritt 1) und der
    Screens-Dateien (Schritt 4); die Vorschau (Schritt 3) nennt Quelldatei und Seitenanzahl.
    Grundlage ist `<Pages>` aus `docProps/app.xml`, mindestens aber die gezählten Seiten.
  - **Überschriften der Quellseite**: Neue Spalten „Seite (Quelle)“ („S. 3 von 12“) und
    „Überschriften der Seite (Quelle)“ – alle Überschriften dieser Seite (auch bei lokalisierten
    Formatvorlagen-IDs, über den Vorlagennamen erkannt). Da die Screens in Aufnahme-Reihenfolge
    abgelegt sind und sich auf die Vorseite beziehen können, steht bei Seiten ohne eigene
    Überschrift „↳ Vorseite:“ mit der letzten Überschrift davor.
  - **KI-Zuordnung**: Der Prompt für „Bilder zuordnen“ enthält je Screen die Seite, die
    Überschriften der Seite (ggf. mit Hinweis „von der Vorseite“) und die Überschriften der Vorseite.

- **Performance und Fehlerkorrekturen (v2.113.0)**:
  - **Unsichtbare Register werden nicht mehr mitgerendert**: `refreshDashboard` baut
    Verarbeitung (Release-Tabelle, Jira-Liste, Domänen, Job-Schritte), Listenauswahl,
    Ticket Graph, Trend und Datenqualität nur noch auf, wenn das Register sichtbar ist –
    sonst wird der Aufbau vorgemerkt und beim Öffnen nachgeholt (`renderWhenVisible`/
    `flushDeferredRenders`). Die Klassifizierung rendert die Tabelle nicht mehr doppelt.
  - **Render-Grenzen**: Vergleichstabelle max. 300 geänderte Tickets, Listenauswahl-Vorschau
    max. 300 Zeilen (gespeichert wird weiterhin die vollständige Auswahl), Massenverarbeitung
    max. 200 Zeilen je Domäne mit „Alle anzeigen“, Protokoll zeigt die neuesten 200 Einträge
    (gespeichert höchstens 2000; neue Einträge werden inkrementell oben eingefügt), Ticket
    Graph als Netzwerk max. 300 Knoten (sonst Ebenen-Layout), Prozessbild max. 60 Schritte.
    Jeweils mit Hinweis auf die Gesamtzahl.
  - **Weniger Neuaufbau**: Kapitelwechsel in Bilder-Galerie, Editor, Rovo Knowledge und
    Tabellen aktualisiert nur das Unterkapitel-Dropdown der betroffenen Zeile/Karte; die
    Prozessbild-Galerie legt identische Diagramme nicht mehr doppelt an; das automatische
    Speichern behält nur den letzten Massenverarbeitungs-Checkpoint.
  - **Rovo Knowledge**: KI-Zuordnung mit **Stop**-Button (bricht den laufenden Aufruf ab).
  - **Fehlerkorrekturen**: Löschen einer Editor-Datei entfernt nur die Screens genau dieser
    Datei (nicht mehr die einer gleichnamigen anderen Datei); gelöschte Bilder verschwinden
    auch aus Editor-Screens, Bildband und FINAL; „Zur Negativliste“ öffnet den Unter-Tab
    „KI-Texterzeugung“ und fokussiert das Eingabefeld; der Zugriff auf IndexedDB ist
    abgesichert (App startet auch, wenn der Browser ihn blockiert); `<meta charset="utf-8">`
    ergänzt (Umlaute beim lokalen Öffnen).

- **FINAL – Erweiterungen (v2.112.0)**:
  - **Auswahllisten**: Rolle zusätzlich „HQ“; Sparte nur noch „Pkw“ und „Van“ (leere Auswahl
    beim Screens-Upload = „Pkw und Van (beide)“) – „Markt“ ist als Sparte entfallen.
  - **Markierungen** in Vorschau (Schritt 3) und Ergebnis (Schritt 7, Quellversion und
    Master): interne Vermerke (echte Word-Kommentarbereiche) mit **gelbem**, Jira-Nummern mit
    **blauem** Hintergrund. Intern über unsichtbare Markierungszeichen im eingelesenen Text
    (`markedText`), die nie in Word/PDF/PowerPoint landen.
  - **Screens verwalten**: In Schritt 4 lässt sich eine ganze Screens-Datei samt ihrer Screens
    löschen. In Schritt 5 Screens einzeln oder über „alle markieren“ auswählen und für alle
    Markierten gemeinsam ein Kapitel zuweisen (oder die Zuordnung entfernen) bzw. löschen;
    je Zeile „Bearbeiten“ (springt ins Untertitel-Feld) und „Löschen“.
  - **Original-Design**: Beim Hochladen in Schritt 1 werden Formatvorlagen (`styles.xml`),
    Theme (Farben/Schriften), Schriftartentabelle, Nummerierung und Seitenformat (Größe,
    Ausrichtung, Ränder) der Datei gespeichert und im Word-Export verwendet. Da Word
    eingebaute Formatvorlagen mit lokalisierter ID speichert (z. B. „berschrift1“), werden
    Überschriften/Titel über den englischen Vorlagennamen („heading 1“, „Title“) zugeordnet
    (`finalStyleIdMap`). Kapitelüberschriften im Master folgen jetzt der Gliederungsebene
    (Überschrift 1/2/3) statt einheitlich „Titel“.
  - **Schritt 8 – Design auswählen (Word / PowerPoint)**: Word-Design = Original-Design einer
    hochgeladenen Handbuch-Datei (voreingestellt), eigene Word-Vorlage (.dotx/.docx) oder eines
    von drei App-Designs („Standard“ Calibri/Petrol, „Klassisch“ Cambria/Anthrazit, „Modern“
    Segoe UI/Blau, als generierte Formatvorlagen). Der Word-Export in Schritt 6 nutzt dasselbe
    Design. **PowerPoint-Export** (`finalBuildPptxBlob`): Titelfolie, je Kapitel Textfolien
    (bei langen Kapiteln mit „(Fortsetzung)“) und je Screen eine Bildfolie mit Bildunterschrift.
    Grundlage ist eine eigene PowerPoint-Vorlage (.potx/.pptx – deren vorhandene Folien werden
    entfernt, Folienmaster/Layouts/Theme bleiben; die neuen Folien nutzen die Platzhalter der
    Layouts „Titel“ und „Titel und Inhalt“) oder für die App-Designs eine eingebettete
    Basisvorlage (aus python-pptx 1.0.2, MIT-Lizenz), deren Theme-Akzentfarbe und Schriften
    angepasst werden. Word und PowerPoint werden jetzt beim Herunterladen aus dem gespeicherten
    Master-Stand gebaut – das funktioniert damit auch nach dem Laden einer Sitzung.
  - **Icons**: Die acht Schritte und die wichtigsten Buttons im FINAL-Register haben
    einheitliche Linien-Icons (Inline-SVG, keine externe Bibliothek).

- **FINAL – Bilder zuordnen (neu, v2.111.0, Abschnitt 5)**: Beim Hochladen einer
  Screens-Datei (.docx) wird je Bild zusätzlich der **oneSCM-Navigationstext** gelesen
  (`finalDocxZipToScreens`): zuerst ein Word-Textfeld im Bild-Absatz bzw. in der
  Tabellenzeile des Bildes (doppelte Ablage als `mc:Choice`/`mc:Fallback` wird nur einmal
  gezählt), sonst die übrigen Zellen derselben Tabellenzeile, der Text im Bild-Absatz,
  der direkt folgende oder vorangehende Absatz (keine Überschrift, kein weiteres Bild).
  Der Navigationstext steht in der Übersicht als eigene Spalte und füllt den Untertitel
  vor. Der Button **„Bilder zuordnen“** schickt die Screens stapelweise (bis zu 5 je
  Aufruf) mit Kapitel-Liste, Navigationstext und Überschrift an Claude (`sample.json`,
  editierbarer Prompt „FINAL: Bilder interpretieren und Kapiteln zuordnen“ unter
  Einstellungen → RAG-Prompts). Die Bilder selbst gehen nur mit, wenn die veröffentlichte
  App die Bildfreigabe deklariert (`capabilities: {sample: {images: true}}`) und
  `sample.limits()` sie meldet – sonst ordnet Claude nur anhand von Navigationstext und
  Überschrift zu (Hinweis in der Statuszeile). Claude liefert je Screen Untertitel und
  Kapitel/Unterkapitel; nur exakt (bzw. ohne Groß-/Kleinschreibung) passende Titel aus der
  Kapitel-Liste werden übernommen. Ergebnis-Status „Entwurf“; Kapitel umhängen oder
  Untertitel bearbeiten setzt „Manuell“ – solche Screens lässt ein erneuter Lauf aus.
  Je Screen „Löschen“ (mit Bestätigung, entfernt ihn auch aus der Bilder-Liste);
  Doppelklick auf das Vorschaubild öffnet es im vorhandenen, frei verschiebbaren
  Bildbetrachter-Fenster. Laufender Vorgang per „Abbrechen“ stoppbar. Im Master-Dokument
  (Word/PDF/Ergebnis-Vorschau) lautet die Bildunterschrift „Untertitel – Navigation:
  <oneSCM-Pfad>“ (`finalScreenCaption`).

- **Fehlerkorrekturen (v2.111.0)**:
  - **ID-Zähler nach Sitzung-Laden** (`recomputeIdCounters`): Nach dem Laden einer Sitzung
    oder eines Autosaves springen alle laufenden ID-Zähler (Bilder, Editor-Dateien, Rovo,
    Rovo-Tabellen, RAG-Bibliothek, Massenverarbeitung, hochgeladene Gliederungen,
    Referenz-Handbücher, Rovo-Summary-Quellen, FINAL-Handbücher/-Screens-Dateien) hinter
    die höchste geladene ID. Vorher bekamen neue Einträge bereits vergebene IDs, und
    „Entfernen“ löschte zwei Einträge.
  - **Dashboard „Alle auswählen“-Checkbox**: aktualisiert die Auswahl-Anzeige einmal statt
    einmal je Ticket (vorher Einfrieren bei vielen Tickets).
  - **Build-Schritt** (`webapp_builder.py`): eingebettetes JSON maskiert `<` als `\u003c`
    (Ticketinhalte wie `</script>` beenden das Script-Tag nicht mehr vorzeitig), und jeder
    Platzhalter wird nur im Script-Tag ersetzt – das Testergebnis-JSON landete vorher
    zusätzlich in einem JS-Kommentar (ca. 0,4 MB Ballast; ein `*/` darin hätte die App
    lahmgelegt). Zusätzlich bricht ein fehlender Build-Platzhalter das Start-Skript nicht
    mehr ab.
  - **Prozessbild/Mermaid**: Das Standard-Layout „Mermaid klassisch“ wird jetzt wirklich als
    Diagramm gezeichnet – Mermaid 10.9.1 wird erst bei Bedarf von jsDelivr nachgeladen
    (`loadMermaid`); ist das nicht möglich, bleibt der Quelltext mit Hinweis sichtbar.
  - **Rovo Summary – Vergleich**: Die Ticketliste hat ein eigenes Budget (15.000 Zeichen),
    damit sie bei vielen Tickets die Quellen B–E (RAG, Rovo, Handbuch, EDITO) nicht mehr
    aus dem Prompt verdrängt.
  - **Autosave**: Reine Navigationsklicks (Register, Seitenleiste) lösen kein Speichern der
    gesamten Sitzung mehr aus.

- **Performance-Fix (v2.110.0): Dashboard-Register bei großen Ticketmengen** – bei
  mehreren tausend geladenen Tickets konnte ein Wechsel zurück zum Dashboard-Register
  (dort leben sowohl die Haupttabelle als auch die „Jira Zuordnung"-Tabelle) mehrere
  Sekunden bis spürbar über zehn Sekunden blockieren und wirkte dadurch wie ein
  hängendes/nicht reagierendes Register. Ursache: Beide Tabellen hängten bislang ALLE
  Treffer unbegrenzt als `<tr>` ins DOM – die „Jira Zuordnung"-Tabelle kann dabei sogar
  deutlich mehr Zeilen als Tickets erzeugen, da ein Ticket je nach Label-Kategorien/
  Gliederungskapiteln in mehreren Gruppen gleichzeitig erscheint (bei 6.000 Test-Tickets
  z. B. über 20.000 Zeilen). Sobald das zuvor unsichtbare (`display:none`) Dashboard-Panel
  wieder sichtbar wird, muss der Browser dieses sehr große DOM einmalig komplett layouten
  – das ist der eigentliche Bremsklotz, nicht die Logik des Registerwechsels selbst. Fix
  (zwei unabhängige Maßnahmen, beide ausschließlich bei großen Datenmengen wirksam, für
  normale Importgrößen unverändertes Verhalten):
  - **„Jira Zuordnung"**: Gruppen sind ab 200 Gesamt-Treffern standardmäßig eingeklappt
    (`assignmentExpanded`/`ASSIGNMENT_AUTO_COLLAPSE_LIMIT`, dieselbe Auf-/Zuklapp-Technik
    wie bereits bei Datenqualität/Testergebnissen) – Zeilen bleiben zur Kompatibilität mit
    bestehenden Tests im DOM, sind bis zum Aufklappen aber `hidden` (kein Layout-Aufwand).
    Je Gruppe zusätzlich auf `ASSIGNMENT_ITEM_LIMIT` (300) begrenzt mit „… und N weitere"-
    Hinweiszeile als Obergrenze auch im aufgeklappten Zustand.
  - **Haupttabelle**: Ab `TABLE_ROW_RENDER_LIMIT` (500) Treffern werden nur noch die ersten
    500 tatsächlich als Zeilen gerendert, mit Hinweistext zum weiteren Eingrenzen der
    Suche/Filter. `lastRenderedFiltered` bleibt dabei die VOLLSTÄNDIGE gefilterte Liste –
    „Alle sichtbaren auswählen" und die Auswahl-Exporte (Jira-Nummern/XLSX) wirken daher
    unverändert auf alle Treffer, nicht nur auf die gerenderten 500.
  Ergebnis (Playwright-Lasttest, 6.000 synthetische Tickets): Dashboard-Klick nach
  Registerwechsel vorher ca. 10–11 Sekunden, danach unter 0,5 Sekunden.

- **Bilder** – Tabelle **und** Kachel-Galerie aller in der Sitzung
  erzeugten Prozessdiagramme sowie eigener Bild-Uploads, jeweils mit
  Datum. Beschreibungen lassen sich für beide Bildarten direkt in der
  Tabelle bearbeiten oder leeren, Bilder dort auch löschen (auch
  generierte Diagramme, nicht nur Uploads). Bilder hochladen per
  Datei-Dialog/Drag&Drop oder aus der Zwischenablage (Strg+V bzw. Button
  „Aus Zwischenablage einfügen“). Hochgeladene Bilder lassen sich
  zusätzlich:
  - mit **Domäne / Schritt (für Clickanweisung)** als Freitext
    verschlagworten, **Kapitel/Unterkapitel** per Dropdown (wie im
    Screens-Import-Register) wörtlich aus der Gliederung zuordnen,
  - per **OCR** (Tesseract.js, läuft komplett im Browser via WebAssembly,
    Englisch + Deutsch; lädt beim ersten Lauf Erkennungsdaten per CDN
    nach) nach Text durchsuchen,
  - mit rein **technischen Metadaten** anzeigen: Maße, Dateigröße, Format
    sowie eine selbst über ein herunterskaliertes Canvas berechnete
    Durchschnittsfarbe/-helligkeit – bewusst **keine KI-Bildanalyse/
    -interpretation**, nur deterministisch nachvollziehbare Werte,
  - wieder **herunterladen**.

  **OCR-Stapelverarbeitung: "OCR: Alle Bilder interpretieren"** (neu,
  v2.85.0), direkt nach dem Hochladen-Bereich: ein Klick erkennt per OCR
  für JEDES hochgeladene Bild den enthaltenen Text neu (Sanduhr-Spinner +
  laufender Statustext, der die Anzahl bereits verarbeiteter Bilder zeigt)
  und lässt Claude (sample-Capability) anhand dieses Texts ein passendes
  Kapitel, Unterkapitel (wörtlich aus der Gliederung) sowie eine
  Kurzbeschreibung vorschlagen – überschreibt dabei **nie** ein bereits
  gesetztes Kapitel/Unterkapitel/Beschreibung, ergänzt nur, was noch leer
  ist; das Unterkapitel wird nur übernommen, wenn es zum (ggf. bereits
  gesetzten) Kapitel passt. Alle Zuordnungen werden dauerhaft in der
  Sitzung gespeichert und bleiben jederzeit per Dropdown/Textfeld manuell
  korrigierbar. Die Bilder werden dabei **parallel statt sequentiell**
  per OCR verarbeitet (neu, v2.89.0, v2.94.0: 4 statt 3 gleichzeitig), was
  den Gesamtdurchlauf bei mehreren Bildern deutlich beschleunigt.
  **Performance-Fix (v2.92.0)**: `Tesseract.recognize()` erzeugt bei jedem
  Aufruf einen komplett neuen Worker samt Neuladen der Sprachdaten
  (eng+deu) – das machte OCR unabhängig von der Parallelität sehr
  langsam, da selbst die parallelen Durchläufe je Bild erneut den vollen
  Initialisierungspreis zahlten. Jetzt wird ein einmal erzeugter, über die
  gesamte Sitzung wiederverwendeter Worker-Pool genutzt (Sprachdaten
  bleiben nach der ersten Erkennung geladen) – spürbar schnellere Einzel-
  wie Stapelerkennung, besonders ab dem zweiten Bild bzw. Lauf.
  **Zusätzlicher Performance-Hebel (v2.94.0)**: Bilder werden vor der
  Erkennung bei Bedarf auf eine vernünftige maximale Kantenlänge (1800px)
  herunterskaliert – die Erkennungsdauer selbst wächst mit der Pixelzahl,
  und viele Screenshots sind für reine Texterkennung unnötig
  hochaufgelöst; kleinere Bilder bleiben unverändert. Ohne
  Claude-Artifact-Laufzeit bzw. ohne Internetzugriff (Tesseract-Nachladen)
  bleibt der OCR-Text trotzdem erkennbar, nur die KI-Zuordnung entfällt.
  **Kurzbeschreibung nennt jetzt die Bild-Überschrift** (neu, v2.102.0):
  die von Claude anhand des OCR-Texts vorgeschlagene Kurzbeschreibung
  nennt zuerst wörtlich die auf dem Bild sichtbare Überschrift/den
  Seitentitel (meist die optisch hervorgehobenste Zeile), danach knapp
  den übrigen Bildinhalt – dafür wurde die Beschreibungs-Spalte in der
  Tabelle breiter gemacht.
  **Vollbild-Bildbetrachter mit Verwischen-Werkzeug** (neu, v2.102.0):
  ein Klick auf das Vorschaubild (Galerie-Karte oder Tabellenzeile) öffnet
  es in einem **frei beweglichen, größenveränderbaren** Fenster (per
  Titelleiste verschiebbar, per Ecke unten rechts größenveränderbar –
  kein blockierendes Modal). Darin lässt sich mit der Maus ein Rechteck
  über sensible Stellen (Namen, Fahrgestellnummer/FIN, Servicenummer)
  ziehen, um diesen Bereich dauerhaft zu verpixeln/unkenntlich zu machen
  – bewusst **manuell** statt automatischer Erkennung, da Position und
  Schriftart auf Screenshots zu stark variieren, um zuverlässig
  automatisch erkannt zu werden. "Letzten Bereich entfernen" macht die
  zuletzt gezogene Verwischung rückgängig (solange noch nicht
  gespeichert), "Speichern" ersetzt das Bild dauerhaft durch die
  verwischte Fassung (die Originalversion bleibt einmalig über "Original
  wiederherstellen" erhalten). Gilt für alle hochgeladenen Bilder,
  inklusive der aus "Screens-Import" extrahierten Screens (gemeinsame
  Datenstruktur) – nicht für generierte Prozessdiagramme (SVG/Mermaid,
  kein Pixelbild).
- **Tabelle** (neu, v2.97.0) – eigenständiges Register für Tabellen, die
  automatisch aus bei Rovo Knowledge importierten .docx-/.pptx-Dateien
  extrahiert wurden (strukturiert als Zeilen/Zellen, nicht als
  Fließtext), ergänzt um einfache Markdown-Pipe-Tabellen aus .md-Importen.
  Es gibt hier keinen eigenen Datei-Upload – Tabellen entstehen
  ausschließlich als Nebenprodukt des Rovo-Knowledge-Imports (s. o.). Jede
  Tabelle zeigt ihren **Quellverweis** (Dateiname + Tabellen-Nr. im
  Quelldokument) sowie **Kapitel/Unterkapitel**-Dropdowns zur manuellen
  Zuordnung (wörtlich aus der Gliederung, wie bei Rovo-Einträgen/Bildern)
  und lässt sich einzeln löschen. PDF liefert bewusst keine Tabellen (nur
  Fließtext über die bestehende Text-Extraktion), da eine zuverlässige
  Tabellenerkennung aus reinem PDF-Text ohne eine echte Layout-Analyse
  nicht möglich ist.
  **Druckbare DIN-A4-Exporte** (neu, v2.98.0): je Tabelle lässt sich über
  ein **Seitenformat**-Dropdown (Hoch-/Querformat, Vorschlag anhand der
  Spaltenanzahl – mehr als 4 Spalten schlagen Querformat vor, bleibt
  jederzeit manuell umschaltbar) ein druckfertiges PDF oder Word-Dokument
  erzeugen. Die Spaltenbreiten werden dafür proportional zur tatsächlichen
  Zellinhaltslänge berechnet und exakt auf die nutzbare Seitenbreite des
  gewählten Formats normiert (abzüglich Rand) – Zelltext wird dafür
  umgebrochen statt abgeschnitten, damit die Tabelle garantiert ins
  Papierformat passt, auch bei vielen oder langen Spalteninhalten. Das
  Word-Dokument setzt dazu ein festes Tabellenlayout mit expliziten
  Spaltenbreiten (`w:tblLayout type="fixed"`), damit Word die berechneten
  Breiten nicht eigenmächtig neu verteilt. Dieser eigenständige Export
  bleibt ein manuell ausgelöster Schritt je Tabelle – zusätzlich lässt
  sich eine zugeordnete Tabelle jetzt auch automatisch ins Benutzerhandbuch
  (Register "Editor") einbetten: siehe dort "Tabellen-Einbettung" (neu,
  v2.99.0).
- **Output MD Tickets / Output PDF Tickets** – bereinigte Tickets als
  ZIP-Archiv aus Markdown- bzw. PDF-Dateien exportieren (respektiert die
  aktuelle Dashboard-Filterung); PDFs werden clientseitig mit jsPDF
  erzeugt.
- **Infobox / Glossar / Abkürzungen** – Kurzerklärung der App, Begriffsliste
  bzw. extrahierte Abkürzungen (siehe Verarbeitung → 3.).
- **Terminologie: Synonyme + manuell gepflegte Übersetzungen (Glossar/
  Abkürzungen)** – ergänzend zur automatischen Extraktion (s. o.) lassen
  sich eigene, redaktionell gepflegte Begriffslisten mit einer
  **eindeutigen Übersetzung je Begriff** in Englisch, Slowakisch, Hindi und
  Französisch anlegen: ein neues Register **"Synonyme"** (eigener
  Navigationspunkt neben Glossar/Abkürzungen – mehrere deutsche Begriffe
  mit derselben Bedeutung, z. B. "Vertrag"/"Kontrakt"/"Abschluss", bekommen
  so EINE verbindliche Übersetzung je Sprache, statt dass Generatoren je
  nach verwendetem Synonym unterschiedlich übersetzen) sowie je ein neuer
  Abschnitt **"Manuell gepflegte Übersetzungen"** am Ende von Glossar und
  Abkürzungen (unabhängig von den automatischen Vorschlägen dort). Jeder
  Eintrag lässt sich über **"Fixieren"** als redaktionell geprüft/final
  markieren – die Felder werden dann gegen versehentliches Ändern gesperrt
  (Begriff/Übersetzungen erscheinen nur noch als Text statt als
  Eingabefeld) und über **"Entsperren"** wieder editierbar. Wie Labels/
  Punkte-System reine Konfiguration (kein Sitzungsdatensatz, bleibt bei
  "Alle Daten löschen"/"Sitzung zurücksetzen" erhalten), aber Teil von
  "Sitzung speichern/laden".
- **Einstellungen** – seit v2.77.0 in Unter-Tabs gegliedert ("Sitzung &
  Verwaltung", "Stammdaten", "Gliederung & Steuerung", "Rollen-Navigation",
  "KI-Texterzeugung", "Design" (neu, v2.78.0), "Dokumentation") statt einer
  einzigen langen Liste – rein navigatorisch (dieselben Bereiche/Inhalte wie
  zuvor, nur gruppiert; kein Bereich wurde inhaltlich verändert). "Design"
  zeigt die 3 Prompts der Verbesserungs-Varianten (Benutzerhandbuch-
  Kapitel-Generator, s. u.) zusammen mit ihrer Icon-/Farblegende, editierbar
  über denselben geteilten Zustand wie die allgemeine RAG-Prompts-Liste.
  - *Sitzung speichern/laden* – da es keinen Server gibt und mit dem
    Schließen der Seite alles verloren geht, lässt sich der komplette
    aktuelle Stand (Tickets, Imports, Änderungsverlauf, Protokoll,
    Bilder-Galerie, Listenauswahl, Aktiv/Inaktiv-Status, extrahierte
    Abkürzungen/Glossar-Begriffe sowie Punkte-System/Labels/Gliederung/
    Farbschema) über "Sitzung als Datei exportieren" als eine JSON-Datei
    sichern und über "Sitzung aus Datei laden" – auch in einer neuen
    Sitzung/einem neuen Tab – wieder exakt herstellen, um an derselben
    Stelle weiterzuarbeiten. Das Laden ersetzt den gesamten aktuellen
    Stand unwiderruflich (mit Sicherheitsabfrage, falls bereits Daten
    geladen sind) und benötigt – anders als das Exportieren – **nicht**
    die Claude-Artifact-Laufzeit, da es ein normaler Datei-Upload ist.
  - *Persistenter Speicher (automatisches Speichern)* – ergänzt das
    manuelle Exportieren/Laden oben um automatisches, entprelltes
    Speichern im Browser selbst (IndexedDB), derselbe Datenumfang. Ein
    einziger, breiter document-weiter Listener (Eingabe/Änderung/Klick,
    entprellt auf 2,5 Sekunden Inaktivität) löst das Speichern aus, statt
    einer langen, fehleranfälligen Liste einzelner Mutationsstellen –
    deckt dadurch auch künftige neue Bedienelemente automatisch ab. Beim
    nächsten Öffnen der Seite in **demselben Browser** wird angeboten,
    die zuletzt automatisch gespeicherte Sitzung wiederherzustellen – nie
    automatisch geladen, immer mit Rückfrage; bei Ablehnung werden
    stattdessen die Ausgangsdaten geladen und der gespeicherte Stand
    bleibt unangetastet erhalten. Ein Schalter erlaubt das Deaktivieren
    (gilt nur für die aktuelle Sitzung) sowie ein Button zum gezielten
    Löschen des automatisch gespeicherten Stands. Steht IndexedDB in
    dieser Umgebung nicht zur Verfügung (z. B. manche eingebetteten/
    sandboxed Ansichten), bleibt die Funktion ohne Fehlermeldung inaktiv
    (Schalter erscheint deaktiviert mit erklärendem Hinweis) – der
    document-weite Listener wird dann bewusst gar nicht erst registriert,
    um keine unnötige Arbeit zu leisten; das manuelle Exportieren/Laden
    als Datei bleibt davon immer unabhängig nutzbar.
  - *Admin-Bereich* – Funktion "Alle Daten löschen": leert die komplette
    Sitzung (Tickets, Imports, Protokoll, Vergleiche, Extraktionen)
    unwiderruflich, mit Sicherheitsabfrage. Anders als "Sitzung
    zurücksetzen" im Import-Bereich werden dabei **nicht** wieder die
    eingebetteten Ausgangsdaten geladen, sondern alles auf 0 Tickets geleert.
    Betrifft auch die in Verarbeitung/Massenverarbeitung generierten
    Zwischenergebnisse (Glossar-/Abkürzungs-Extraktion, Release-Abgleich/
    -Bewertung, RAG-Rohdaten/-Text, hochgeladene Massenverarbeitung-Dateien).
    Bugfix: mehrere dieser Bereiche (u. a. die Bewertungs-Zusammenfassung in
    Job 4 und die Extraktions-Übersicht in Job 7) blieben trotz korrekt
    gesetztem `hidden`-Attribut weiterhin sichtbar, weil eine eigene
    `display`-Regel der jeweiligen CSS-Klasse das `hidden`-Attribut
    überstimmte (ohne eigene `.klasse[hidden]`-Ausnahme) – behoben durch eine
    globale `[hidden] { display: none !important; }`-Regel, die diese
    Bug-Klasse unabhängig von der jeweiligen Klasse ausschließt.
  - *Punkte-System (nach Tickettyp)* – editierbare Liste Tickettyp → Punkte
    (Standard: Epic 5, Bug 1, Feature 3, Change Request 3, Reporting 2),
    Einträge hinzufügen/bearbeiten/löschen. Wird beim Verarbeiten jedem
    Ticket anhand des Jira-Feldes "Typ" zugeordnet und ist sofort in den
    Tabellen unter Verarbeitung sichtbar; unbekannte Tickettypen bleiben
    ehrlich "Unbekannt" statt einen Wert zu raten.
  - *Labels (nach Themengebiet)* – editierbare Tabelle Themengebiet /
    Deutsch / Englisch, standardmäßig mit über 200 oneSCM-Fachbegriffen aus
    21 Themengebieten vorbefüllt (System/Rollen & Zugang, Navigation &
    Oberfläche, Kunden & Vertragsrollen, Fahrzeuge & Fahrzeugdaten,
    Vertragsanlage & Antrag, Zahlung & Rechnung, Governance & Blueprint,
    u. v. m.), Zeilen hinzufügen/löschen. Wird beim Verarbeiten per reinem
    Text-Abgleich (keine KI) gegen Zusammenfassung/Beschreibung/Domäne
    jedes Tickets automatisch zugeordnet – ein Treffer auf den deutschen
    ODER englischen Begriff genügt. Darunter die Themengebiete **Sparte**
    (Pkw/Van/Markt), **Rolle** (Retail/Markt/MO/HQ) und **Sonderthemen**
    (Reifen/Reporting/Testing/Schnittstellen/Templates/Migration/Rollout) –
    dieselbe Tabelle, nur zusätzlich vorbefüllt; ein Treffer zählt sowohl
    bei einem wörtlichen Jira-Label als auch, falls keines vorhanden ist,
    inhaltsbasiert über Zusammenfassung/Beschreibung (derselbe Text-Abgleich
    wie bei den übrigen Themengebieten – kein zweiter Mechanismus). Jedes
    importierte Ticket (Jira-Einzelticket wie Massenupload) erhält außerdem
    automatisch 4 weitere, immer vorhandene Labels **Status**, **Typ**,
    **Domäne** und **Anlagemonat** (z. B. "März 2024", aus dem Erstellt-
    Datum) – erscheinen wie alle anderen Labels im Dashboard-Labels-Filter
    und in den RAG-/Verarbeitungs-Filtern, zählen aber (weil auf praktisch
    jedem Ticket vorhanden) bewusst NICHT als Themengebiet in der "Jira
    Zuordnung"-Übersicht (sonst gäbe es dort nie mehr ein "Ohne Zuordnung").
    Über **Verarbeitung → 3. Glossar-/Abkürzungs-Extraktion** hinaus zeigt
    ein neuer Bereich **"Label-Kandidaten"** wiederkehrende Begriffe aus
    Zusammenfassung/Beschreibung, die noch in keinem Themengebiet erfasst
    sind (mind. 3 Tickets, Top 30) – je ein Übernehmen-Button legt den
    Begriff direkt im gewählten Themengebiet in den Labels-Stammdaten ab,
    ohne erneuten Import.
  - *Benutzerhandbuch-Gliederung* – editierbare Kapitel-/Unterkapitel-Liste
    des Benutzerhandbuchs, standardmäßig mit der oneSCM-Schulungsgliederung
    vorbefüllt (Kapitel hinzufügen/löschen, je Kapitel Unterkapitel
    hinzufügen/löschen). Jedem Kapitel lassen sich außerdem eine oder
    mehrere **Jira-Domänen** zuordnen (mit Datalist-Vorschlägen aus den
    tatsächlich geladenen Tickets) – die App ordnet beim Verarbeiten
    automatisch alle Tickets mit passender Domäne diesem Kapitel zu (reiner
    Feld-Vergleich auf das Jira-Feld "Domain", kein Text-Stichwortabgleich,
    keine KI). Unterkapitel dienen nur der Gliederungs-Struktur/Anzeige und
    tragen keine eigene Domänen-Zuordnung. Ohne zugeordnete Domäne bleibt
    ein Kapitel ehrlich leer, statt eine Zuordnung zu raten. Der
    Ausgangsbestand enthält bereits einen **Domänen-Vorschlag** für die
    Kapitel, bei denen Kapitel- und Domänenname klar zusammenpassen
    (z. B. Kapitel 4 „Servicevertrag anlegen" → *Contract Generation*,
    *Contract Calculation*, *Vehicle Management*; Kapitel 5 „Zahlung,
    Rechnung und Unterschrift" → *Revenue Management*, *Cost Management*;
    Kapitel 7 „Verträge im Alltag verwalten" → *Contract Management*;
    Kapitel 8 „Geschäftskunden, Kampagnen, Sonderfälle" → *Customer & Partner
    Management*, *Customer Account Center*; Kapitel 10 „Prozesse und
    Schaubilder" → *Architecture*; Kapitel 11 „Governance, Qualität,
    Datenschutz" → *Documents & Communications*, *Archiving*; Kapitel 6
    „Antrag verfolgen und aktivieren" → *Reporting*) – **dieser Vorschlag
    ist vom Modell anhand der Namen hergeleitet, keine bekannte "wahre"
    Zuordnung, und sollte geprüft/korrigiert werden.** Bewusst ohne
    Vorschlag blieben Kapitel 1-3, 9, 13-16 (keine eindeutig passende
    Domäne) sowie die Domäne *DevOps* (mit 60 Tickets die zweitgrößte im
    Demo-Datensatz – passt thematisch zu keinem Kapitel). Über den Button
    **"Gliederung aus Word-Dokument hochladen (.docx)"** lässt sich die
    komplette obige Liste stattdessen aus einer hochgeladenen .docx-Datei
    übernehmen – dieselbe Kapitelerkennung über Word-Formatvorlagen
    ("Überschrift 1" = Kapitel, "Überschrift 2" = Unterkapitel) wie beim
    Referenz-Handbuch-Import (s. u.), hier aber direkt in die Gliederung
    selbst statt nur in eine Vergleichsgrundlage. Eine Sicherheitsabfrage
    zeigt vorab eine Vorschau der erkannten Kapitel/Unterkapitel und kann
    abgebrochen werden; nach Bestätigung ersetzt die neue Struktur die
    bisherige Gliederung **vollständig und unwiderruflich** – Domänen-
    Zuordnungen fehlen danach zunächst (müssen neu gepflegt werden), und
    bereits erzeugte Benutzerhandbuch-Kapitel-Generator-Texte sowie
    Gliederungs-Stichwörter werden automatisch geleert, da sie sonst an
    nicht mehr existierende Kapiteltitel gebunden blieben.
  - *Gliederung + Steuerung/KPI aus Excel-Matrix hochladen (.xlsx)* – alternativ
    zum Word-Upload lässt sich die Gliederung auch aus einem mehrblättrigen
    Excel-Workbook (wie eine oneSCM-Matrix-Vorlage) übernehmen. Gesucht wird
    gezielt nach dem Arbeitsblattnamen (nicht nach Position): "Matrix" liefert
    die Kapitelstruktur über die Spalten "Kapitel"/"Thema"/"Ebene" – Ebene 1
    wird je ein Kapitel, Ebene 2 UND 3 werden beide als Unterkapitel angehängt
    (in Dokumentreihenfolge, Nummerierung wie "1.1"/"1.1.1" bleibt im Titel
    als Lesehilfe erhalten – volle Gliederungstreue, da Unterkapitel ohnehin
    nur der Struktur/Anzeige dienen). Zusätzlich übernimmt der Import aus der
    Matrix-Zeile jedes Kapitels (Ebene 1) die Spalten "Bearbeitungsstatus"/
    "Genehmigungsstatus"/"Publikationsstatus" sowie, falls ein Arbeitsblatt
    "KPI_Kapitel" vorhanden ist (eine Zeile je Kapitel), dessen KPI-Basiswerte
    ("Gate"/"Quellenabdeckung"/"Prüf-Erfüllungsquote"/"Kritische Befunde") in
    den neuen Bereich **"Steuerung & KPI"** (s. u.). Ist zusätzlich ein
    Arbeitsblatt **"Uebergaenge"** vorhanden (Spalten "ID"/"Text"/"Fehlende
    Nachweise", Letztere kombiniert einen Kapitelbezug wie "14 ↔ 15" mit dem
    eigentlichen Nachweistext), werden auch diese Kapitel-Übergänge
    übernommen und im Ticket Graph als eigener Graph angezeigt (s.
    Ticket-Graph-Bullet oben, Abschnitt "Kapitel-Übergänge"). Dieselbe
    Sicherheitsabfrage und derselbe vollständige, unwiderrufliche Ersatz wie
    beim Word-Upload.
  - *Gliederungs-Baum (Ebene 0&ndash;4)* (neu, direkt unter der obigen
    Gliederungsliste) – reine Lese-Ansicht der ECHTEN Ebenen-Verschachtelung
    aus einem Excel-Matrix-Upload: anders als die Kapitelliste oben (die
    Ebene 2 und 3 zu einer flachen Unterkapitel-Liste zusammenfasst) bleibt
    hier z. B. "1.1.1" ein echtes Kind von "1.1", nicht nur ein weiterer
    Listeneintrag unter Kapitel 1 – zum Ausklappen je Ebene (native
    `<details>`-Elemente). "Ebene 0" oben in der Liste sind die
    Kapitel-Übergänge aus dem Arbeitsblatt "Uebergaenge" (dieselben Daten
    wie im Ticket-Graph-Bullet oben). Tiefenunabhängig umgesetzt (keine
    feste Ebenen-Anzahl im Code), funktioniert also auch mit einer
    zukünftigen Ebene 4+ ohne Anpassung. Diese Baumansicht gibt es
    ausschließlich hier in den Einstellungen – Verarbeitung,
    Massenverarbeitung, Benutzerhandbuch und Releaseletter zeigen
    weiterhin nur die flache Kapitelauswahl wie bisher.
  - *Steuerung &amp; KPI (Kapitel-Status)* – direkt unter der Gliederung: je
    Kapitel frei editierbarer Status mit professionellen Icons statt Bild-
    Icons (dieselbe Begründung wie beim Benutzerhandbuch-Kapitel-Generator) –
    Bearbeitung (⚪ Offen/✏️ In Bearbeitung/✅ Fertig), Genehmigung (⚪ Nicht
    beantragt/📨 Beantragt/✅ Genehmigt/❌ Abgelehnt), Publikation (🔒 Nicht
    veröffentlicht/📢 Veröffentlicht), Prüf-Gate (⚪/➖/✅/❌) sowie die drei
    Mess-KPIs Quellenabdeckung %, Prüf-Erfüllungsquote % und kritische Befunde
    (freie Zahlenfelder). Jedes Kapitel steht hier unabhängig von einem Upload
    sofort mit Standardwerten bereit und lässt sich jederzeit pflegen; ein
    Excel-Matrix-Upload (s. o.) übernimmt nur die Basiswerte, überschreibt
    spätere manuelle Änderungen aber nicht rückwirkend. Lebt als Feld direkt
    auf dem jeweiligen Gliederungs-Kapitel, daher Konfiguration wie Domänen-
    Zuordnung – bleibt bei "Sitzung zurücksetzen"/"Alle Daten löschen"
    erhalten, Teil von Sitzung speichern/laden. Der Bearbeitungsstatus
    erscheint zusätzlich als eigene **Status-Spalte bei Massenverarbeitung**
    (je Textschnipsel-Zeile, abgeleitet aus dem zugeordneten Kapitel).
  - *6 Gliederungs-Versionen (Markt/MO/Dealer/IT/Van/Pkw)* – direkt unter der
    Gliederung erzeugt der Button **"6 Versionen + Matrix erzeugen"** aus der
    Gesamtgliederung 6 rollen-/spartenspezifische Teilgliederungen sowie eine
    **Kapitel×Versionen-Matrix**. Rein deterministisch aus dem bereits
    bestehenden Sparte-/Rollen-Filter abgeleitet (dieselben Tags wie unter
    Verarbeitung/Massenverarbeitung – Checkbox-Filter "Sparte" Pkw/Van/Markt
    bzw. "Rolle" Retail/Markt/MO/HQ/**IT**, kein KI-Aufruf): ein Kapitel zählt
    zu einer Version, wenn mindestens eines der ihm über die Domänen-Zuordnung
    zugeordneten Tickets die passende Sparte oder Rolle trägt – "Dealer" nutzt
    dabei den bestehenden Rollen-Tag **Retail** (dieselbe Rolle, nur anders
    benannt), **IT** ist eine neu angelegte Rolle (ebenfalls über Jira-Label
    oder inhaltsbasiert über die Labels-Stammdaten-Kategorie "Rolle"
    erkennbar). Kapitel ganz ohne zugeordnete Tickets erscheinen aus Vorsicht
    in **allen 6 Versionen** (kein Signal zum Ausschließen) – in der Matrix
    mit "✓\*" markiert. Jede der 6 Versionen lässt sich einzeln als eigene
    Markdown-Gliederung herunterladen (Kapitel-/Unterkapitel-Liste wie im
    Hauptdokument), die Matrix zusätzlich komplett als Markdown-Tabelle.
  - *Farbschema (Domänen &amp; Status-Ampel)* – die im Ticket Graph
    verwendeten Farben (Domänen: eine von 16 festen Farben, stabil je
    Domänenname; Status: Ampel-Kategorie Rot/Gelb/Grün, aus dem
    Status-Bucket-System hergeleitet) lassen sich hier je Domäne/Status
    überschreiben – gelistet werden nur Domänen/Status aus den aktuell
    geladenen Tickets. Domänen-Farben über einen normalen Farbwähler,
    Status-Ampel über drei Umschalt-Buttons (nur Rot/Gelb/Grün wählbar,
    kein freier Farbwert, damit die Ampel-Bedeutung als festes
    Drei-Zustands-System erhalten bleibt). Ein "Zurücksetzen"-Button je
    Zeile entfernt die Anpassung wieder (zurück auf automatisch). Wirkt
    sich sofort überall aus, wo dieselbe Farblogik verwendet wird: Ticket
    Graph, Dashboard (Domänen-Verteilungs-Balken + farbiger Punkt vor der
    Domäne in der Ticket-Tabelle) und Dateiverwaltung (Domänen-Übersicht,
    farbiger Punkt je Gruppen-Kopfzeile).
  - *Sprachstil (KI-Texterzeugung)* – eine globale Stilvorgabe (Sachlich/
    Handbuch – Standard, Freundlich/Locker, Formell/Zurückhaltend,
    Knapp/Stichpunktartig), die als Zusatzanweisung an die eigentlichen
    Fließtext-Prompts angehängt wird: RAG Zusammenfassung/Fließtext
    (Verarbeitung → 7. RAG, inkl. Batch-Zusammenführung) und
    Benutzerhandbuch-Kapitel-Generator (inkl. dessen
    Batch-Zusammenführung). Übersetzung, Handbuch-Vergleich,
    Qualitätsprüfung und die Massenverarbeitung-KI-Zuordnung bleiben
    bewusst unverändert (festes Ausgabeformat bzw. keine Prosa). Wirkt
    sich erst auf den nächsten Klick auf "Generieren" aus, nicht
    rückwirkend. Konfiguration (kein Sitzungsdatensatz) – bleibt auch bei
    "Sitzung zurücksetzen"/"Alle Daten löschen" erhalten, wird über
    Sitzung speichern/laden mit exportiert.
  - *RAG-Prompts (KI-Texterzeugung)* – die 5 Anweisungstexte, mit denen
    Claude aus den RAG-Rohdaten (Verarbeitung → 7. RAG) einen Text erzeugt
    (Zusammenfassung, Fließtext), mehrere Teiltexte bei sehr vielen Tickets
    zu einem Gesamttext zusammenführt (je ein eigener Prompt für
    Zusammenfassung/Fließtext) oder ins Englische übersetzt, sind hier frei
    editierbar – vorher fest im Code verdrahtet. Je Prompt ein
    "Zurücksetzen"-Button auf den Standardtext sowie ein "angepasst"/
    "Standard"-Badge (gleiches Muster wie die Farbschema-Overrides). Die
    Ticket-Rohdaten selbst werden weiterhin automatisch an den editierten
    Text angehängt, sind also nicht Teil des editierbaren Felds – ein
    Tippfehler kann die Datengrundlage daher nicht versehentlich entfernen.
    Wirkt sich erst auf den nächsten Klick auf "Generieren"/"Übersetzen"
    aus, nicht rückwirkend auf bereits erzeugte Texte. Konfiguration (kein
    Sitzungsdatensatz) – bleibt auch bei "Sitzung zurücksetzen"/"Alle Daten
    löschen" erhalten, wird über Sitzung speichern/laden mit exportiert.
  - *Negativliste (verbotene Wörter/Satzbausteine)* – eine kommagetrennte
    Liste von Wörtern oder Satzbausteinen (auch Wortbestandteile erlaubt,
    z. B. "im Rahmen von"), die im Releaseletter/Benutzerhandbuch nicht
    auftauchen sollen. Wird **nicht** automatisch entfernt – die
    redaktionelle Entscheidung bleibt beim Menschen –, sondern Treffer
    werden gelb hervorgehoben, damit sie bei der Prüfung auffallen: in der
    Benutzerhandbuch-Kapitel-Vorschau ("Vorschau (Icons)", s. u.) UND direkt
    in den Entwürfen von **Releaseletter** und **Benutzerhandbuch**
    (Rohgerüst) – dort jeweils mit einem kleinen Hinweis samt Link direkt
    zur Negativliste oberhalb der Vorschau. Die Markierung aktualisiert
    sich live, sobald die Negativliste geändert wird, ohne den Entwurf neu
    erzeugen zu müssen; der eigentliche, bearbeitbare/herunterladbare Text
    bleibt davon unberührt (reine Anzeige-Markierung). Clickanweisung/
    Prozessbild bleiben bewusst außen vor (dort geht es um Klickschritte/
    Bilder, nicht um Fließtext). Konfiguration (kein Sitzungsdatensatz) –
    bleibt auch bei "Sitzung zurücksetzen"/"Alle Daten löschen" erhalten,
    wird über Sitzung speichern/laden mit exportiert.
  - *Dokumentation → Testing* – visuelles Testdashboard mit dem
    eingebetteten Bericht der automatisierten Tests (Browsertests der
    Web-App + pytest für das CLI-Tool) aus dem letzten Verifikationslauf
    während der Entwicklung dieser Version: Zusammenfassung (Dateien/
    Testfälle bestanden, Gesamtlaufzeit, Stand), je Testdatei
    auf-/zuklappbar bis auf den einzelnen Testfall/Schritt (inkl.
    Fehlerausgabe bei fehlgeschlagenen Dateien), sowie ein eigener
    "Optimierungen"-Abschnitt mit den Erkenntnissen aus der
    Performance-Analyse der Testroutinen (siehe Abschnitt "Tests" weiter
    unten). Läuft nicht live im Browser, sondern ist ein zum
    Build-Zeitpunkt eingebetteter Stand (`webapp/tests/test-results.json`).
  - Punkte-System, Labels, Benutzerhandbuch-Gliederung und die
    Farbschema-Overrides sind Konfiguration (kein Sitzungsdatensatz) und
    bleiben daher auch nach "Sitzung zurücksetzen"/"Alle Daten löschen"
    erhalten.
- Detail-HTML-Exports (ein Abschnitt pro Ticket statt einer Tabelle)
  werden von der Web-App **nicht** unterstützt – dafür das CLI-Tool
  verwenden. Word-Exporte (`.docx`) werden dagegen sowohl beim Import
  (Releaseinfo) als auch bei allen Exporten (Verarbeitung-Jobs,
  Releaseletter/Benutzerhandbuch/Clickanweisung/Prozessbild) direkt im
  Browser unterstützt.

**Mit aktuellen Daten neu bauen** (bettet `data/tickets.json` ein):

```bash
jira-releaseletter build-webapp
```

Erzeugt `webapp/ticket_cockpit.build.html`. Lokal im Browser geöffnet
funktionieren Ansicht/Suche/Filter; der Datei-Download (ZIP/Markdown)
benötigt die Claude-Artifact-Laufzeit (`window.claude`-API) und
funktioniert nur, wenn die Datei über Claude als Artifact veröffentlicht
wurde – lokal geöffnet zeigt der Button eine entsprechende Meldung.

**Eingebettete Ausgangsdaten:** `data/tickets.json` ist bewusst leer
(`[]`) – die veröffentlichte App startet mit **0 eingebetteten
Jira-Tickets** statt der früheren Demo-/Testdaten, auch nach "Sitzung
zurücksetzen" im Import-Bereich. Unberührt davon bleiben
Benutzerhandbuch-Gliederung, Labels, Punkte-System und
Farbschema-Overrides (Konfiguration, kein Ticket-Datensatz, s. o.) –
eine neue Installation zeigt also sofort die vollständige Struktur,
aber ohne Beispiel-Tickets, bis eigene Jira-Exporte importiert werden.
Für lokale Tests mit realistischen Datenmengen eigene Exporte unter
`Input/` ablegen und `jira-releaseletter build-webapp` erneut ausführen.

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

### Python-CLI (`jira-releaseletter`)

```bash
pip install -e ".[dev]" 2>/dev/null || pip install pytest
PYTHONPATH=src python3 -m pytest tests/ -v
```

Die Tests laufen gegen synthetische Beispiel-Exporte in
`tests/fixtures/` (XML/HTML/DOCX mit Testdaten inkl. Namen/E-Mails) und
prüfen den kompletten Weg von Parsing bis Dokumenterzeugung.

### Web-App (`webapp/ticket_cockpit.html`)

Die Web-App hat eine eigene, separate Testsuite unter `webapp/tests/`
(jsdom-basierte End-to-End-Tests, ~70 Dateien, über 1600 einzelne
Prüfungen) – sie simulieren echte Nutzerinteraktionen (Klicks, Uploads,
Formulareingaben) gegen die tatsächlich gebaute Web-App, nicht gegen
isolierte Funktionsaufrufe. Für den Persistenter-Speicher-Test kommt
zusätzlich `fake-indexeddb` zum Einsatz, da jsdom selbst keine IndexedDB
mitbringt:

```bash
jira-releaseletter build-webapp        # erzeugt webapp/ticket_cockpit.build.html
cd webapp/tests
npm install
npm test                               # führt alle *_test.js aus (siehe unten: parallel)
```

Jede Testdatei ist ein eigenständiges Skript (kein Test-Framework wie
Jest nötig) und lässt sich auch einzeln ausführen, z. B.
`node webapp/tests/rag_test.js`. Die Tests decken u. a. Import/Merge/
Duplikaterkennung, alle sieben Verarbeitung-Jobs (inkl. der KI-gestützten
RAG-Funktion, dort mit einer gemockten `sample`-Capability), die vier
Dokument-Generatoren samt XLSX/DOCX/PDF-Export, die 5
Clickanweisung-Designvorlagen, den Original/Nur-Deutsch-Umschalter,
Bilder-Upload/OCR/Metadaten sowie den Lösch-Bestätigungsdialog ab.

**Performance des Testrunners (`webapp/tests/run-all.js`):** Eine Messung
der Einzeldauern ergab, dass die Laufzeit je Testdatei überwiegend vom
JSDOM-Boot (Parsen/Ausführen der großen `ticket_cockpit.build.html`) und
festen `wait()`-Sleeps dominiert wird, **nicht** von der Anzahl der
`check()`-Aufrufe – eine Datei mit 19 Checks kann genauso lange laufen wie
eine mit 87. Da jede Testdatei ohnehin in einem eigenen, isolierten
Node-Prozess läuft, führt `run-all.js` seit dieser Version alle Dateien
**parallel** aus (Worker-Pool, Standard: CPU-Kernzahl, override via
`TEST_CONCURRENCY=1` für rein serielle/deterministische Ausgabe-Reihenfolge
beim Debuggen) statt seriell – das reduziert die Wanduhrzeit der
Gesamtsuite deutlich. Zusätzlich wurde die bis dahin größte Testdatei
(`ticket_graph_test.js`, 409 Zeilen/87 Checks) entlang ihrer fachlichen
Abschnitte in drei kleinere, fokussierte Dateien aufgeteilt
(`ticket_graph_test.js`, `ticket_graph_filter_test.js`,
`ticket_graph_interact_test.js`) – kleinere Einheiten liefern früher
Zwischenergebnisse und profitieren stärker von der Parallelisierung.

Jeder Lauf schreibt außerdem einen strukturierten Bericht nach
`webapp/tests/test-results.json` (jeder einzelne `check()`-Aufruf als
eigener Testfall/Schritt, Laufzeit je Datei, die oben genannten
Performance-Erkenntnisse). `jira-releaseletter build-webapp` bettet diesen
Bericht automatisch in den Build ein, sofern er beim Bauen bereits
existiert (sonst bleibt das Dashboard leer, mit entsprechendem Hinweis) –
sichtbar in der Web-App unter **Einstellungen → Dokumentation → Testing**:
ein visuelles Testdashboard mit Zusammenfassung (Dateien/Testfälle
bestanden, Gesamtlaufzeit, Stand), einer je Datei aufklappbaren Tabelle
aller einzelnen Testfälle samt Status, sowie einem eigenen
"Optimierungen"-Abschnitt mit den obigen Performance-Erkenntnissen im
Klartext. Läuft nicht live im Browser, sondern zeigt den Stand des
letzten Verifikationslaufs während der Entwicklung.

## Bei 1000 Tickets

`import` verarbeitet die gesamte Exportdatei in einem Lauf und gibt
alle 100 Tickets eine Fortschrittsmeldung aus. Für sehr große
Exportdateien (z. B. > 50 MB HTML/DOCX) kann der Speicherbedarf
steigen, da der jeweilige Parser das Dokument komplett einliest.
