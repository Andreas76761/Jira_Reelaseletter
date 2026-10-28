// RAG-Bibliothek, Abschnitte "6. Automatische Chunk-Erzeugung" und "7.
// RAG-Analyse" (gesamter Chunk-Bestand): die automatische Chunk-Erzeugung
// baut die Bibliothek je Gliederungskapitel aus allen bereits vorhandenen
// Quellen auf (Tickets, Rovo-Wissens-Notizen, Tabellen, Bildbeschreibungen,
// bereits erzeugter Benutzerhandbuch-Text) - idempotent (ein erneuter Lauf
// ersetzt nur die zuvor automatisch erzeugten Chunks, manuell gespeicherte/
// importierte Einträge bleiben erhalten). Die RAG-Analyse ist EIN einzelner
// Claude-Bericht (Zusammenhänge/Genauigkeit/Priorität/Klärungsbedarf) über
// den gesamten aktuellen Chunk-Bestand - bewusst nicht je Kapitel.
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

const RAG_ANALYSIS_MOCK = "### Zusammenhänge\n- Testzusammenhang zwischen mehreren Chunks.\n\n### Genauigkeit\n- Testbefund zur Genauigkeit.\n\n### Priorität\n- Testbefund zur Priorität.\n\n### Klärungsbedarf\n- Testbefund zum Klärungsbedarf.";

let sampleCalls = [];
let sampleImpl = async (input, opts) => {
  sampleCalls.push({ input, opts });
  if (input.indexOf("Wissensanalyst") !== -1) return { text: RAG_ANALYSIS_MOCK, truncated: false, modelTierApplied: "default" };
  return { text: "Kapiteltext für Kapitel 7 (Test).", truncated: false, modelTierApplied: "default" };
};
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

const KAP7 = "Kapitel 7: Verträge im Alltag verwalten";

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>RAC-1</key><summary>Vertragsänderung durchführen</summary>
    <description>Der Dealer ändert den bestehenden Vertrag.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

// .docx mit 1 Überschrift + 1 eingebettetem Bild - die Überschrift wird bei
// der Extraktion automatisch zur Bildbeschreibung (s. handleEditorFiles(),
// screen.caption), genau wie bei echten Bildband-Importen.
async function buildDocxWithOneImage() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Maske Vertragsänderung</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' +
    "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/media/image1.png", PNG_1X1);
  return zip.generateAsync({ type: "nodebuffer" });
}

// .docx mit Chatverlauf/Antwort (-> Rovo-Eintrag) UND 1 Tabelle (-> Register
// Tabelle), gleiches Muster wie edito_table_embed_test.js/edito_agent3_test.js.
async function buildDocxWithTable() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    "<w:p><w:r><w:t>Chatverlauf: Welche Felder sind bei der Vertragsänderung Pflicht?</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>---</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Antwort: Siehe Tabelle unten.</w:t></w:r></w:p>" +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pflicht</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "</w:body></w:document>";
  zip.file("word/document.xml", docXml);
  return zip.generateAsync({ type: "nodebuffer" });
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

  doc.querySelector('.nav-item[data-view="import"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "rag_auto_chunks_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Vorbereitung: Benutzerhandbuch-Text, Bild, Rovo-Notiz + Tabelle je für Kapitel 7 =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => doc.getElementById("manual-chapters-list").children.length >= 1, 3000);
  await wait(50);
  check("Vorbereitung: Benutzerhandbuch-Text für Kapitel 7 erzeugt", !!doc.querySelector('[data-manual-chapter="' + KAP7 + '"]'));

  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);
  const imageBuf = await buildDocxWithOneImage();
  const imageFile = new win.File([imageBuf], "screens.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const editorFileInput = doc.getElementById("editor-file-input");
  Object.defineProperty(editorFileInput, "files", { value: [imageFile], configurable: true });
  fire(editorFileInput, "change");
  await waitUntil(() => doc.querySelectorAll("#editor-screens-tbody tr").length === 1, 2000);
  const screenChapterSel = doc.querySelector(".editor-screen-chapter-select");
  screenChapterSel.value = KAP7;
  fire(screenChapterSel, "change");
  await wait(30);

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  const tableBuf = await buildDocxWithTable();
  const tableFile = new win.File([tableBuf], "felder.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const rovoFileInput = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(rovoFileInput, "files", { value: [tableFile], configurable: true });
  fire(rovoFileInput, "change");
  await wait(500);
  const rovoChapterSel = doc.querySelector(".rovo-chapter-select");
  rovoChapterSel.value = KAP7;
  fire(rovoChapterSel, "change");
  await wait(30);

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  const tableChapterSel = doc.querySelector(".rovo-table-chapter-select");
  tableChapterSel.value = KAP7;
  fire(tableChapterSel, "change");
  await wait(30);

  // ===================== RAG-Analyse-Button ohne jeglichen Chunk-Bestand =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(100);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  check("Vor jeglicher Chunk-Erzeugung: RAG-Analyse-Hinweis 'Noch keine Analyse erstellt' sichtbar", doc.getElementById("rag-analysis-empty").hidden === false);
  fire(doc.getElementById("rag-analysis-run-btn"), "click");
  await wait(50);
  check("RAG-Analyse ohne Chunks: Hinweis auf leere Bibliothek statt Absturz", doc.getElementById("toast").textContent.includes("Bibliothek leer"));
  check("RAG-Analyse-Ergebnis bleibt dabei versteckt", doc.getElementById("rag-analysis-result").hidden === true);

  // ===================== (1) Automatische Chunk-Erzeugung =====================
  fire(doc.getElementById("rag-auto-generate-btn"), "click");
  await wait(50);
  check("(1) Zusammenfassung nach Chunk-Erzeugung sichtbar", doc.getElementById("rag-auto-summary").hidden === false);
  check("(1) Statuszeile nennt 5 erzeugte Chunks", doc.getElementById("rag-auto-status-note").textContent.includes("5 Chunk(s) automatisch erzeugt"));
  let rows = Array.from(doc.querySelectorAll("#rag-library-tbody tr"));
  check("(1) Bibliothek enthält genau 5 automatisch erzeugte Chunks", rows.length === 5);
  check("(1) Alle 5 Chunks als 'Automatisch' ausgewiesen", rows.every((r) => r.children[5].textContent === "Automatisch"));
  function rowWithLabel(sub) { return rows.find((r) => r.children[0].textContent.includes(sub)); }
  const ticketRow = rowWithLabel("Tickets: " + KAP7);
  const handbuchRow = rowWithLabel("Handbuchtext: " + KAP7);
  const rovoRow = rowWithLabel("Rovo: Chatverlauf: Welche Felder");
  const tableRow = rowWithLabel("Tabelle 1: felder.docx");
  const imageRow = rowWithLabel("Bild: Maske Vertragsänderung");
  check("(1) Ticket-Chunk für Kapitel 7 vorhanden", !!ticketRow);
  check("(1) Handbuchtext-Chunk für Kapitel 7 vorhanden", !!handbuchRow);
  check("(1) Rovo-Chunk vorhanden", !!rovoRow);
  check("(1) Tabellen-Chunk vorhanden", !!tableRow);
  check("(1) Bild-Chunk vorhanden", !!imageRow);
  check("(1) Ticket-Chunk zeigt Ticketanzahl", !!ticketRow && ticketRow.children[4].textContent === "1");
  check("(1) Ticket-Chunk bereits mit Kapitel 7 vorbelegt", !!ticketRow && ticketRow.querySelector(".rag-library-chapter-select").value === KAP7);
  check("(1) Bild-Chunk bereits mit Kapitel 7 vorbelegt", !!imageRow && imageRow.querySelector(".rag-library-chapter-select").value === KAP7);

  // ===================== (2) Idempotenz: erneuter Lauf ersetzt nur automatische Chunks =====================
  const mdImportFile = new win.File(["# Manuelle Notiz\n\nVon Hand importierter Text, kein Bezug zu Kapitel 7."], "Manuelle Notiz.md", { type: "text/markdown" });
  const libraryImportInput = doc.getElementById("rag-library-import-input");
  Object.defineProperty(libraryImportInput, "files", { value: [mdImportFile], configurable: true });
  fire(libraryImportInput, "change");
  await wait(200);
  check("(2) Nach manuellem Import: Bibliothek enthält 6 Einträge (5 automatisch + 1 importiert)", doc.querySelectorAll("#rag-library-tbody tr").length === 6);

  fire(doc.getElementById("rag-auto-generate-btn"), "click");
  await wait(50);
  rows = Array.from(doc.querySelectorAll("#rag-library-tbody tr"));
  check("(2) Erneuter Lauf: weiterhin genau 6 Einträge (keine Duplikate der automatischen Chunks)", rows.length === 6);
  check("(2) Manuell importierter Eintrag bleibt nach erneutem Lauf erhalten", rows.some((r) => r.children[0].textContent.includes("Manuelle Notiz.md")));
  check("(2) Importierter Eintrag weiterhin als 'Importiert' ausgewiesen", rows.find((r) => r.children[0].textContent.includes("Manuelle Notiz.md")).children[5].textContent === "Importiert");

  // ===================== (3) RAG-Analyse über den gesamten Chunk-Bestand =====================
  sampleCalls = [];
  fire(doc.getElementById("rag-analysis-run-btn"), "click");
  await waitUntil(() => doc.getElementById("rag-analysis-result").hidden === false, 2000);
  check("(3) sample() genau einmal für die RAG-Analyse aufgerufen", sampleCalls.length === 1);
  check("(3) Prompt nennt die Gesamtanzahl der Chunks", sampleCalls[0].input.includes("CHUNKS (6):"));
  check("(3) Prompt enthält den Ticket-Chunk mit Kapitel-Angabe", sampleCalls[0].input.includes("Tickets: " + KAP7) && sampleCalls[0].input.includes("Kapitel: " + KAP7));
  check("(3) Prompt enthält den manuell importierten Chunk", sampleCalls[0].input.includes("Manuelle Notiz.md"));
  check("(3) Ergebnis-Bereich sichtbar, 'Noch keine Analyse'-Hinweis versteckt", doc.getElementById("rag-analysis-empty").hidden === true);
  check("(3) Metazeile nennt Erstellungsdatum und Chunk-Anzahl", doc.getElementById("rag-analysis-meta").textContent.includes("6 Chunk(s)"));
  const analysisOutput = doc.getElementById("rag-analysis-output").textContent;
  check("(3) Bericht enthält alle 4 Abschnitte", ["Zusammenhänge", "Genauigkeit", "Priorität", "Klärungsbedarf"].every((s) => analysisOutput.includes(s)));
  check("(3) Statuszeile vermerkt Abschluss", doc.getElementById("rag-analysis-status-note").textContent.includes("6 Chunk(s) erstellt"));
  check("(3) Protokoll vermerkt RAG-Analyse-Lauf", doc.getElementById("log-list").textContent.includes("RAG-Analyse"));
  check("(3) Spinner nach Abschluss wieder versteckt", doc.getElementById("rag-analysis-spinner").hidden === true);
  check("(3) Button nach Abschluss wieder aktiv", doc.getElementById("rag-analysis-run-btn").disabled === false);

  // ===================== (4) Sitzung speichern/laden sichert Chunk-Bibliothek + RAG-Analyse =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(4) Export enthält ragLibrary mit 6 Einträgen", Array.isArray(exportedJson.ragLibrary) && exportedJson.ragLibrary.length === 6);
  check("(4) Export enthält ragAnalysis mit dem erstellten Bericht", exportedJson.ragAnalysis && exportedJson.ragAnalysis.text.includes("Zusammenhänge") && exportedJson.ragAnalysis.chunkCount === 6);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  check("(4) Nach 'Alle Daten löschen': Bibliothek geleert", doc.querySelectorAll("#rag-library-tbody tr").length === 0);
  check("(4) Nach 'Alle Daten löschen': RAG-Analyse-Ergebnis wieder versteckt", doc.getElementById("rag-analysis-result").hidden === true);

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  check("(4) Nach Laden: Bibliothek mit 6 Einträgen wiederhergestellt", doc.querySelectorAll("#rag-library-tbody tr").length === 6);
  check("(4) Nach Laden: RAG-Analyse-Ergebnis wiederhergestellt", doc.getElementById("rag-analysis-result").hidden === false);
  check("(4) Nach Laden: RAG-Analyse-Text wiederhergestellt", doc.getElementById("rag-analysis-output").textContent.includes("Zusammenhänge"));
  check("(4) Nach Laden: Metazeile wiederhergestellt", doc.getElementById("rag-analysis-meta").textContent.includes("6 Chunk(s)"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE RAG-AUTO-CHUNKS/ANALYSE-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
