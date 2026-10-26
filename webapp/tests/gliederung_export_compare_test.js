// Register "Gliederung": neue Funktion "Gliederung exportieren & vergleichen"
// (Teil 9d). Prüft: Export der aktuellen Gliederung als eigenes JSON-Format
// (Round-Trip), Hochladen einer (modifizierten) JSON-Gliederung sowie einer
// .docx-Gliederung (Wiederverwendung der Word-Überschriften-Erkennung),
// deterministischer Struktur-Diff (Kapitel nur in der aktuellen bzw. nur in
// der hochgeladenen Gliederung, geänderte Unterkapitel je gemeinsamem
// Kapitel - kein KI-Aufruf nötig), KI-Analyse (sample-Capability) der
// inhaltlichen Bedeutung der Änderungen, Ablehnung nicht unterstützter
// Dateiformate/kaputter JSON-Dateien, Löschen mit Bestätigungsdialog sowie
// Einbindung in Sitzung speichern/laden.
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

var sampleImpl = async function (promptText) {
  return {
    text: "### Neue Themenbereiche\n- Testkapitel NEU ist neu hinzugekommen.\n\n### Entfallene Themenbereiche\n- Keine gefunden.",
    truncated: false, modelTierApplied: "default"
  };
};
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
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
function paragraphXml(styleId, text) {
  var pr = styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : "";
  return "<w:p>" + pr + "<w:r><w:t>" + xmlEsc(text) + "</w:t></w:r></w:p>";
}
async function buildDocxBuffer(bodyXml) {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyXml + "</w:body></w:document>";
  zip.file("word/document.xml", docXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>GL-1</key><summary>Testticket für Sitzung-Export</summary>
    <description>Dummy-Ticket, nur damit der Sitzung-Export nicht wegen 0 Tickets blockiert.</description>
    <status>Offen</status><type>Task</type></item>
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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "gl_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(100);

  check("Export-Button vorhanden", !!doc.getElementById("outline-export-btn"));
  check("Upload-Dropzone vorhanden", !!doc.getElementById("outline-compare-dropzone"));
  check("Leer-Hinweis anfangs sichtbar (noch keine Gliederung hochgeladen)", doc.getElementById("outline-uploaded-empty").hidden === false);
  check("Tabelle anfangs versteckt", doc.getElementById("outline-uploaded-table-wrap").hidden === true);
  check("Vergleichs-Ergebnis anfangs versteckt", doc.getElementById("outline-compare-result").hidden === true);

  // ===================== Export der aktuellen Gliederung =====================
  const savedBefore = savedFiles.length;
  fire(doc.getElementById("outline-export-btn"), "click");
  await wait(100);
  check("Export ausgelöst (neue Datei gespeichert)", savedFiles.length === savedBefore + 1);
  const exportFile = savedFiles[savedBefore];
  check("Exportierte Datei endet auf .json", (exportFile.filename || "").endsWith(".json"));
  const exportedPayload = JSON.parse(exportFile.data);
  check("Export enthält Feld „outline“ mit mind. 1 Kapitel", Array.isArray(exportedPayload.outline) && exportedPayload.outline.length > 0);

  // ===================== Modifizierte Gliederung (JSON) hochladen und vergleichen =====================
  var modified = JSON.parse(JSON.stringify(exportedPayload));
  var removedChapter = modified.outline[modified.outline.length - 1];
  modified.outline = modified.outline.slice(0, modified.outline.length - 1);
  modified.outline.push({ title: "Testkapitel NEU", subs: [{ title: "Test-Unterkapitel NEU" }] });
  var firstChapter = modified.outline[0];
  var removedSubTitle = null;
  if (firstChapter.subs && firstChapter.subs.length) {
    removedSubTitle = firstChapter.subs[0].title;
    firstChapter.subs = firstChapter.subs.slice(1);
  }
  firstChapter.subs = (firstChapter.subs || []).concat([{ title: "Neues Test-Unterkapitel" }]);

  const jsonInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(jsonInput, "files", { value: [new win.File([JSON.stringify(modified)], "gliederung_modifiziert.json", { type: "application/json" })], configurable: true });
  fire(jsonInput, "change");
  await wait(150);

  check("Hochgeladene Gliederung erscheint in der Übersicht (1 Eintrag)", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 1);
  check("Leer-Hinweis nach Upload ausgeblendet", doc.getElementById("outline-uploaded-empty").hidden === true);
  const uploadedRowText = doc.getElementById("outline-uploaded-tbody").textContent;
  check("Dateiname in der Übersicht sichtbar", uploadedRowText.includes("gliederung_modifiziert.json"));
  check("Kapitelanzahl der hochgeladenen Gliederung korrekt", uploadedRowText.includes(String(modified.outline.length)));

  const compareBtn = doc.querySelector(".outline-compare-run-btn");
  fire(compareBtn, "click");
  await wait(300);

  check("Vergleichs-Ergebnis nach „Vergleichen“ sichtbar", doc.getElementById("outline-compare-result").hidden === false);
  check("Vergleichs-Titel nennt den Dateinamen", doc.getElementById("outline-compare-title").textContent.includes("gliederung_modifiziert.json"));
  check("„Nur in aktueller Gliederung“ nennt das entfernte Kapitel", doc.getElementById("outline-compare-only-current").textContent.includes(removedChapter.title));
  check("„Nur in hochgeladener Gliederung“ nennt „Testkapitel NEU“", doc.getElementById("outline-compare-only-uploaded").textContent.includes("Testkapitel NEU"));
  const subChangesText = doc.getElementById("outline-compare-sub-changes").textContent;
  check("Geänderte Unterkapitel nennen das betroffene Kapitel", subChangesText.includes(firstChapter.title));
  check("Geänderte Unterkapitel nennen das neue Unterkapitel", subChangesText.includes("Neues Test-Unterkapitel"));
  if (removedSubTitle) check("Geänderte Unterkapitel nennen das entfallene Unterkapitel", subChangesText.includes(removedSubTitle));
  check("KI-Analyse zeigt die (gemockte) Einschätzung", doc.getElementById("outline-compare-analysis-output").textContent.includes("Testkapitel NEU ist neu hinzugekommen"));

  // ===================== .docx-Gliederung hochladen (alternatives Format) =====================
  var docxBody = paragraphXml("Heading1", "Docx-Kapitel Eins") +
    paragraphXml("Heading2", "Docx-Unterkapitel A") +
    paragraphXml("Heading1", "Docx-Kapitel Zwei");
  var docxBuf = await buildDocxBuffer(docxBody);
  const docxInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(docxInput, "files", { value: [new win.File([docxBuf], "fremde_gliederung.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })], configurable: true });
  fire(docxInput, "change");
  await wait(300);

  check("Nach .docx-Upload: 2 hochgeladene Gliederungen in der Übersicht", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);
  const docxRow = Array.from(doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("fremde_gliederung.docx"));
  check("Aus .docx 2 Kapitel erkannt", !!docxRow && docxRow.children[2].textContent.trim() === "2");

  // ===================== Nicht unterstütztes Format =====================
  const badInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(badInput, "files", { value: [new win.File(["Ein beliebiger Text."], "gliederung.txt", { type: "text/plain" })], configurable: true });
  fire(badInput, "change");
  await wait(100);
  check("Nicht unterstütztes Format zeigt verständlichen Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Format nicht unterstützt"));
  check("Nach abgelehntem Format weiterhin 2 Einträge (kein Geister-Eintrag)", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);

  // ===================== Kaputte JSON-Datei =====================
  const brokenInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(brokenInput, "files", { value: [new win.File(["{ das ist kein gueltiges JSON"], "kaputt.json", { type: "application/json" })], configurable: true });
  fire(brokenInput, "change");
  await wait(100);
  check("Kaputte JSON-Datei zeigt Fehler-Toast statt Absturz", doc.getElementById("toast").textContent.includes("fehlgeschlagen"));
  check("Nach kaputter Datei weiterhin 2 Einträge", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);

  // ===================== Löschen mit Bestätigungsdialog =====================
  const firstDeleteBtn = doc.querySelector(".outline-compare-delete-btn");
  fire(firstDeleteBtn, "click");
  await confirmViaModal(doc);
  check("Nach Löschen: nur noch 1 hochgeladene Gliederung", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 1);

  // ===================== Sitzung speichern/laden =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const sessionSavedBefore = savedFiles.length;
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(100);
  const sessionJson = savedFiles[sessionSavedBefore].data;
  const sessionData = JSON.parse(sessionJson);
  check("Gesicherte Sitzung enthält uploadedOutlines (1 Eintrag)", Array.isArray(sessionData.uploadedOutlines) && sessionData.uploadedOutlines.length === 1);

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  check("Nach „Alle Daten löschen“: 0 hochgeladene Gliederungen", doc.getElementById("outline-uploaded-empty").hidden === false);

  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "sitzung.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(200);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  check("Nach Sitzung-Laden: hochgeladene Gliederung wiederhergestellt", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 1);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE GLIEDERUNG-EXPORT-VERGLEICH-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
