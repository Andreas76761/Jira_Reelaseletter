// Neues Register "Rovo Summary" (direkt nach Rovo Knowledge): beliebig
// viele Quelldokumente (.docx/.doc, echtes .html/.htm, Zwischenablage-
// Text) sammeln, per Claude zu EINEM frei strukturierten Gesamtdokument
// ordnen (keine Kapitel-Zuordnung) und dieses Gesamtdokument anschließend
// gegen ALLE vorhandenen Quellen (Tickets, RAG-Bibliothek, Rovo-
// Bibliothek, Benutzerhandbuch/EDITO) vergleichen. Prüft: Guards,
// Datei-Import (.docx echt + .html mit HTML-Tag-Entfernung),
// Zwischenablage-Quelle (Button + manuelles Einfügen), Quellen entfernen,
// Gesamtdokument-Erzeugung (Prompt-Inhalt, editierbare Ausgabe, Download),
// Vergleich (Prompt nennt alle 5 Quellenblöcke inkl. "nicht vorhanden"-
// Fälle), Reset bei "Alle Daten löschen".
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
async function sampleImpl(promptText) {
  sampleCalls.push({ input: promptText });
  if (promptText.indexOf("NEUES GESAMTDOKUMENT:") !== -1) {
    return { text: "### Neue Informationen\n- Testbefund A\n\n### Widersprüche zu bestehenden Quellen\nKeine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "## Vertragsänderungen\nZusammengeführter Text aus allen Quellen.", truncated: false, modelTierApplied: "default" };
}
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
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
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
function mockClipboard(win, text) {
  Object.defineProperty(win.navigator, "clipboard", { value: { readText: function () { return Promise.resolve(text); } }, configurable: true });
}
async function buildTestDocxBuffer(paragraphs) {
  var zip = new JSZipNode();
  var body = paragraphs.map(function (p) { return "<w:p><w:r><w:t>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</w:t></w:r></w:p>"; }).join("");
  zip.file("word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" + body + "</w:body></w:document>");
  return zip.generateAsync({ type: "nodebuffer" });
}

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>RSUM-1</key><summary>Vertragsänderung online durchführen</summary><description>Testticket.</description><status>Offen</status><type>Task</type></item>
</channel></rss>`;

const HTML_SOURCE = "<!doctype html><html><head><title>Notiz</title><style>body{color:red}</style></head>" +
  "<body><h1>Wichtige Notiz</h1><p>Der Dealer darf Verträge <b>online</b> ändern.</p>" +
  "<ul><li>Schritt eins</li><li>Schritt zwei</li></ul><script>alert('x')</script></body></html>";

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

  // ===================== Vorhandene Quellen aufbauen (Tickets/RAG/Rovo) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "rovo_summary_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(100);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  const mdFile = new win.File(["# Hinweis\n\nVertragsänderungen online moeglich."], "Hinweis.md", { type: "text/markdown" });
  const libraryImportInput = doc.getElementById("rag-library-import-input");
  Object.defineProperty(libraryImportInput, "files", { value: [mdFile], configurable: true });
  fire(libraryImportInput, "change");
  await wait(200);

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  doc.getElementById("rovo-chat-textarea").value = "Wie aendert man einen Vertrag?";
  fire(doc.getElementById("rovo-chat-textarea"), "input");
  doc.getElementById("rovo-answer-textarea").value = "Ueber die Maske Vertragsaenderung online.";
  fire(doc.getElementById("rovo-answer-textarea"), "input");
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(100);

  // ===================== Rovo Summary: Guards =====================
  doc.querySelector('.nav-item[data-view="rovosummary"]').click();
  await wait(100);
  fire(doc.getElementById("rovo-summary-merge-btn"), "click");
  await wait(50);
  check("Guard ohne Quellen: Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Keine Quellen"));
  fire(doc.getElementById("rovo-summary-compare-btn"), "click");
  await wait(50);
  check("Guard ohne Gesamtdokument: Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Kein Gesamtdokument"));

  // ===================== Quelle 1: echte .docx-Datei =====================
  const docxBuf = await buildTestDocxBuffer(["Aus dem Word-Dokument: Vertraege koennen online angepasst werden."]);
  const docxFile = new win.File([docxBuf], "quelle1.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const fileInput = doc.getElementById("rovo-summary-file-input");
  Object.defineProperty(fileInput, "files", { value: [docxFile], configurable: true });
  fire(fileInput, "change");
  await wait(200);
  check("Nach .docx-Upload: 1 Quelle in der Übersicht", doc.getElementById("rovo-summary-sources-count").textContent === "1");

  // ===================== Quelle 2: echte .html-Datei (Tag-Entfernung) =====================
  const htmlFile = new win.File([HTML_SOURCE], "quelle2.html", { type: "text/html" });
  Object.defineProperty(fileInput, "files", { value: [htmlFile], configurable: true });
  fire(fileInput, "change");
  await wait(200);
  check("Nach .html-Upload: 2 Quellen in der Übersicht", doc.getElementById("rovo-summary-sources-count").textContent === "2");
  const sourcesText = doc.getElementById("rovo-summary-sources-tbody").textContent;
  check("Quellen-Tabelle nennt beide Dateinamen", sourcesText.includes("quelle1.docx") && sourcesText.includes("quelle2.html"));

  // ===================== Quelle 3: Zwischenablage (Button füllt Textarea) =====================
  mockClipboard(win, "Aus der Zwischenablage: Kuendigungsfristen stehen im System.");
  fire(doc.getElementById("rovo-summary-paste-clipboard-btn"), "click");
  await wait(100);
  check("Zwischenablage-Button füllt Textarea", doc.getElementById("rovo-summary-paste-textarea").value.includes("Kuendigungsfristen"));
  doc.getElementById("rovo-summary-paste-title").value = "E-Mail Fachbereich";
  fire(doc.getElementById("rovo-summary-paste-title"), "input");
  fire(doc.getElementById("rovo-summary-paste-add-btn"), "click");
  await wait(100);
  check("Nach Zwischenablage-Hinzufügen: 3 Quellen in der Übersicht", doc.getElementById("rovo-summary-sources-count").textContent === "3");
  check("Textarea nach Hinzufügen geleert (bereit für nächste Quelle)", doc.getElementById("rovo-summary-paste-textarea").value === "");

  // ===================== Quelle entfernen =====================
  const firstRemoveBtn = doc.querySelector('[data-rovo-summary-remove]');
  fire(firstRemoveBtn, "click");
  await wait(50);
  check("Nach Entfernen: 2 Quellen übrig", doc.getElementById("rovo-summary-sources-count").textContent === "2");

  // ===================== Gesamtdokument erzeugen =====================
  sampleCalls = [];
  fire(doc.getElementById("rovo-summary-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("rovo-summary-merge-output").value.includes("Zusammengeführter Text"), 2000);
  check("Merge: sample() einmal aufgerufen", sampleCalls.length === 1);
  check("Merge-Prompt enthält mind. eine der verbleibenden Quellen", sampleCalls[0].input.includes("Vertraege koennen online") || sampleCalls[0].input.includes("Kuendigungsfristen"));
  check("Merge-Prompt enthält die .html-Quelle (per Dateiname als Titel)", sampleCalls[0].input.includes("quelle2.html"));
  check("Merge-Prompt bei .html-Quelle: keine rohen HTML-Tags mehr enthalten (gestrippt)", !/<p>|<script|<style|<h1>/i.test(sampleCalls[0].input));
  check("Merge-Prompt bei .html-Quelle: lesbarer Text aus dem HTML extrahiert", sampleCalls[0].input.includes("Wichtige Notiz") && sampleCalls[0].input.includes("Schritt eins"));
  check("Merge-Ausgabe im Textfeld sichtbar", doc.getElementById("rovo-summary-merge-output").value.includes("Vertragsänderungen"));
  check("Merge-Statuszeile vermerkt Erzeugung", doc.getElementById("rovo-summary-merge-status-note").textContent.includes("erzeugt"));
  check("Download-Button (Gesamtdokument) nach Erzeugung aktiv", doc.getElementById("rovo-summary-merge-download-btn").disabled === false);

  // ===================== Gesamtdokument manuell nachbearbeiten (editierbar) =====================
  doc.getElementById("rovo-summary-merge-output").value = "## Vertragsänderungen\nManuell nachbearbeiteter Text für den Vergleich.";
  fire(doc.getElementById("rovo-summary-merge-output"), "input");
  await wait(30);

  // ===================== Mit vorhandenen Informationen vergleichen =====================
  sampleCalls = [];
  fire(doc.getElementById("rovo-summary-compare-btn"), "click");
  await waitUntil(() => doc.getElementById("rovo-summary-compare-result").hidden === false && doc.getElementById("rovo-summary-compare-output").textContent.includes("Testbefund"), 2000);
  check("Vergleich: sample() einmal aufgerufen", sampleCalls.length === 1);
  const comparePrompt = sampleCalls[0].input;
  check("Vergleich-Prompt enthält den manuell bearbeiteten Gesamtdokument-Text", comparePrompt.includes("Manuell nachbearbeiteter Text"));
  check("Vergleich-Prompt nennt Quelle A (Tickets) mit Ticket-Key", comparePrompt.includes("QUELLE A") && comparePrompt.includes("RSUM-1"));
  check("Vergleich-Prompt nennt Quelle B (RAG-Bibliothek)", comparePrompt.includes("QUELLE B") && comparePrompt.includes("Hinweis"));
  check("Vergleich-Prompt nennt Quelle C (Rovo-Bibliothek)", comparePrompt.includes("QUELLE C") && comparePrompt.includes("Vertrag"));
  check("Vergleich-Prompt nennt Quelle D (Benutzerhandbuch) als 'keiner vorhanden'", comparePrompt.includes("QUELLE D") && comparePrompt.includes("(keiner vorhanden)"));
  check("Vergleich-Prompt nennt Quelle E (EDITO-Entwürfe) als 'keine vorhanden'", comparePrompt.includes("QUELLE E") && comparePrompt.includes("(keine vorhanden)"));
  check("Vergleich-Ausgabe zeigt Claude-Ergebnis", doc.getElementById("rovo-summary-compare-output").textContent.includes("Neue Informationen"));
  check("Vergleich-Statuszeile vermerkt Abschluss", doc.getElementById("rovo-summary-compare-status-note").textContent.includes("abgeschlossen"));

  // ===================== Downloads =====================
  let savedBefore = savedFiles.length;
  fire(doc.getElementById("rovo-summary-merge-download-btn"), "click");
  await wait(100);
  check("Gesamtdokument-Download ausgelöst", savedFiles.length === savedBefore + 1);
  savedBefore = savedFiles.length;
  fire(doc.getElementById("rovo-summary-compare-download-btn"), "click");
  await wait(100);
  check("Vergleich-Download ausgelöst", savedFiles.length === savedBefore + 1);

  // ===================== Reset bei "Alle Daten löschen" =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="rovosummary"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Quellen-Übersicht wieder leer", doc.getElementById("rovo-summary-sources-empty").hidden === false);
  check("Nach 'Alle Daten löschen': Gesamtdokument-Textfeld geleert", doc.getElementById("rovo-summary-merge-output").value === "");
  check("Nach 'Alle Daten löschen': Vergleichsergebnis wieder versteckt", doc.getElementById("rovo-summary-compare-result").hidden === true);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE ROVO-SUMMARY-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
