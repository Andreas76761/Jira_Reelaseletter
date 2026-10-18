// Editor (Teil "Editor"): neuer Nav-Bereich zum Hochladen von Word-/
// PowerPoint-Dateien mit Screens je Domäne (Überschrift + Bildschirmfoto -
// auch Exporte der separaten Screenrecorder-App, die laut Nutzerangabe
// ebenfalls Word/PowerPoint liefert). Prüft: Datei-Upload (.docx/.pptx),
// automatische Bild+Bildtext-Extraktion (Überschrift bzw. Folientitel als
// Bildtext, Bildnummer = Reihenfolge im Dokument), Übernahme der gewählten
// Domäne, Datei-Übersichtstabelle (Typ/Status/Screens-Anzahl), gemeinsame
// Datenstruktur mit "Bilder" (Screens erscheinen dort automatisch mit),
// Löschen einer Datei entfernt auch ihre Screens, Fehlerbehandlung bei
// kaputten Dateien, KI-Vorschlag für die Kapitel-Zuordnung (überschreibt nie
// ein bereits gesetztes Kapitel) sowie die manuelle Korrektur per Dropdown.
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

// Claude liest aus dem Prompt die angebotene Kapitelliste und schlägt immer
// den ERSTEN dort aufgeführten Titel vor - robust gegenüber der tatsächlich
// hinterlegten Gliederung (keine Kopplung an konkrete Kapitelnamen).
function sampleImplFactory() {
  return async function (promptText) {
    var m = /Verfügbare Gliederungskapitel[^\n]*\n((?:- .+\n?)+)/.exec(promptText || "");
    var firstChapter = "";
    if (m) {
      var firstLine = m[1].split("\n")[0];
      firstChapter = firstLine.replace(/^- /, "").trim();
    }
    return { text: "Kapitel: " + (firstChapter || "keines"), truncated: false, modelTierApplied: "default" };
  };
}
let sampleImpl = sampleImplFactory();
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
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

// Kleines, echtes PNG (dieselbe Fixture wie bilder_upload_test.js), genügt
// als Bilddatei für die Extraktion.
const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

async function buildDocxWithScreens() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fahrzeug anlegen</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Vertrag speichern</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>' +
    "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>' +
    "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/media/image1.png", PNG_1X1);
  zip.file("word/media/image2.png", PNG_1X1);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildPptxWithScreens() {
  var zip = new JSZipNode();
  zip.file("ppt/presentation.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  function slideXml(titleText) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>' +
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>' + titleText + '</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>' +
      "</p:spTree></p:cSld></p:sld>";
  }
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
    "</Relationships>";
  zip.file("ppt/slides/slide1.xml", slideXml("Status prüfen"));
  zip.file("ppt/slides/slide2.xml", slideXml("Bericht exportieren"));
  zip.file("ppt/slides/_rels/slide1.xml.rels", relsXml);
  zip.file("ppt/slides/_rels/slide2.xml.rels", relsXml);
  zip.file("ppt/media/image1.png", PNG_1X1);
  return zip.generateAsync({ type: "nodebuffer" });
}

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>ED-1</key><summary>Servicevertrag im Alltag ändern</summary>
    <description>Der Dealer ändert einen bestehenden Vertrag.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "editor_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);

  const domainSelect = doc.getElementById("editor-domain-select");
  check("Domänen-Auswahl enthält aus dem Import übernommene Domäne „Contract Management“",
    Array.from(domainSelect.options).some((o) => o.value === "Contract Management"));

  // ===================== DOCX hochladen =====================
  domainSelect.value = "Contract Management";
  const docxBuf = await buildDocxWithScreens();
  const editorInput = doc.getElementById("editor-file-input");
  Object.defineProperty(editorInput, "files", { value: [new win.File([docxBuf], "screens_vertrag.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })], configurable: true });
  fire(editorInput, "change");
  await wait(600);

  check("Datei-Übersicht zeigt 1 Datei", doc.getElementById("editor-files-count").textContent === "1");
  const docxRow = doc.getElementById("editor-files-tbody").textContent;
  check("Datei-Übersicht: Dateiname sichtbar", docxRow.includes("screens_vertrag.docx"));
  check("Datei-Übersicht: Typ „Word“ erkannt", docxRow.includes("Word"));
  check("Datei-Übersicht: Status „Verarbeitet“", docxRow.includes("Verarbeitet"));
  check("Datei-Übersicht: 2 Screens gezählt", /\b2\b/.test(doc.getElementById("editor-files-tbody").querySelector("tr").children[4].textContent));

  check("Screens-Übersicht zeigt 2 Screens nach DOCX-Upload", doc.getElementById("editor-screens-count").textContent === "2");
  const screensTbodyText = doc.getElementById("editor-screens-tbody").textContent;
  check("Bildtext „Fahrzeug anlegen“ (Überschrift vor dem ersten Bild) übernommen", screensTbodyText.includes("Fahrzeug anlegen"));
  check("Bildtext „Vertrag speichern“ (Überschrift vor dem zweiten Bild) übernommen", screensTbodyText.includes("Vertrag speichern"));
  check("Domäne „Contract Management“ bei beiden Screens übernommen", (screensTbodyText.match(/Contract Management/g) || []).length === 2);
  const docxScreenRows = Array.from(doc.getElementById("editor-screens-tbody").querySelectorAll("tr"));
  check("Bildnummern 1 und 2 vergeben (Reihenfolge im Dokument)",
    docxScreenRows[0].children[1].textContent.trim() === "1" && docxScreenRows[1].children[1].textContent.trim() === "2");
  check("Kapitel-Dropdown je Screen zunächst „Ohne Kapitel“ (leer)",
    docxScreenRows.every((r) => r.querySelector(".editor-screen-chapter-select").value === ""));

  // ===================== Gemeinsame Datenstruktur mit "Bilder" =====================
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);
  const bilderDescriptions = Array.from(doc.getElementById("images-tbody").querySelectorAll(".image-description-input")).map((i) => i.value);
  check("Screens erscheinen automatisch auch unter „Bilder“ (gemeinsame Datenstruktur)",
    bilderDescriptions.includes("Fahrzeug anlegen") && bilderDescriptions.includes("Vertrag speichern"));
  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);

  // ===================== PPTX hochladen (andere/keine Domäne) =====================
  domainSelect.value = "";
  const pptxBuf = await buildPptxWithScreens();
  const editorInput2 = doc.getElementById("editor-file-input");
  Object.defineProperty(editorInput2, "files", { value: [new win.File([pptxBuf], "screens_recorder_export.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })], configurable: true });
  fire(editorInput2, "change");
  await wait(600);

  check("Datei-Übersicht zeigt jetzt 2 Dateien", doc.getElementById("editor-files-count").textContent === "2");
  const filesText = doc.getElementById("editor-files-tbody").textContent;
  check("PowerPoint-Datei (z. B. Screenrecorder-Export) als „PowerPoint“ erkannt", filesText.includes("PowerPoint"));
  check("Screens-Übersicht zeigt jetzt 4 Screens (2 DOCX + 2 PPTX)", doc.getElementById("editor-screens-count").textContent === "4");
  const screensText2 = doc.getElementById("editor-screens-tbody").textContent;
  check("Folientitel „Status prüfen“ als Bildtext übernommen", screensText2.includes("Status prüfen"));
  check("Folientitel „Bericht exportieren“ als Bildtext übernommen", screensText2.includes("Bericht exportieren"));

  // ===================== Manuelle Kapitel-Korrektur per Dropdown =====================
  const chapterOptions = Array.from(doc.querySelector(".editor-screen-chapter-select").options).map((o) => o.value).filter(Boolean);
  check("Kapitel-Dropdown bietet die tatsächliche Gliederung zur Auswahl an", chapterOptions.length > 0);
  const firstScreenSelect = doc.querySelector(".editor-screen-chapter-select");
  const manualChapterChoice = chapterOptions[0];
  firstScreenSelect.value = manualChapterChoice;
  fire(firstScreenSelect, "change");
  await wait(30);
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(30);
  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(30);
  check("Manuell gesetztes Kapitel bleibt nach Re-Render erhalten (Modell, nicht nur DOM)",
    doc.querySelector(".editor-screen-chapter-select").value === manualChapterChoice);

  // ===================== KI-Vorschlag für Kapitel-Zuordnung =====================
  fire(doc.getElementById("editor-ai-assign-btn"), "click");
  await wait(400);
  const chapterSelectsAfterAi = Array.from(doc.querySelectorAll(".editor-screen-chapter-select"));
  check("KI-Vorschlag: bereits manuell zugeordneter Screen bleibt unverändert (wird nie überschrieben)",
    chapterSelectsAfterAi[0].value === manualChapterChoice);
  check("KI-Vorschlag: alle vorher leeren Screens haben jetzt ein Kapitel erhalten",
    chapterSelectsAfterAi.every((s) => s.value !== ""));
  check("KI-Vorschlag-Status vermerkt abgeschlossenen Lauf", /zugeordnet/.test(doc.getElementById("editor-ai-status-note").textContent));

  fire(doc.getElementById("editor-ai-assign-btn"), "click");
  await wait(100);
  check("Erneuter KI-Vorschlag ohne offene Screens meldet „Nichts zu tun“", doc.getElementById("toast").textContent.includes("Alle Screens haben bereits ein Kapitel"));

  // ===================== Datei löschen entfernt auch ihre Screens =====================
  const docxFileRow = Array.from(doc.getElementById("editor-files-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("screens_vertrag.docx"));
  const docxDeleteBtn = docxFileRow.querySelector("[data-editor-file-delete]");
  fire(docxDeleteBtn, "click");
  await wait(50);
  check("Nach Löschen der DOCX-Datei: nur noch 1 Datei in der Übersicht", doc.getElementById("editor-files-count").textContent === "1");
  check("Nach Löschen der DOCX-Datei: nur noch 2 Screens (die der PPTX bleiben erhalten)", doc.getElementById("editor-screens-count").textContent === "2");
  check("Gelöschte Screens verschwinden auch aus „Bilder“", !doc.getElementById("gallery").innerHTML.includes("screens_vertrag"));

  // ===================== Fehlerbehandlung bei kaputter Datei =====================
  const editorInput3 = doc.getElementById("editor-file-input");
  Object.defineProperty(editorInput3, "files", { value: [new win.File(["Das ist keine echte Word-Datei."], "kaputt.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })], configurable: true });
  fire(editorInput3, "change");
  await wait(300);
  check("Kaputte Datei: Übersicht zeigt jetzt 2 Dateien", doc.getElementById("editor-files-count").textContent === "2");
  check("Kaputte Datei: Status meldet einen Fehler statt stillem Abbruch", doc.getElementById("editor-files-tbody").textContent.includes("Fehler"));
  check("Kaputte Datei: Screens-Anzahl bleibt bei 2 (keine Geister-Screens)", doc.getElementById("editor-screens-count").textContent === "2");

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE EDITOR-SCREENS-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
