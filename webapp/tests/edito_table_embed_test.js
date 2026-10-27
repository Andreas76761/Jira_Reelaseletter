// EDITO (Register "Editor"): aus Rovo Knowledge extrahierte, einem Kapitel
// zugeordnete Tabellen (s. Register "Tabelle") werden jetzt direkt ins
// generierte Benutzerhandbuch-Kapitel eingebettet - analog zum bestehenden
// [Bild]-Platzhalter-Mechanismus, aber mit einem neuen [Tabelle]-Platzhalter:
// der Prompt nennt die zugeordneten Tabellen als eigene QUELLE 6 und weist
// an, [Tabelle]-Platzhalter einzufügen; beim DOCX-/PDF-Export (Einzelkapitel
// UND Gesamtdokument) wird der Platzhalter durch eine echte, auf die
// Seitenbreite angepasste Tabelle ersetzt (nicht als Bild, sondern als
// strukturierte w:tbl bzw. gezeichnete PDF-Tabelle). Separate Datei von
// edito_test.js, da hier eine eigene Rovo-Tabellen-Fixture gebraucht wird.
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

let lastChapterPromptText = "";
async function sampleImpl(promptText) {
  if (/KAPITELTEXT:/.test(promptText || "") || /Grammatikfehler/.test(promptText || "")) {
    return { text: "### Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  lastChapterPromptText = promptText || "";
  // Simuliert, dass Claude dem Prompt-Hinweis folgt und einen [Tabelle]-
  // Platzhalter an passender Stelle einfuegt (wie bereits bei [Bild]).
  return { text: "## Retail\nEinleitender Absatz.\n[Tabelle]\nAbschliessender Absatz.\n", truncated: false, modelTierApplied: "default" };
}
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

// Dieselbe Fixture wie outline_versions_test.js/edito_test.js: OV-1 matcht
// die Version "Dealer" -> Kapitel 7.
const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>OV-1</key><summary>Pkw Dealer Ticket</summary><description>Pkw/Dealer Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

// Minimaler, aber echter .docx-Rohbau mit einer 2x3-Tabelle (gleiches Muster
// wie rovo_knowledge_extraction_test.js).
async function buildDocxWithTable() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    "<w:p><w:r><w:t>Chatverlauf: Welche Felder hat die Vertragstabelle?</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>---</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Antwort: Siehe untenstehende Tabelle.</w:t></w:r></w:p>" +
    "<w:tbl>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pflicht</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Vertragsnummer</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ja</w:t></w:r></w:p></w:tc></w:tr>" +
    "</w:tbl>" +
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

  // ===================== Tickets importieren =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "edito_table_embed_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== EDITO: Rolle/Sparte "Dealer" wählen =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  const versionSelect = doc.getElementById("edito-version-select");
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(100);

  function rowFor(chapterTitleSubstring) {
    return Array.from(doc.getElementById("edito-chapters-tbody").querySelectorAll("tr")).find((r) => r.children[1].textContent.includes(chapterTitleSubstring));
  }
  const kap7Row = rowFor("Kapitel 7");
  check("Kapitel 7 (Contract Management, Retail-Ticket) ist in Dealer-Version enthalten", !!kap7Row);
  check("Kapitel 7: Tabellen-Spalte zunächst 0", !!kap7Row && kap7Row.children[7].textContent.trim() === "0");
  const kap7TitleFull = kap7Row.children[1].textContent;

  // ===================== Rovo-Tabelle für Kapitel 7 anlegen =====================
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  const docxBuf = await buildDocxWithTable();
  const docxFile = new win.File([docxBuf], "vertragsfelder.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const fileInput = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(fileInput, "files", { value: [docxFile], configurable: true });
  fire(fileInput, "change");
  await wait(500);
  check("Rovo Knowledge: Tabelle aus DOCX extrahiert", doc.getElementById("rovo-tables-count") && true); // nur Vorbedingung, echte Prüfung unten nach View-Wechsel

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Register Tabelle: 1 extrahierte Tabelle", doc.getElementById("rovo-tables-count").textContent === "1");
  const tableChapterSel = doc.querySelector(".rovo-table-chapter-select");
  tableChapterSel.value = kap7TitleFull;
  fire(tableChapterSel, "change");
  await wait(50);

  // ===================== EDITO: Tabellen-Spalte jetzt 1, Prompt enthält QUELLE 6 =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  const kap7RowAfterTable = rowFor("Kapitel 7");
  check("Kapitel 7: Tabellen-Spalte jetzt 1 (nach Zuordnung)", kap7RowAfterTable.children[7].textContent.trim() === "1");

  fire(kap7RowAfterTable.querySelector("[data-edito-generate]"), "click");
  const genDone = await waitUntil(() => !!rowFor("Kapitel 7").querySelector("[data-edito-view]"), 2000);
  check("Kapitel 7 erzeugt", genDone);
  check("Prompt nennt QUELLE 6 mit der zugeordneten Tabelle", /QUELLE 6.*Tabelle 1 aus vertragsfelder\.docx/s.test(lastChapterPromptText));
  check("Prompt nennt die Tabellen-Dimension (2 Zeilen x 2 Spalten)", lastChapterPromptText.includes("(2 Zeilen x 2 Spalten)"));
  check("Prompt weist auf [Tabelle]-Platzhalter hin", lastChapterPromptText.includes("[Tabelle]-Platzhalter einfügen"));

  // ===================== DOCX-Export: Platzhalter durch echte Tabelle ersetzt =====================
  await wait(100);
  const docxBtn = doc.querySelector('[data-edito-file-download="docx"][data-edito-file-chapter]');
  check("Dokumenten-Übersicht bietet Word-Download an", !!docxBtn);
  const savedBeforeDocx = savedFiles.length;
  fire(docxBtn, "click");
  await wait(150);
  check("Word-Export ausgelöst", savedFiles.length === savedBeforeDocx + 1);
  const docxZip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedBeforeDocx].data.arrayBuffer()));
  const docxXml = await docxZip.file("word/document.xml").async("string");
  check("Exportiertes Kapitel enthält KEINEN rohen [Tabelle]-Platzhalter mehr", !docxXml.includes("[Tabelle]"));
  check("Exportiertes Kapitel enthält eine echte Word-Tabelle (w:tbl)", docxXml.includes("<w:tbl>"));
  check("Eingebettete Tabelle enthält den Zellinhalt „Vertragsnummer“", docxXml.includes("Vertragsnummer"));
  check("Eingebettete Tabelle trägt eine Quellverweis-Caption", docxXml.includes("Tabelle 1: vertragsfelder.docx"));
  check("Umgebender Fließtext (vor/nach dem Platzhalter) bleibt erhalten", docxXml.includes("Einleitender Absatz") && docxXml.includes("Abschliessender Absatz"));
  check("Tabelle nutzt festes Spaltenlayout (passt garantiert auf die Seite)", docxXml.includes('w:tblLayout w:type="fixed"'));

  // ===================== PDF-Export: kein Absturz, nicht-triviale Dateigröße =====================
  const pdfBtn = doc.querySelector('[data-edito-file-download="pdf"][data-edito-file-chapter]');
  const savedBeforePdf = savedFiles.length;
  fire(pdfBtn, "click");
  await wait(150);
  check("PDF-Export ausgelöst", savedFiles.length === savedBeforePdf + 1);
  check("PDF-Datei ist nicht leer (Tabellen-Zeichnung ohne Absturz)", savedFiles[savedBeforePdf].data.size > 500);

  // ===================== Gesamtdokument: Tabelle bleibt auch dort erhalten =====================
  fire(doc.getElementById("edito-merge-btn"), "click");
  await wait(150);
  check("Gesamtdokument-Vorschau sichtbar", doc.getElementById("edito-merge-preview-section").hidden === false);
  const savedBeforeMerge = savedFiles.length;
  fire(doc.getElementById("edito-merge-download-btn"), "click");
  await wait(150);
  check("Gesamtdokument-Download ausgelöst", savedFiles.length === savedBeforeMerge + 1);
  const mergedZip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedBeforeMerge].data.arrayBuffer()));
  const mergedXml = await mergedZip.file("word/document.xml").async("string");
  check("Gesamtdokument enthält ebenfalls die echte Tabelle (w:tbl)", mergedXml.includes("<w:tbl>") && mergedXml.includes("Vertragsnummer"));
  check("Gesamtdokument enthält KEINEN rohen [Tabelle]-Platzhalter mehr", !mergedXml.includes("[Tabelle]"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE EDITO-TABELLEN-EINBETTUNGS-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
