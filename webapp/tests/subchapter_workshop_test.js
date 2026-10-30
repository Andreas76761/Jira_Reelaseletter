// Neuer Bereich "Unterkapitel" (baut auf EDITO auf, teilt sich
// app.editoVersionKey/app.outline als Quellen): je Unterkapitel Quellen
// aus RAG-Bibliothek/Rovo-Notizen/Bildern/Tabellen anzeigen (gefiltert
// nach .subTitle/.subchapter, Tickets bleiben Kapitel-Ebene), Vorgaben
// (Kurzbeschreibung/Stichwörter/Ausschluss/Formatregeln) eintragen, per
// "Bearbeiten" iterativ erzeugen (vergleicht automatisch mit der
// vorherigen eigenen Fassung, wiederholbar in Loops), je Rolle/Sparte-
// Version unabhängig freigeben (Entwurf/Zur Prüfung/Genehmigt) und
// einzeln oder als Gesamtdokument aller genehmigten Unterkapitel
// exportieren (mit/ohne Bilder). Prüft: Guards, Quellen-Filterung auf
// Unterkapitel-Ebene, Prompt-Inhalt, Diff-Anzeige über 2 Iterationen,
// Status-Freigabe, Einzel-Export mit/ohne Bilder (echte Medien-Prüfung
// im DOCX), Gesamtdokument-Export, Reset bei "Alle Daten löschen".
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
let generationCount = 0;
async function sampleImpl(promptText) {
  sampleCalls.push({ input: promptText });
  generationCount++;
  return {
    text: "Erste Fassung (Version " + generationCount + "): Der Retail ändert den Vertrag über die Maske Vertragsänderung.\n[Bild]\n[Tabelle]",
    truncated: false, modelTierApplied: "default"
  };
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
async function blobToBuffer(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

const KAP7 = "Kapitel 7: Verträge im Alltag verwalten";
const SUB71 = "7.1 Änderungen";

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>SKW-1</key><summary>Vertragsänderung durchführen</summary><description>Der Dealer ändert den Vertrag.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "subchapter_workshop_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Quellen vorbereiten (RAG-Chunk, Rovo+Tabelle, Bild) je Unterkapitel 7.1 =====================
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
  const screenSubSel = doc.querySelector(".editor-screen-subchapter-select");
  screenSubSel.value = SUB71;
  fire(screenSubSel, "change");
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
  const rovoSubSel = doc.querySelector(".rovo-subchapter-select");
  rovoSubSel.value = SUB71;
  fire(rovoSubSel, "change");
  await wait(30);

  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  const tableChapterSel = doc.querySelector(".rovo-table-chapter-select");
  tableChapterSel.value = KAP7;
  fire(tableChapterSel, "change");
  await wait(30);
  const tableSubSel = doc.querySelector(".rovo-table-subchapter-select");
  tableSubSel.value = SUB71;
  fire(tableSubSel, "change");
  await wait(30);

  // RAG-Bibliothek: Eintrag importieren und manuell Kapitel+Unterkapitel zuordnen
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(100);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  const mdFile = new win.File(["# Hinweis\n\nVertragsänderungen können online vorgenommen werden."], "Hinweis.md", { type: "text/markdown" });
  const libraryImportInput = doc.getElementById("rag-library-import-input");
  Object.defineProperty(libraryImportInput, "files", { value: [mdFile], configurable: true });
  fire(libraryImportInput, "change");
  await wait(200);
  const ragChapterSel = doc.querySelector(".rag-library-chapter-select");
  ragChapterSel.value = KAP7;
  fire(ragChapterSel, "change");
  await wait(30);
  const ragSubSel = doc.querySelector(".rag-library-subchapter-select");
  ragSubSel.value = SUB71;
  fire(ragSubSel, "change");
  await wait(30);

  // ===================== Unterkapitel-Werkstatt: Guards =====================
  doc.querySelector('.nav-item[data-view="unterkapitel"]').click();
  await wait(100);
  fire(doc.getElementById("subchapter-edit-btn"), "click");
  await wait(50);
  check("Guard ohne Rolle/Sparte: Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Keine Version"));

  const versionSelect = doc.getElementById("subchapter-version-select");
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(100);
  fire(doc.getElementById("subchapter-edit-btn"), "click");
  await wait(50);
  check("Guard ohne Kapitel/Unterkapitel: Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Kein Unterkapitel"));

  const chapterSelect = doc.getElementById("subchapter-chapter-select");
  chapterSelect.value = KAP7;
  fire(chapterSelect, "change");
  await wait(50);
  const subSelect = doc.getElementById("subchapter-select");
  check("Unterkapitel-Auswahl listet 7.1/7.2/7.3", Array.from(subSelect.options).map((o) => o.value).includes(SUB71));
  subSelect.value = SUB71;
  fire(subSelect, "change");
  await wait(50);

  // ===================== Quellen-Übersicht zeigt die zugeordneten Quellen =====================
  const sourcesText = doc.getElementById("subchapter-sources-output").textContent;
  check("Quellen-Übersicht: 1 Ticket (Kapitel-Ebene)", /1\s*Tickets/.test(sourcesText));
  check("Quellen-Übersicht: 1 RAG-Bibliothek-Eintrag", /1\s*RAG-Bibliothek/.test(sourcesText));
  check("Quellen-Übersicht: 1 Rovo-Notiz", /1\s*Rovo-Notizen/.test(sourcesText));
  check("Quellen-Übersicht: 1 Bild", /1\s*Bilder/.test(sourcesText));
  check("Quellen-Übersicht: 1 Tabelle", /1\s*Tabellen/.test(sourcesText));

  // ===================== Vorgaben eintragen + 1. Erzeugung =====================
  doc.getElementById("subchapter-spec-kurzbeschreibung").value = "Wie ändert man einen bestehenden Vertrag.";
  doc.getElementById("subchapter-spec-keywords").value = "Vertragsänderung, Online";
  doc.getElementById("subchapter-spec-exclude").value = "Kündigung";
  doc.getElementById("subchapter-spec-format").value = "Max. 1 Absatz, Präsens";

  sampleCalls = [];
  fire(doc.getElementById("subchapter-edit-btn"), "click");
  await waitUntil(() => doc.getElementById("subchapter-current-draft-output").textContent.includes("Erste Fassung"), 2000);
  check("1. Erzeugung: sample() einmal aufgerufen", sampleCalls.length === 1);
  check("Prompt enthält die Vorgaben", sampleCalls[0].input.includes("Wie ändert man einen bestehenden Vertrag.") && sampleCalls[0].input.includes("Kündigung"));
  check("Prompt nennt noch keine vorherige Fassung", sampleCalls[0].input.includes("(noch keine vorherige Fassung)"));
  check("Prompt nennt 1 RAG-Eintrag/1 Rovo-Notiz/1 Bild/1 Tabelle", sampleCalls[0].input.includes("QUELLE 4 – RAG-Bibliothek, diesem Unterkapitel zugeordnet (1):") &&
    sampleCalls[0].input.includes("QUELLE 5 – Rovo-Knowledge-Textschnipsel, diesem Unterkapitel zugeordnet, VORRANGIGE Quelle (1):") &&
    sampleCalls[0].input.includes("QUELLE 6 – Zugeordnete Screenshots: 1") &&
    sampleCalls[0].input.includes("QUELLE 7 – Zugeordnete Tabellen: 1"));
  check("Diff-Panel nach 1. Erzeugung noch versteckt (keine Vorversion)", doc.getElementById("subchapter-diff-result").hidden === true);
  check("Diff-Leer-Hinweis sichtbar", doc.getElementById("subchapter-diff-empty-note").hidden === false);
  check("Export-Buttons nach Erzeugung aktiv", doc.getElementById("subchapter-export-docx-btn").disabled === false);

  // ===================== 2. Erzeugung (Loop) -> Diff zur vorherigen Fassung =====================
  sampleCalls = [];
  fire(doc.getElementById("subchapter-edit-btn"), "click");
  await waitUntil(() => doc.getElementById("subchapter-current-draft-output").textContent.includes("Version 2"), 2000);
  check("2. Erzeugung: Prompt enthält jetzt die vorherige Fassung (Version 1)", sampleCalls[0].input.includes("Erste Fassung (Version 1)"));
  check("Diff-Panel nach 2. Erzeugung sichtbar", doc.getElementById("subchapter-diff-result").hidden === false);
  check("Diff zeigt neu hinzugefügten Text", doc.getElementById("subchapter-diff-output").innerHTML.includes("Version 2"));
  check("Diff-Meta nennt beide Zeitpunkte", doc.getElementById("subchapter-diff-meta").textContent.includes("Vergleich:"));

  // ===================== Status-Freigabe =====================
  const statusSelect = doc.getElementById("subchapter-status-select");
  check("Status-Auswahl nach Erzeugung aktiv", statusSelect.disabled === false);
  statusSelect.value = "genehmigt";
  fire(statusSelect, "change");
  await wait(50);
  check("Statuszeile vermerkt Änderung", doc.getElementById("subchapter-status-note").textContent.includes("Zuletzt geändert"));
  check("Übersichtstabelle zeigt genehmigtes Unterkapitel", doc.getElementById("subchapter-overview-tbody").textContent.includes("Genehmigt"));
  check("Gesamtdokument-Hinweis nennt 1 genehmigtes Unterkapitel", doc.getElementById("subchapter-merge-count-note").textContent.includes("1 genehmigte"));

  // ===================== Einzel-Export MIT Bildern (echte Medien-Prüfung) =====================
  let savedBefore = savedFiles.length;
  fire(doc.getElementById("subchapter-export-docx-btn"), "click");
  await wait(100);
  check("Word-Export (mit Bildern) ausgelöst", savedFiles.length === savedBefore + 1);
  const docxWithImages = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer()));
  check("DOCX (mit Bildern) enthält eingebettetes Bild", !!docxWithImages.file("word/media/bild1.png"));
  const docxXmlWithImages = await docxWithImages.file("word/document.xml").async("text");
  check("DOCX (mit Bildern) enthält Titel 'Kapitel 7 – 7.1 Änderungen'", docxXmlWithImages.includes(KAP7) && docxXmlWithImages.includes(SUB71));
  check("DOCX (mit Bildern) enthält die echte Tabelle (w:tbl)", docxXmlWithImages.includes("<w:tbl>"));

  // ===================== Einzel-Export OHNE Bilder =====================
  doc.getElementById("subchapter-export-images-cb").checked = false;
  savedBefore = savedFiles.length;
  fire(doc.getElementById("subchapter-export-docx-btn"), "click");
  await wait(100);
  const docxNoImages = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer()));
  check("DOCX (ohne Bilder) enthält KEIN eingebettetes Bild", !docxNoImages.file("word/media/bild1.png"));
  const docxXmlNoImages = await docxNoImages.file("word/document.xml").async("text");
  check("DOCX (ohne Bilder) enthält weiterhin die Tabelle", docxXmlNoImages.includes("<w:tbl>"));
  check("Dateiname kennzeichnet 'ohne Bilder'", savedFiles[savedFiles.length - 1].filename.includes("ohne_bilder"));
  doc.getElementById("subchapter-export-images-cb").checked = true;

  // ===================== Gesamtdokument der genehmigten Unterkapitel =====================
  fire(doc.getElementById("subchapter-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("subchapter-merge-result").hidden === false, 2000);
  check("Gesamtdokument-Statuszeile nennt 1 Unterkapitel", doc.getElementById("subchapter-merge-status-note").textContent.includes("1 genehmigte"));

  savedBefore = savedFiles.length;
  fire(doc.getElementById("subchapter-merge-download-docx-btn"), "click");
  await wait(100);
  check("Gesamtdokument-Word-Download ausgelöst", savedFiles.length === savedBefore + 1);
  const mergedDocx = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer()));
  const mergedXml = await mergedDocx.file("word/document.xml").async("text");
  check("Gesamtdokument enthält das Unterkapitel", mergedXml.includes(KAP7) && mergedXml.includes(SUB71));
  check("Gesamtdokument enthält ein Deckblatt VOR dem Inhaltsverzeichnis", mergedXml.includes("Unterkapitel-Gesamtdokument") && mergedXml.indexOf("Unterkapitel-Gesamtdokument") < mergedXml.indexOf("Inhaltsverzeichnis"));
  check("Gesamtdokument referenziert eine Fußzeile", mergedXml.includes("w:footerReference"));
  const mergedFooterXml = await mergedDocx.file("word/footer1.xml").async("text");
  check("Gesamtdokument-Fußzeile enthält natives PAGE-Feld", mergedFooterXml.includes("PAGE") && mergedFooterXml.includes("NUMPAGES"));

  savedBefore = savedFiles.length;
  fire(doc.getElementById("subchapter-merge-download-pdf-btn"), "click");
  await wait(100);
  const pdfBuf = await blobToBuffer(savedFiles[savedFiles.length - 1].data);
  check("Gesamtdokument-PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");
  const subPdfParsed = await new PDFParse({ data: pdfBuf }).getText();
  check("Gesamtdokument-PDF-Deckblatt enthält den Dokumenttitel", subPdfParsed.text.includes("Unterkapitel-Gesamtdokument"));
  check("Gesamtdokument-PDF-Fußzeile nennt Seite X von Y", /Seite \d+ von \d+/.test(subPdfParsed.text));
  const subPdfRaw = pdfBuf.toString("latin1");
  check("Gesamtdokument-PDF enthält Lesezeichen", subPdfRaw.includes("/Outlines") && subPdfRaw.includes(SUB71));

  // ===================== Versionswechsel: Übersicht bleibt, Gesamtdokument-Zähler für neue Version auf 0 =====================
  versionSelect.value = "it";
  fire(versionSelect, "change");
  await wait(100);
  check("Nach Versionswechsel: Übersichtstabelle weiterhin mit Eintrag (versionübergreifend gespeichert)", doc.getElementById("subchapter-overview-tbody").textContent.includes(SUB71));
  check("Nach Versionswechsel: Gesamtdokument-Hinweis für neue Version 0 genehmigte Unterkapitel", doc.getElementById("subchapter-merge-count-note").textContent.includes("0 genehmigte"));

  // ===================== "Alle Daten löschen" leert die Unterkapitel-Werkstatt =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="unterkapitel"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Übersicht wieder leer", doc.getElementById("subchapter-overview-empty").hidden === false);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE UNTERKAPITEL-WERKSTATT-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
