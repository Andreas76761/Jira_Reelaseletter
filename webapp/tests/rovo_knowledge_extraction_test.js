// Rovo Knowledge: zusätzlich zum Text werden aus importierten .docx-/.pptx-
// Dateien automatisch enthaltene BILDER (landen im bestehenden Register
// "Bilder", dieselbe Datenstruktur wie beim Screens-Import) und TABELLEN
// (landen im neuen eigenständigen Register "Tabelle" mit Quellverweis auf
// Dateiname + Tabellen-Nr. im Quelldokument sowie zuweisbarem Kapitel/
// Unterkapitel) extrahiert. Aus .md-Dateien werden einfache Markdown-Pipe-
// Tabellen uebernommen (keine Bilder, da .md keine echten eingebetteten
// Bilder referenzieren kann). Prüft: Extraktion aus DOCX (Bild + Tabelle),
// aus PPTX (Bild + Tabelle), aus MD (nur Tabelle), Quellverweis/Kapitel-
// Zuordnung im neuen Register, Session-Persistenz (Rundlauf), Löschen
// einer Tabelle, Reset bei "Alle Daten löschen".
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|Could not load script/i)) errors.push(e.message); });

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
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

// Kleines, echtes PNG (dieselbe Fixture wie editor_screens_test.js).
const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

// .docx mit: Chatverlauf-Absatz, "---"-Trenner, Antwort-Absatz, einer
// 2x2-Tabelle und einem eingebetteten Bild (gleiche Rels/Media-Struktur wie
// editor_screens_test.js, dort bereits gegen die App-eigene Extraktion
// verifiziert).
async function buildDocxWithTableAndImage() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' +
    "<w:p><w:r><w:t>Chatverlauf: Welche Felder hat die Vertragstabelle?</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>---</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Antwort: Siehe untenstehende Tabelle.</w:t></w:r></w:p>" +
    "<w:tbl>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pflicht</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>Vertragsnummer</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ja</w:t></w:r></w:p></w:tc></w:tr>" +
    "</w:tbl>" +
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

// .pptx mit: Folientitel als Chatverlauf-Quelle, einer Tabelle (a:tbl) und
// einem eingebetteten Bild - ohne "---"-Trenner (gesamter Text landet laut
// bestehendem Verhalten im Chatverlauf).
async function buildPptxWithTableAndImage() {
  var zip = new JSZipNode();
  zip.file("ppt/presentation.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  var slideXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Rollout-Status</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<a:tbl>' +
    '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Phase</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Status</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
    '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Pilot</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Abgeschlossen</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
    '</a:tbl>' +
    '<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>' +
    "</p:spTree></p:cSld></p:sld>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
    "</Relationships>";
  zip.file("ppt/slides/slide1.xml", slideXml);
  zip.file("ppt/slides/_rels/slide1.xml.rels", relsXml);
  zip.file("ppt/media/image1.png", PNG_1X1);
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

  // Minimaler Ticket-Import, damit der Sitzung-Export (s. u.) nicht wegen
  // "0 Tickets, 0 Imports" blockiert (Guard existiert unabhängig von Rovo
  // Knowledge für alle Register, vgl. rovo_knowledge_test.js).
  doc.querySelector('.nav-item[data-view="import"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "rovo_extract_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);

  function rovoRowCount() { return doc.querySelectorAll("#rovo-entries-tbody tr").length; }

  // ===================== DOCX: Bild + Tabelle =====================
  const docxBuf = await buildDocxWithTableAndImage();
  const docxFile = new win.File([docxBuf], "wissen.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const fileInput = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(fileInput, "files", { value: [docxFile], configurable: true });
  fire(fileInput, "change");
  await wait(500);

  check("DOCX-Import: Rovo-Eintrag angelegt", rovoRowCount() === 1);
  check("DOCX-Import: Toast nennt extrahierte Bilder/Tabellen", doc.getElementById("toast").textContent.includes("1 Bild") && doc.getElementById("toast").textContent.includes("1 Tabelle"));

  // Bild im Register "Bilder"
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);
  const galleryHtmlAfterDocx = doc.getElementById("gallery").innerHTML;
  check("DOCX-Bild landet im Register Bilder (Quelldatei im Dateinamen)", galleryHtmlAfterDocx.includes("wissen.docx"));
  check("DOCX-Bild: genau 1 hochgeladenes Bild", doc.querySelectorAll("#gallery .uploaded-image-card").length === 1);

  // Tabelle im neuen Register "Tabelle"
  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Tabelle-Register: 1 extrahierte Tabelle", doc.getElementById("rovo-tables-count").textContent === "1");
  check("Tabelle-Register: Leer-Hinweis ausgeblendet", doc.getElementById("rovo-tables-empty").hidden === true);
  const tablesListHtml = doc.getElementById("rovo-tables-list").innerHTML;
  check("Tabelle-Register: Quellverweis nennt Dateiname", tablesListHtml.includes("wissen.docx"));
  check("Tabelle-Register: Quellverweis nennt Tabellen-Nr. 1", tablesListHtml.includes("Tabelle 1"));
  check("Tabelle-Register: Zellinhalt „Feld“ übernommen", tablesListHtml.includes("Feld"));
  check("Tabelle-Register: Zellinhalt „Vertragsnummer“ übernommen", tablesListHtml.includes("Vertragsnummer"));
  check("Tabelle-Register: Zellinhalt „Ja“ übernommen", tablesListHtml.includes(">Ja<"));
  check("Tabelle-Register: Kapitel-Dropdown vorhanden", doc.querySelector(".rovo-table-chapter-select") !== null);
  check("Tabelle-Register: Unterkapitel-Dropdown initial deaktiviert (kein Kapitel gesetzt)", doc.querySelector(".rovo-table-subchapter-select").disabled === true);

  // Kapitel zuordnen
  const chapterSelect1 = doc.querySelector(".rovo-table-chapter-select");
  const chapterValue1 = chapterSelect1.options[1] ? chapterSelect1.options[1].value : "";
  if (chapterValue1) {
    chapterSelect1.value = chapterValue1;
    fire(chapterSelect1, "change");
    await wait(50);
  }
  check("Tabelle-Register: nach Kapitel-Zuordnung Unterkapitel-Dropdown aktiv", chapterValue1 ? doc.querySelector(".rovo-table-subchapter-select").disabled === false : true);

  // ===================== PPTX: Bild + Tabelle (ohne Trenner) =====================
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  const pptxBuf = await buildPptxWithTableAndImage();
  const pptxFile = new win.File([pptxBuf], "rollout.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  const fileInput2 = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(fileInput2, "files", { value: [pptxFile], configurable: true });
  fire(fileInput2, "change");
  await wait(500);

  check("PPTX-Import: 2. Rovo-Eintrag angelegt", rovoRowCount() === 2);

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);
  check("PPTX-Bild landet zusätzlich im Register Bilder (jetzt 2 Bilder)", doc.querySelectorAll("#gallery .uploaded-image-card").length === 2);

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Tabelle-Register: jetzt 2 extrahierte Tabellen", doc.getElementById("rovo-tables-count").textContent === "2");
  const tablesListHtml2 = doc.getElementById("rovo-tables-list").innerHTML;
  check("PPTX-Tabelle: Quellverweis nennt Dateiname", tablesListHtml2.includes("rollout.pptx"));
  check("PPTX-Tabelle: Zellinhalt „Phase“ übernommen", tablesListHtml2.includes("Phase"));
  check("PPTX-Tabelle: Zellinhalt „Abgeschlossen“ übernommen", tablesListHtml2.includes("Abgeschlossen"));

  // ===================== MD: nur Tabelle (keine Bilder) =====================
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  const mdText =
    "Chatverlauf: Welche Status gibt es?\n---\nAntwort:\n\n" +
    "| Status | Bedeutung |\n| --- | --- |\n| Offen | Noch nicht gestartet |\n| Erledigt | Abgeschlossen |\n";
  const mdFile = new win.File([mdText], "status.md", { type: "text/markdown" });
  const fileInput3 = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(fileInput3, "files", { value: [mdFile], configurable: true });
  fire(fileInput3, "change");
  await wait(500);

  check("MD-Import: 3. Rovo-Eintrag angelegt", rovoRowCount() === 3);

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);
  check("MD-Import erzeugt KEIN zusätzliches Bild (weiterhin 2)", doc.querySelectorAll("#gallery .uploaded-image-card").length === 2);

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Tabelle-Register: jetzt 3 extrahierte Tabellen (MD-Pipe-Tabelle übernommen)", doc.getElementById("rovo-tables-count").textContent === "3");
  const tablesListHtml3 = doc.getElementById("rovo-tables-list").innerHTML;
  check("MD-Tabelle: Quellverweis nennt Dateiname", tablesListHtml3.includes("status.md"));
  check("MD-Tabelle: Kopfzeile „Bedeutung“ übernommen", tablesListHtml3.includes("Bedeutung"));
  check("MD-Tabelle: Zelle „Noch nicht gestartet“ übernommen", tablesListHtml3.includes("Noch nicht gestartet"));

  // ===================== Session speichern/laden (Rundlauf) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(150);
  check("Sitzung-Export ausgelöst", savedFiles.some((f) => (f.filename || "").endsWith(".json")));
  const sessionJson = savedFiles.filter((f) => (f.filename || "").endsWith(".json")).pop().data;
  const sessionData = JSON.parse(sessionJson);
  check("Gesicherte Sitzung enthält rovoTables (3 Tabellen)", Array.isArray(sessionData.rovoTables) && sessionData.rovoTables.length === 3);
  check("Gesicherte Sitzung: Tabellen-Quellverweise korrekt", sessionData.rovoTables.map((t) => t.sourceFile).sort().join(",") === "rollout.pptx,status.md,wissen.docx");

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "sitzung.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(150);

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Nach Sitzung-Laden: 3 Tabellen wiederhergestellt", doc.getElementById("rovo-tables-count").textContent === "3");
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);
  check("Nach Sitzung-Laden: 2 extrahierte Bilder wiederhergestellt", doc.querySelectorAll("#gallery .uploaded-image-card").length === 2);

  // ===================== Löschen einer Tabelle =====================
  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  const delBtn = doc.querySelector("[data-rovo-table-delete]");
  check("Löschen-Button für eine Tabelle vorhanden", delBtn !== null);
  if (delBtn) { fire(delBtn, "click"); await wait(100); }
  check("Nach Löschen einer Tabelle: nur noch 2 übrig", doc.getElementById("rovo-tables-count").textContent === "2");

  // ===================== Druckbare DIN-A4-Exporte (PDF/Word) =====================
  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  const orientSelects = doc.querySelectorAll(".rovo-table-orientation-select");
  check("Seitenformat-Vorschlag für 2-spaltige Tabellen: Hochformat (beide verbliebenen Tabellen)",
    orientSelects.length === 2 && Array.from(orientSelects).every((s) => s.value === "portrait"));

  // Karten-Reihenfolge (neueste zuerst, s. unshift): [0] = rollout.pptx, [1] = wissen.docx.
  const pdfBtnRollout = doc.querySelectorAll("[data-rovo-table-pdf]")[0];
  const savedBeforePdf = savedFiles.length;
  fire(pdfBtnRollout, "click");
  await wait(150);
  check("PDF-Export (Hochformat) ausgelöst", savedFiles.length === savedBeforePdf + 1);
  const pdfFilePortrait = savedFiles[savedBeforePdf];
  check("PDF-Dateiname entspricht Quelle + Tabellen-Nr.", pdfFilePortrait.filename === "rollout_tabelle1.pdf");
  check("PDF-Datei ist nicht leer", pdfFilePortrait.data && pdfFilePortrait.data.size > 0);
  check("Protokoll vermerkt druckbares PDF (Hochformat)", doc.getElementById("log-list").textContent.includes("druckbares PDF (Hochformat)"));

  // Seitenformat auf Querformat umstellen und erneut als PDF exportieren.
  orientSelects[0].value = "landscape";
  fire(orientSelects[0], "change");
  await wait(50);
  const savedBeforePdf2 = savedFiles.length;
  fire(doc.querySelectorAll("[data-rovo-table-pdf]")[0], "click");
  await wait(150);
  check("PDF-Export (Querformat) ausgelöst", savedFiles.length === savedBeforePdf2 + 1);
  check("Protokoll vermerkt druckbares PDF (Querformat)", doc.getElementById("log-list").textContent.includes("druckbares PDF (Querformat)"));

  // Word-Export der zweiten Tabelle (wissen.docx) in Hochformat, dann Inhalt
  // über JSZip zurücklesen - prüft sowohl Zellinhalt als auch Seitenformat.
  const docxBtnWissen = doc.querySelectorAll("[data-rovo-table-docx]")[1];
  const savedBeforeDocx = savedFiles.length;
  fire(docxBtnWissen, "click");
  await wait(150);
  check("Word-Export (Hochformat) ausgelöst", savedFiles.length === savedBeforeDocx + 1);
  const docxFilePortrait = savedFiles[savedBeforeDocx];
  check("Word-Dateiname entspricht Quelle + Tabellen-Nr.", docxFilePortrait.filename === "wissen_tabelle1.docx");
  const docxZipPortrait = await JSZipNode.loadAsync(Buffer.from(await docxFilePortrait.data.arrayBuffer()));
  const docxXmlPortrait = await docxZipPortrait.file("word/document.xml").async("string");
  check("Word-Export enthält Quellverweis (Caption)", docxXmlPortrait.includes("Quelle: wissen.docx"));
  check("Word-Export enthält Zellinhalt „Vertragsnummer“", docxXmlPortrait.includes("Vertragsnummer"));
  check("Word-Export: Hochformat-Seitengröße (w=11906, kein landscape)", docxXmlPortrait.includes('w:pgSz w:w="11906" w:h="16838"') && !docxXmlPortrait.includes("landscape"));
  check("Word-Export: Tabellenlayout fest (Breiten werden nicht automatisch neu verteilt)", docxXmlPortrait.includes('w:tblLayout w:type="fixed"'));

  // Dieselbe Tabelle auf Querformat umstellen und erneut exportieren.
  doc.querySelectorAll(".rovo-table-orientation-select")[1].value = "landscape";
  fire(doc.querySelectorAll(".rovo-table-orientation-select")[1], "change");
  await wait(50);
  const savedBeforeDocx2 = savedFiles.length;
  fire(doc.querySelectorAll("[data-rovo-table-docx]")[1], "click");
  await wait(150);
  const docxFileLandscape = savedFiles[savedBeforeDocx2];
  const docxZipLandscape = await JSZipNode.loadAsync(Buffer.from(await docxFileLandscape.data.arrayBuffer()));
  const docxXmlLandscape = await docxZipLandscape.file("word/document.xml").async("string");
  check("Word-Export: Querformat-Seitengröße (w=16838, orient=landscape)", docxXmlLandscape.includes('w:pgSz w:w="16838" w:h="11906" w:orient="landscape"'));
  check("Protokoll vermerkt druckbares Word-Dokument (Querformat)", doc.getElementById("log-list").textContent.includes("druckbares Word-Dokument (Querformat)"));

  // ===================== Reset =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  check("Nach „Alle Daten löschen“: 0 extrahierte Tabellen", doc.getElementById("rovo-tables-count").textContent === "0");
  check("Nach „Alle Daten löschen“: Leer-Hinweis wieder sichtbar", doc.getElementById("rovo-tables-empty").hidden === false);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE ROVO-KNOWLEDGE-EXTRAKTIONS-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
