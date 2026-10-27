// Neues Register "Rovo Knowledge": Textschnipsel aus Rovo-KI-Chats
// (Chatverlauf + Antwort, zwei getrennte Felder) werden über Zwischenablage
// oder .md-Dateien (Trennung an einer eigenen "---"-Zeile) in eine
// Übersicht eingefügt, jeder Eintrag ist fest mit dem Label "ROVO"
// markiert, wird per KI (sample-Capability) einem Kapitel/Unterkapitel und
// bis zu 3 weiteren Labels zugeordnet (ohne das feste ROVO-Label zu
// verlieren, ohne ein bereits gesetztes Kapitel zu überschreiben). Kapitel,
// Unterkapitel UND Labels bleiben nach der KI-Zuordnung frei manuell
// nachpflegbar (Dropdowns bzw. entfernbare/hinzufügbare Label-Chips, "ROVO"
// selbst nicht entfernbar). Im Text vorkommende Jira-Ticketnummern lassen
// sich je Eintrag ein-/ausblenden, und alle Einträge lassen sich als ZIP
// (je Eintrag eine .md-Datei) exportieren. Prüft zusätzlich den
// Sitzung-speichern/laden-Rundlauf.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// Claude liest aus dem Prompt die angebotenen Kapitel und Labels und
// schlägt immer das ERSTE Kapitel samt zweitem Label vor - robust
// gegenüber der tatsächlich hinterlegten Gliederung/Stammdaten.
function sampleImplFactory() {
  return async function (promptText) {
    if (/Rovo-Wissens-Einträge/.test(promptText || "")) {
      return { text: "## Vertragsanlage\n- Es gibt Informationen zur Vertragsanlage.\n\n## Allgemein zum Kapitel\n- Weitere allgemeine Hinweise.", truncated: false, modelTierApplied: "default" };
    }
    var cm = /Verfügbare Gliederungskapitel[^\n]*\n((?:- .+\n?)+)/.exec(promptText || "");
    var firstChapter = "keines";
    if (cm) {
      var firstLine = cm[1].split("\n")[0].replace(/^- /, "").trim();
      firstChapter = firstLine.split(" | ")[0];
    }
    var lm = /Verfügbare Labels[^\n]*\n((?:- .+\n?)+)/.exec(promptText || "");
    var label = "";
    if (lm) {
      var lines = lm[1].split("\n").filter(Boolean);
      label = (lines[0] || "").replace(/^- /, "").trim();
    }
    return { text: "Kapitel: " + firstChapter + "\nUnterkapitel: keines\nLabels: " + label, truncated: false, modelTierApplied: "default" };
  };
}
let sampleImpl = sampleImplFactory();
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>ROVO-1</key><summary>Testticket für Sitzung-Export</summary>
    <description>Dummy-Ticket, nur damit der Sitzung-Export nicht wegen 0 Tickets blockiert.</description>
    <status>Offen</status><type>Task</type></item>
</channel></rss>`;
function mockClipboard(win, text) {
  Object.defineProperty(win.navigator, "clipboard", {
    value: { readText: function () { return Promise.resolve(text); } },
    configurable: true,
  });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // Minimaler Ticket-Import, damit der Sitzung-Export (s. u.) nicht wegen
  // "0 Tickets, 0 Imports" blockiert (Guard existiert unabhängig von Rovo
  // Knowledge für alle Register).
  doc.querySelector('.nav-item[data-view="import"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "rovo_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);

  check("Register zeigt zunächst 0 Einträge", doc.getElementById("rovo-entries-count").textContent === "0");
  check("Leer-Hinweis sichtbar, solange keine Einträge vorhanden", !doc.getElementById("rovo-entries-empty").hidden);

  // ===================== Eintrag über die zwei Felder =====================
  doc.getElementById("rovo-chat-textarea").value = "Wie exportiere ich eine Version als PDF? Ticket ONESCM-4711 betrifft das.";
  doc.getElementById("rovo-answer-textarea").value = "Über den Button 'Als PDF exportieren' im Register Ausgabe.";
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(50);

  check("Nach Eintrag über beide Felder: 1 Eintrag in der Übersicht", doc.getElementById("rovo-entries-count").textContent === "1");
  check("Leer-Hinweis nach erstem Eintrag ausgeblendet", doc.getElementById("rovo-entries-empty").hidden);
  check("Eingabefelder nach Hinzufügen zurückgesetzt", doc.getElementById("rovo-chat-textarea").value === "" && doc.getElementById("rovo-answer-textarea").value === "");
  var firstRowLabels = doc.querySelector("#rovo-entries-tbody tr").children[5].textContent;
  check("Neuer Eintrag ist fest mit Label „ROVO“ markiert", firstRowLabels.includes("ROVO"));
  check("Chatverlauf-Vorschau im Eintrag sichtbar", doc.getElementById("rovo-entries-tbody").textContent.includes("Wie exportiere ich eine Version als PDF?"));
  check("Antwort-Vorschau im Eintrag sichtbar", doc.getElementById("rovo-entries-tbody").textContent.includes("Über den Button 'Als PDF exportieren'"));

  // ===================== Leerer Eintrag wird abgelehnt =====================
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(50);
  check("Leerer Eintrag (beide Felder leer) wird nicht hinzugefügt", doc.getElementById("rovo-entries-count").textContent === "1");
  check("Hinweis-Toast bei leerem Eintrag", doc.getElementById("toast").textContent.includes("Chatverlauf und/oder Antwort"));

  // ===================== Jira-Ticketnummer-Erkennung + Toggle =====================
  // Die rohe Chatverlauf-/Antwort-Vorschau enthält die Ticketnummer immer
  // (ist Teil des Originaltexts) - der Jira-Button blendet NUR die eigene
  // Spalte mit der extrahierten Ticketnummern-Liste ein/aus (s. Klärung
  // "pure show/hide toggle"), daher wird hier gezielt die Jira-Spalte
  // (children[6]) geprüft, nicht die ganze Zeile.
  var firstRow = doc.querySelector("#rovo-entries-tbody tr");
  check("Jira-Ticketnummer aus dem Text erkannt (Button zeigt Anzahl)", /Jira \(1/.test(firstRow.children[6].textContent));
  check("Ticketnummer ist in der Jira-Spalte standardmäßig ausgeblendet", !firstRow.children[6].textContent.includes("ONESCM-4711"));
  var jiraBtn = firstRow.querySelector("[data-rovo-jira-toggle]");
  fire(jiraBtn, "click");
  await wait(30);
  var firstRowAfterToggle = doc.querySelector("#rovo-entries-tbody tr");
  check("Nach Klick auf Jira-Button: Ticketnummer in der Jira-Spalte eingeblendet", firstRowAfterToggle.children[6].textContent.includes("ONESCM-4711"));
  fire(firstRowAfterToggle.querySelector("[data-rovo-jira-toggle]"), "click");
  await wait(30);
  check("Erneuter Klick: Ticketnummer in der Jira-Spalte wieder ausgeblendet", !doc.querySelector("#rovo-entries-tbody tr").children[6].textContent.includes("ONESCM-4711"));

  // ===================== Doppelklick öffnet Vollbild-Detailansicht =====================
  check("Detail-Modal zunächst versteckt", doc.getElementById("rovo-detail-modal-overlay").hidden === true);
  var detailRow = doc.querySelector("#rovo-entries-tbody tr");
  fire(detailRow, "dblclick");
  await wait(50);
  check("Doppelklick auf Zeile öffnet das Vollbild-Detail-Modal", doc.getElementById("rovo-detail-modal-overlay").hidden === false);
  check("Detail-Modal zeigt den vollständigen (ungekürzten) Chatverlauf", doc.getElementById("rovo-detail-modal-chat").textContent.includes("Wie exportiere ich eine Version als PDF? Ticket ONESCM-4711 betrifft das."));
  check("Detail-Modal zeigt die vollständige (ungekürzte) Antwort", doc.getElementById("rovo-detail-modal-answer").textContent.includes("Über den Button 'Als PDF exportieren' im Register Ausgabe."));
  fire(doc.getElementById("rovo-detail-modal-close"), "click");
  await wait(30);
  check("Schließen-Button (X) schließt das Detail-Modal", doc.getElementById("rovo-detail-modal-overlay").hidden === true);

  fire(detailRow, "dblclick");
  await wait(30);
  check("Erneuter Doppelklick öffnet das Modal wieder", doc.getElementById("rovo-detail-modal-overlay").hidden === false);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(30);
  check("Escape schließt das Detail-Modal", doc.getElementById("rovo-detail-modal-overlay").hidden === true);

  // Doppelklick auf ein interaktives Element (Dropdown) in der Zeile darf
  // NICHT das Modal öffnen (sonst liesse sich die Kapitel-Zuordnung per
  // Dropdown nicht mehr bequem per Doppelklick bedienen/markieren).
  fire(detailRow.querySelector(".rovo-chapter-select"), "dblclick");
  await wait(30);
  check("Doppelklick auf ein Dropdown öffnet das Modal NICHT", doc.getElementById("rovo-detail-modal-overlay").hidden === true);

  // ===================== Zwischenablage (zwei getrennte Buttons) =====================
  mockClipboard(win, "Clipboard-Chatverlauf-Text ohne Antwort.");
  fire(doc.getElementById("rovo-chat-paste-btn"), "click");
  await wait(50);
  check("Zwischenablage (Chatverlauf-Feld) eingefügt", doc.getElementById("rovo-chat-textarea").value === "Clipboard-Chatverlauf-Text ohne Antwort.");
  mockClipboard(win, "Clipboard-Antwort-Text.");
  fire(doc.getElementById("rovo-answer-paste-btn"), "click");
  await wait(50);
  check("Zwischenablage (Antwort-Feld) unabhängig vom Chatverlauf-Feld eingefügt", doc.getElementById("rovo-answer-textarea").value === "Clipboard-Antwort-Text.");
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(50);
  check("Per Zwischenablage befüllter Eintrag wurde hinzugefügt (jetzt 2 Einträge)", doc.getElementById("rovo-entries-count").textContent === "2");

  // ===================== .md-Datei MIT "---"-Trenner =====================
  var mdWithDivider = "Frage zur Lizenzprüfung bei Fahrzeugübergabe.\nZweite Zeile Chatverlauf.\n---\nAntwort: Lizenzprüfung erfolgt automatisch beim Speichern.";
  var mdInput = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(mdInput, "files", { value: [new win.File([mdWithDivider], "rovo_chat_1.md", { type: "text/markdown" })], configurable: true });
  fire(mdInput, "change");
  await wait(150);
  check("MD-Datei mit Trenner importiert (jetzt 3 Einträge)", doc.getElementById("rovo-entries-count").textContent === "3");
  var mdEntryRow = Array.from(doc.getElementById("rovo-entries-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Frage zur Lizenzprüfung"));
  check("MD mit Trenner: Chatverlauf-Spalte enthält nur den Teil VOR dem Trenner", !!mdEntryRow && !mdEntryRow.children[1].textContent.includes("Lizenzprüfung erfolgt automatisch"));
  check("MD mit Trenner: Antwort-Spalte enthält den Teil NACH dem Trenner", !!mdEntryRow && mdEntryRow.children[2].textContent.includes("Antwort: Lizenzprüfung"));

  // ===================== .md-Datei OHNE Trenner =====================
  var mdNoDivider = "Kompletter Chatverlauf-Text ohne jede Trennzeile, landet komplett im Chatverlauf-Feld.";
  var mdInput2 = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(mdInput2, "files", { value: [new win.File([mdNoDivider], "rovo_chat_2.md", { type: "text/markdown" })], configurable: true });
  fire(mdInput2, "change");
  await wait(150);
  check("MD-Datei ohne Trenner importiert (jetzt 4 Einträge)", doc.getElementById("rovo-entries-count").textContent === "4");
  var mdNoDivRow = Array.from(doc.getElementById("rovo-entries-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Kompletter Chatverlauf-Text"));
  check("MD ohne Trenner: ganzer Inhalt im Chatverlauf-Feld, Antwort-Spalte leer", !!mdNoDivRow && mdNoDivRow.children[2].textContent.trim() === "–");

  // ===================== Manuelle Kapitel-/Unterkapitel-Zuordnung =====================
  var chapterSelect = doc.querySelector(".rovo-chapter-select");
  var chapterOptions = Array.from(chapterSelect.options).map((o) => o.value).filter(Boolean);
  check("Kapitel-Dropdown bietet die tatsächliche Gliederung an", chapterOptions.length > 0);
  var manualChapterChoice = chapterOptions[0];
  chapterSelect.value = manualChapterChoice;
  fire(chapterSelect, "change");
  await wait(30);
  var subSelectAfter = doc.querySelector(".rovo-subchapter-select");
  check("Unterkapitel-Dropdown nach Kapitel-Auswahl aktiviert", !subSelectAfter.disabled);

  // ===================== KI-Zuordnung (Kapitel/Unterkapitel/Labels) =====================
  fire(doc.getElementById("rovo-ai-assign-btn"), "click");
  await wait(400);
  var chapterSelectsAfterAi = Array.from(doc.querySelectorAll(".rovo-chapter-select"));
  check("KI-Zuordnung: bereits manuell zugeordneter Eintrag bleibt unverändert (wird nie überschrieben)",
    chapterSelectsAfterAi[chapterSelectsAfterAi.length - 1].value === manualChapterChoice || chapterSelectsAfterAi.some((s) => s.value === manualChapterChoice));
  check("KI-Zuordnung: alle vorher offenen Einträge haben jetzt ein Kapitel erhalten",
    chapterSelectsAfterAi.every((s) => s.value !== ""));
  var labelsAfterAi = doc.getElementById("rovo-entries-tbody").textContent;
  check("KI-Zuordnung: Label „ROVO“ bleibt nach KI-Zuordnung auf allen Einträgen erhalten",
    Array.from(doc.querySelectorAll("#rovo-entries-tbody tr")).every((r) => r.textContent.includes("ROVO")));
  check("KI-Zuordnung-Status vermerkt abgeschlossenen Lauf", /zugeordnet/.test(doc.getElementById("rovo-ai-status-note").textContent));

  fire(doc.getElementById("rovo-ai-assign-btn"), "click");
  await wait(100);
  check("Erneute KI-Zuordnung ohne offene Einträge meldet „Nichts zu tun“", doc.getElementById("toast").textContent.includes("Alle Einträge haben bereits ein Kapitel"));

  // ===================== Zusammenfassung je Kapitel =====================
  // Alle 4 Einträge wurden (manuell + per gemocktem KI-Vorschlag, der
  // immer das ERSTE Kapitel der Liste nennt) demselben einen Kapitel
  // zugeordnet - die Übersicht zeigt daher genau 1 Zeile mit 4 Einträgen.
  var summaryChapterTitle = chapterSelectsAfterAi[0].value;
  check("Zusammenfassungs-Tabelle zeigt genau 1 Kapitel (alle Einträge demselben Kapitel zugeordnet)", doc.getElementById("rovo-chapter-summary-count").textContent === "1");
  check("Leer-Hinweis der Zusammenfassungs-Tabelle ausgeblendet", doc.getElementById("rovo-chapter-summary-empty").hidden === true);
  var summaryRow = doc.querySelector("#rovo-chapter-summary-tbody tr");
  check("Zusammenfassungs-Zeile nennt das Kapitel", summaryRow.children[0].textContent === summaryChapterTitle);
  check("Zusammenfassungs-Zeile zählt 4 Rovo-Einträge", summaryRow.children[1].textContent.trim() === "4");
  check("Zusammenfassungs-Status zunächst „Noch nicht erzeugt“", summaryRow.children[2].textContent.includes("Noch nicht erzeugt"));
  check("Vorschau-Bereich vor Erzeugung versteckt", doc.getElementById("rovo-chapter-summary-preview-section").hidden === true);

  fire(summaryRow.querySelector("[data-rovo-summary-generate]"), "click");
  await waitUntil(() => !doc.getElementById("rovo-chapter-summary-preview-section").hidden, 2000);
  check("Nach Erzeugen: Vorschau-Bereich sichtbar", doc.getElementById("rovo-chapter-summary-preview-section").hidden === false);
  check("Vorschau-Titel nennt das Kapitel", doc.getElementById("rovo-chapter-summary-preview-title").textContent === summaryChapterTitle);
  check("Vorschau zeigt den (gemockten) Zusammenfassungstext", doc.getElementById("rovo-chapter-summary-preview-output").textContent.includes("Vertragsanlage"));
  var summaryRowAfterGen = doc.querySelector("#rovo-chapter-summary-tbody tr");
  check("Status jetzt „Erzeugt“", summaryRowAfterGen.children[2].textContent.includes("Erzeugt"));
  check("Erzeugen-Button-Beschriftung wechselt zu „Neu erzeugen“", summaryRowAfterGen.querySelector("[data-rovo-summary-generate]").textContent.includes("Neu erzeugen"));
  check("Protokoll vermerkt die Kapitel-Zusammenfassung", doc.getElementById("log-list").textContent.includes("Zusammenfassung für Kapitel"));

  // "Anzeigen" nach Navigieren weg und zurück
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(30);
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(30);
  check("Nach erneutem Öffnen des Registers: Zusammenfassungs-Zeile weiterhin „Erzeugt“", doc.querySelector("#rovo-chapter-summary-tbody tr").children[2].textContent.includes("Erzeugt"));

  // Sammel-Lauf "Alle Zusammenfassungen erzeugen" (hier nur 1 Kapitel
  // vorhanden, prüft trotzdem den vollständigen Sammel-Lauf-Pfad).
  fire(doc.getElementById("rovo-chapter-summary-all-btn"), "click");
  await waitUntil(() => doc.getElementById("rovo-chapter-summary-all-status-note").textContent.includes("erzeugt"), 2000);
  check("Sammel-Lauf-Status vermerkt Abschluss", /von \d+ Zusammenfassungen erzeugt/.test(doc.getElementById("rovo-chapter-summary-all-status-note").textContent));

  // ===================== Manuelles Nachpflegen von Labels nach der KI-Zuordnung =====================
  var labelRow = doc.querySelector("#rovo-entries-tbody tr");
  check("ROVO-Chip hat KEINEN Entfernen-Button (fest, nicht entfernbar)",
    Array.from(labelRow.querySelectorAll("[data-rovo-label-remove]")).every((b) => b.getAttribute("data-label") !== "ROVO"));
  var addSelect = labelRow.querySelector(".rovo-label-add-select");
  var addableOption = Array.from(addSelect.options).map((o) => o.value).filter(Boolean)[0];
  check("Hinzufügen-Auswahl bietet mindestens ein noch nicht gesetztes Label an", !!addableOption);
  addSelect.value = addableOption;
  fire(addSelect, "change");
  await wait(30);
  var labelRowAfterAdd = doc.querySelector("#rovo-entries-tbody tr");
  check("Manuell hinzugefügtes Label erscheint im Eintrag", labelRowAfterAdd.textContent.includes(addableOption));

  var removeBtn = labelRowAfterAdd.querySelector('[data-rovo-label-remove][data-label="' + addableOption + '"]');
  fire(removeBtn, "click");
  await wait(30);
  var labelRowAfterRemove = doc.querySelector("#rovo-entries-tbody tr");
  check("Manuell entferntes Label verschwindet wieder aus dem Eintrag", !labelRowAfterRemove.querySelector('[data-rovo-label-remove][data-label="' + addableOption + '"]'));
  check("Entferntes Label steht in der Hinzufügen-Auswahl wieder zur Verfügung",
    Array.from(labelRowAfterRemove.querySelector(".rovo-label-add-select").options).some((o) => o.value === addableOption));
  check("Label „ROVO“ bleibt nach manuellem Hinzufügen/Entfernen weiterhin erhalten", labelRowAfterRemove.textContent.includes("ROVO"));

  // ===================== Sitzung speichern/laden (Rundlauf) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(100);
  check("Sitzung-Export (Rovo Knowledge) ausgelöst", savedFiles.some((f) => (f.filename || "").endsWith(".json")));
  var sessionJson = savedFiles.filter((f) => (f.filename || "").endsWith(".json")).pop().data;
  var sessionData = JSON.parse(sessionJson);
  check("Gesicherte Sitzung enthält rovoEntries (4 Einträge)", Array.isArray(sessionData.rovoEntries) && sessionData.rovoEntries.length === 4);
  check("Gesicherte Sitzung enthält rovoChapterSummaries mit der erzeugten Zusammenfassung", !!sessionData.rovoChapterSummaries && !!sessionData.rovoChapterSummaries[summaryChapterTitle]);

  var sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "sitzung.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(150);
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(50);
  check("Nach Sitzung-Laden: Rovo-Einträge wiederhergestellt (weiterhin 4)", doc.getElementById("rovo-entries-count").textContent === "4");
  check("Nach Sitzung-Laden: Kapitel-Zusammenfassung wiederhergestellt (Status weiterhin „Erzeugt“)", doc.querySelector("#rovo-chapter-summary-tbody tr").children[2].textContent.includes("Erzeugt"));

  // ===================== ZIP-Export aller Einträge =====================
  var zipSavedBefore = savedFiles.length;
  fire(doc.getElementById("rovo-zip-export-btn"), "click");
  await wait(150);
  check("ZIP-Export ausgelöst (neue Datei gespeichert)", savedFiles.length === zipSavedBefore + 1);
  var zipFile = savedFiles[zipSavedBefore];
  check("Exportierte Datei ist eine .zip-Datei", (zipFile.filename || "").endsWith(".zip"));
  var zipBuf = Buffer.from(await zipFile.data.arrayBuffer());
  var loadedZip = await JSZipNode.loadAsync(zipBuf);
  var zipEntryNames = Object.keys(loadedZip.files);
  check("ZIP enthält je Rovo-Eintrag eine eigene .md-Datei (4 Dateien)", zipEntryNames.filter((n) => n.endsWith(".md")).length === 4);
  var someMdContent = await loadedZip.files[zipEntryNames.find((n) => n.endsWith(".md"))].async("string");
  check("Eine .md-Datei im ZIP enthält Chatverlauf- und Antwort-Abschnitt", someMdContent.includes("## Chatverlauf") && someMdContent.includes("## Antwort"));
  check("Eine .md-Datei im ZIP enthält das Label „ROVO“ im Metadaten-Kopf", someMdContent.includes("ROVO"));

  // ===================== ZIP-Export ohne Einträge =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(50);
  check("Nach „Alle Daten löschen“: 0 Rovo-Einträge", doc.getElementById("rovo-entries-count").textContent === "0");
  check("Nach „Alle Daten löschen“: Zusammenfassungs-Tabelle wieder leer", doc.getElementById("rovo-chapter-summary-count").textContent === "0" && doc.getElementById("rovo-chapter-summary-empty").hidden === false);
  check("Nach „Alle Daten löschen“: Zusammenfassungs-Vorschau wieder versteckt", doc.getElementById("rovo-chapter-summary-preview-section").hidden === true);
  fire(doc.getElementById("rovo-zip-export-btn"), "click");
  await wait(50);
  check("ZIP-Export ohne Einträge zeigt verständlichen Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Noch keine Rovo-Einträge"));

  // ===================== Eintrag löschen =====================
  doc.getElementById("rovo-chat-textarea").value = "Zu löschender Eintrag.";
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(50);
  check("Eintrag zum Löschen vorbereitet (1 Eintrag)", doc.getElementById("rovo-entries-count").textContent === "1");
  fire(doc.querySelector("[data-rovo-delete]"), "click");
  await wait(50);
  check("Eintrag erfolgreich gelöscht (wieder 0 Einträge)", doc.getElementById("rovo-entries-count").textContent === "0");

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE ROVO-KNOWLEDGE-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
