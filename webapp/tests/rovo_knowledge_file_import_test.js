// Rovo Knowledge: Datei-Import erweitert um .docx/.doc, .pdf und .pptx
// zusätzlich zum bestehenden .md-Import (separate Datei von
// rovo_knowledge_test.js, da hier eigene, realistische Datei-Fixtures
// für jedes Format gebraucht werden). Prüft: Dropzone/Input akzeptieren
// die neuen Endungen, jedes Format wird korrekt zu Text extrahiert und
// per "---"-Trennzeile (falls vorhanden) in Chatverlauf/Antwort
// aufgeteilt, mehrere Dateien gemischter Formate in einem Rutsch, ein
// Fehlerfall (kaputte Datei) bricht den Rest nicht ab, frisch
// importierte Zeilen werden kurz hervorgehoben (rovo-row-new) - und NUR
// für genau diesen einen Render, nicht bei einem späteren, unabhängigen
// Re-Render.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|Could not load script/i)) errors.push(e.message); });

// Vom Test kontrollierbare Textfragmente fuer den PDF-Import-Mock (gleiches
// Muster wie pdf_import_test.js) - jedes Fragment eine eigene Zeile.
var pdfLinesQueue = [];
function makeFakeItem(str, x, y) { return { str: str, transform: [1, 0, 0, 1, x, y], width: str.length * 6 }; }
function pdfItemsFromLines(lines) {
  return lines.map(function (line, i) { return makeFakeItem(line, 50, 700 - i * 20); });
}

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: function () {
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: function () { return Promise.resolve({ getTextContent: function () { return Promise.resolve({ items: pdfItemsFromLines(pdfLinesQueue) }); } }); },
            destroy: function () { return Promise.resolve(); },
          }),
        };
      },
    };
    window.claude = { use: function () { return Promise.resolve(null); } };
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

// Minimaler, aber echter .docx-Rohbau (ZIP + word/document.xml) - reicht
// aus, damit die App-eigene extractTextFromDocx()/docxArrayBufferToLines()
// den Inhalt korrekt liest (vgl. Aufbau in buildManualChapterDocxBlob).
async function buildTestDocxBuffer(paragraphs) {
  var zip = new JSZipNode();
  var body = paragraphs.map(function (p) { return "<w:p><w:r><w:t>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</w:t></w:r></w:p>"; }).join("");
  zip.file("word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" + body + "</w:body></w:document>");
  return zip.generateAsync({ type: "nodebuffer" });
}
// Minimaler, aber echter .pptx-Rohbau (ZIP + ppt/slides/slide1.xml) mit
// einem Textrahmen pro uebergebener Zeile.
async function buildTestPptxBuffer(slideLines) {
  var zip = new JSZipNode();
  var paras = slideLines.map(function (l) { return "<a:p><a:r><a:t>" + l.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</a:t></a:r></a:p>"; }).join("");
  zip.file("ppt/slides/slide1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:sp><p:txBody>' + paras + "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>");
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

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);

  // ===================== UI: neue Dateitypen akzeptiert =====================
  const fileInput = doc.getElementById("rovo-md-file-input");
  const acceptAttr = fileInput.getAttribute("accept") || "";
  check("Datei-Input akzeptiert weiterhin .md/.markdown", acceptAttr.includes(".md") && acceptAttr.includes(".markdown"));
  check("Datei-Input akzeptiert .docx/.doc", acceptAttr.includes(".docx") && acceptAttr.includes(".doc"));
  check("Datei-Input akzeptiert .pdf", acceptAttr.includes(".pdf"));
  check("Datei-Input akzeptiert .pptx", acceptAttr.includes(".pptx"));
  check("Hinweistext in der Dropzone nennt die neuen Formate", doc.getElementById("rovo-md-dropzone").textContent.includes(".docx") && doc.getElementById("rovo-md-dropzone").textContent.includes(".pdf") && doc.getElementById("rovo-md-dropzone").textContent.includes(".pptx"));

  function rowCount() { return doc.querySelectorAll("#rovo-entries-tbody tr").length; }
  function rowsText() { return doc.getElementById("rovo-entries-tbody").textContent; }

  // ===================== DOCX-Import (mit "---"-Trenner) =====================
  const docxBuf = await buildTestDocxBuffer(["Chatverlauf-Zeile aus DOCX-Import.", "---", "Antwortzeile aus DOCX-Import."]);
  const docxFile = new win.File([docxBuf], "wissen.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  Object.defineProperty(fileInput, "files", { value: [docxFile], configurable: true });
  fire(fileInput, "change");
  await waitUntil(() => rowCount() === 1, 2000);
  check("DOCX-Import: 1 Eintrag angelegt", rowCount() === 1);
  check("DOCX-Import: Chatverlauf vor dem Trenner übernommen", rowsText().includes("Chatverlauf-Zeile aus DOCX-Import."));
  check("DOCX-Import: Antwort nach dem Trenner übernommen", rowsText().includes("Antwortzeile aus DOCX-Import."));
  const docxRow = doc.querySelector("#rovo-entries-tbody tr");
  check("DOCX-Import: frisch importierte Zeile ist hervorgehoben (rovo-row-new)", docxRow.classList.contains("rovo-row-new"));

  // Eine unabhängige Aktion (Jira-Button existiert hier nicht, da keine
  // Ticketnummer im Text - stattdessen Label hinzufügen) löst ein erneutes
  // Rendern aus - die Hervorhebung darf dabei NICHT erneut erscheinen.
  const addSelectAfterDocx = docxRow.querySelector(".rovo-label-add-select");
  const addableAfterDocx = Array.from(addSelectAfterDocx.options).map((o) => o.value).filter(Boolean)[0];
  addSelectAfterDocx.value = addableAfterDocx;
  fire(addSelectAfterDocx, "change");
  await wait(30);
  check("Hervorhebung verschwindet bei einem späteren, unabhängigen Re-Render", !doc.querySelector("#rovo-entries-tbody tr").classList.contains("rovo-row-new"));

  // ===================== PPTX-Import (ohne Trenner -> alles Chatverlauf) =====================
  const pptxBuf = await buildTestPptxBuffer(["Folientext Zeile 1 aus PPTX-Import.", "Folientext Zeile 2."]);
  const pptxFile = new win.File([pptxBuf], "praesentation.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  Object.defineProperty(fileInput, "files", { value: [pptxFile], configurable: true });
  fire(fileInput, "change");
  await waitUntil(() => rowCount() === 2, 2000);
  check("PPTX-Import: 2. Eintrag angelegt", rowCount() === 2);
  check("PPTX-Import: Folientext übernommen", rowsText().includes("Folientext Zeile 1 aus PPTX-Import."));
  const pptxRow = Array.from(doc.querySelectorAll("#rovo-entries-tbody tr")).find((r) => r.textContent.includes("Folientext Zeile 1"));
  check("PPTX-Import: ohne Trenner landet alles im Chatverlauf (Antwort-Spalte leer)", !!pptxRow && pptxRow.children[2].textContent.trim() === "–");

  // ===================== PDF-Import (mit "---"-Trenner) =====================
  pdfLinesQueue = ["Chatverlauf-Zeile aus PDF-Import.", "---", "Antwortzeile aus PDF-Import."];
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" - Inhalt irrelevant, getDocument ist gemockt
  const pdfFile = new win.File([pdfBytes], "wissen.pdf", { type: "application/pdf" });
  Object.defineProperty(fileInput, "files", { value: [pdfFile], configurable: true });
  fire(fileInput, "change");
  await waitUntil(() => rowCount() === 3, 2000);
  check("PDF-Import: 3. Eintrag angelegt", rowCount() === 3);
  check("PDF-Import: Chatverlauf vor dem Trenner übernommen", rowsText().includes("Chatverlauf-Zeile aus PDF-Import."));
  check("PDF-Import: Antwort nach dem Trenner übernommen", rowsText().includes("Antwortzeile aus PDF-Import."));

  // ===================== Mehrere Dateien gemischter Formate gleichzeitig =====================
  const docxBuf2 = await buildTestDocxBuffer(["Zweite DOCX-Datei im Mehrfach-Upload."]);
  const docxFile2 = new win.File([docxBuf2], "wissen2.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const mdFile = new win.File(["Markdown-Datei im Mehrfach-Upload."], "wissen3.md", { type: "text/markdown" });
  Object.defineProperty(fileInput, "files", { value: [docxFile2, mdFile], configurable: true });
  fire(fileInput, "change");
  await waitUntil(() => rowCount() === 5, 2000);
  check("Mehrfach-Upload (DOCX + MD gemischt): beide Einträge angelegt (jetzt 5 insgesamt)", rowCount() === 5);
  check("Toast meldet 2 importierte Einträge", doc.getElementById("toast").textContent.includes("2 Eintrag"));

  // ===================== Fehlerfall: kaputte DOCX-Datei bricht den Rest nicht ab =====================
  const brokenDocx = new win.File([new Uint8Array([1, 2, 3, 4])], "kaputt.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const goodMdFile = new win.File(["Gültige MD-Datei trotz vorherigem Fehler."], "gut.md", { type: "text/markdown" });
  Object.defineProperty(fileInput, "files", { value: [brokenDocx, goodMdFile], configurable: true });
  fire(fileInput, "change");
  await waitUntil(() => rowCount() === 6, 2000);
  check("Fehlerhafte Datei erzeugt Fehlermeldung statt Absturz", doc.getElementById("toast").textContent.includes("Fehler beim Lesen") || doc.getElementById("log-list").textContent.includes("Import-Fehler"));
  check("Gültige Datei im selben Upload trotzdem importiert (jetzt 6 insgesamt)", rowCount() === 6);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE ROVO-KNOWLEDGE-DATEIFORMAT-IMPORT-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
