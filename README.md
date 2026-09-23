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
Versions-Badge (`APP_VERSION` in der `<script>`, aktuell "v2.23.0"), das bei
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
  die Erkennung selbst wurde robuster gemacht, siehe unten), Erstellt-/
  Aktualisiert-Spalten **ohne Uhrzeit** (nur das Datum, z. B. "20/Dez/24"
  statt "20/Dez/24 4:41 PM" – sortiert wird weiterhin nach dem vollen
  Zeitstempel, nur die Anzeige ist gekürzt), Ticket-Detailansicht (18
  Standardfelder, fehlende klar als "Nicht im Export enthalten" markiert
  statt erfunden). Jede Zeile hat zusätzlich eine **Checkbox** ("Alle
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
  ist).
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
     Label-Themengebiet/Gliederungskapitel sorgen dafür, dass sich die
     Generierung gezielt auf ein Thema bzw. ein Kapitel eingrenzen lässt,
     statt Text aus allen Tickets zu vermischen; zeigt
     nur unverändert vorhandene Ticket-Daten, "–" bei fehlendem Text; die
     Rohdaten-Tabelle lässt sich wie bei Jobs 1-6 als XLSX/DOCX/PDF
     exportieren. Schritt 2 (**Generation**, echte KI): mit den Buttons "Zusammenfassung
     generieren" bzw. "Fließtext generieren" schickt die App die
     extrahierten Rohdaten über die `sample`-Laufzeit-Capability an Claude
     und lässt daraus einen endnutzergerechten Text schreiben (Live-Streaming
     der Antwort, Stop-Button, danach als Markdown speicherbar). Diese
     Funktion ist die einzige Stelle in der App, die echte KI-Textgenerierung
     nutzt (sonst ausschließlich deterministische Logik) – sie ist nur
     innerhalb der veröffentlichten Claude-Artifact-Version verfügbar (nicht
     bei lokalem Öffnen der Datei), fragt beim ersten Aufruf um Zustimmung,
     kostet die Nutzung des Viewer-Kontos und liefert bei Fehlern
     (Ablehnung, Rate-Limit, keine Rohdaten, …) eine verständliche
     Meldung statt eines Absturzes. Ergebnis ist klar als KI-generiert
     gekennzeichnet und redaktionell zu prüfen. Verarbeitet bis zu **800
     Tickets pro Durchlauf**: passen die Rohdaten in ein Zeichen-Budget,
     läuft wie zuvor ein einzelner Claude-Aufruf; sonst teilt die App sie
     automatisch in mehrere Batches auf ("Batch 1 von N", "Batch 2 von N"
     usw., aus der aktuellen Auswahl/Extraktion), lässt Claude je Batch
     einen Teiltext schreiben und führt diese am Ende in einem letzten
     Aufruf zu einem einzigen, redundanzbereinigten Endtext zusammen
     (Map-Reduce) – darüber (mehr als 800 Tickets) lehnt die App die
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
- **Bilder** – Tabelle **und** Kachel-Galerie aller in der Sitzung
  erzeugten Prozessdiagramme sowie eigener Bild-Uploads, jeweils mit
  Datum. Beschreibungen lassen sich für beide Bildarten direkt in der
  Tabelle bearbeiten oder leeren, Bilder dort auch löschen (auch
  generierte Diagramme, nicht nur Uploads). Bilder hochladen per
  Datei-Dialog/Drag&Drop oder aus der Zwischenablage (Strg+V bzw. Button
  „Aus Zwischenablage einfügen“). Hochgeladene Bilder lassen sich
  zusätzlich:
  - mit **Domäne / Kapitel / Schritt (für Clickanweisung)** als Freitext
    verschlagworten,
  - per **OCR** (Tesseract.js, läuft komplett im Browser via WebAssembly,
    Englisch + Deutsch; lädt beim ersten Lauf Erkennungsdaten per CDN
    nach) nach Text durchsuchen,
  - mit rein **technischen Metadaten** anzeigen: Maße, Dateigröße, Format
    sowie eine selbst über ein herunterskaliertes Canvas berechnete
    Durchschnittsfarbe/-helligkeit – bewusst **keine KI-Bildanalyse/
    -interpretation**, nur deterministisch nachvollziehbare Werte,
  - wieder **herunterladen**.
- **Output MD Tickets / Output PDF Tickets** – bereinigte Tickets als
  ZIP-Archiv aus Markdown- bzw. PDF-Dateien exportieren (respektiert die
  aktuelle Dashboard-Filterung); PDFs werden clientseitig mit jsPDF
  erzeugt.
- **Infobox / Glossar / Abkürzungen** – Kurzerklärung der App, Begriffsliste
  bzw. extrahierte Abkürzungen (siehe Verarbeitung → 3.).
- **Einstellungen**
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
  - *Admin-Bereich* – Funktion "Alle Daten löschen": leert die komplette
    Sitzung (Tickets, Imports, Protokoll, Vergleiche, Extraktionen)
    unwiderruflich, mit Sicherheitsabfrage. Anders als "Sitzung
    zurücksetzen" im Import-Bereich werden dabei **nicht** wieder die
    eingebetteten Ausgangsdaten geladen, sondern alles auf 0 Tickets geleert.
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
    ODER englischen Begriff genügt.
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
    Demo-Datensatz – passt thematisch zu keinem Kapitel).
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
(jsdom-basierte End-to-End-Tests, ~50 Dateien, über 1200 einzelne
Prüfungen) – sie simulieren echte Nutzerinteraktionen (Klicks, Uploads,
Formulareingaben) gegen die tatsächlich gebaute Web-App, nicht gegen
isolierte Funktionsaufrufe:

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
