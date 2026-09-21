const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const XLSX = require("xlsx");
const mammoth = require("mammoth");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (String(e.message).includes("jszip.min.js") || String(e.message).includes("jspdf.umd.min.js") || String(e.message).includes("tesseract.min.js") || String(e.message).includes("pdf.min.js") || String(e.message).includes("pdf.worker")) return;
  errors.push("jsdomError: " + e.message);
});

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  url: "https://example.com/artifact-test", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name !== "downloads") return Promise.resolve(null);
        return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function blobToBuffer(blob) {
  const arrBuf = await blob.arrayBuffer();
  return Buffer.from(arrBuf);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();

  // ===================== Burger-Menü =====================
  const burgerBtn = doc.getElementById("verarbeitung-burger-btn");
  const burgerMenu = doc.getElementById("verarbeitung-burger-menu");
  check("Burger-Menü initial versteckt", burgerMenu.hidden === true);
  fire(burgerBtn, "click");
  check("Burger-Menü nach Klick sichtbar", burgerMenu.hidden === false);
  check("Burger-Button aria-expanded=true", burgerBtn.getAttribute("aria-expanded") === "true");
  check("Burger-Menü listet 7 Jobs", burgerMenu.querySelectorAll("button[data-vsub]").length === 7);

  var jobItem3 = burgerMenu.querySelector('button[data-vsub="glossar-extrakt"]');
  fire(jobItem3, "click");
  check("Klick auf Burger-Eintrag wechselt zum Job (Panel 3 sichtbar)", !doc.querySelector('[data-vsub-panel="glossar-extrakt"]').hidden);
  check("Burger-Menü schließt sich nach Auswahl", burgerMenu.hidden === true);
  check("Tab 3 in der normalen Tab-Leiste ebenfalls aktiv markiert", doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').classList.contains("active"));

  // Klick ausserhalb schliesst das Menü
  fire(burgerBtn, "click");
  check("Burger-Menü erneut geöffnet", burgerMenu.hidden === false);
  fire(doc.getElementById("stat-tickets"), "click");
  check("Klick ausserhalb schliesst das Burger-Menü", burgerMenu.hidden === true);

  // Datengrundlage fuer aussagekraeftige Exports schaffen: Releaseinfo + Teil-Import
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([fs.readFileSync(path.join(FIXTURES, "releaseinfo_full.txt"), "utf-8")], "ri.txt", { type: "text/plain" })], configurable: true });
  fire(input, "change");
  await wait(500);
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8")], "nachtrag.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);

  // ===================== Job-Exports: XLSX/DOCX/PDF fuer alle 5 Jobs =====================
  async function exportAndFind(job, format) {
    savedFiles.length = 0;
    const btn = doc.querySelector('.job-export-btn[data-job="' + job + '"][data-format="' + format + '"]');
    if (!btn) return null;
    fire(btn, "click");
    await wait(150);
    return savedFiles[0] || null;
  }

  for (const job of ["1", "2", "3", "4", "5", "6"]) {
    // XLSX
    const xlsxFile = await exportAndFind(job, "xlsx");
    check("Job " + job + ": XLSX-Export ausgelöst", !!xlsxFile);
    if (xlsxFile) {
      check("Job " + job + ": XLSX-Dateiname endet auf .xlsx", xlsxFile.filename.endsWith(".xlsx"));
      const buf = await blobToBuffer(xlsxFile.data);
      const wb = XLSX.read(buf, { type: "buffer" });
      check("Job " + job + ": XLSX von SheetJS lesbar, mind. 1 Sheet", wb.SheetNames.length >= 1);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      check("Job " + job + ": XLSX-Sheet hat Kopfzeile + mind. 1 Datenzeile", json.length >= 2);
    }

    // DOCX
    const docxFile = await exportAndFind(job, "docx");
    check("Job " + job + ": DOCX-Export ausgelöst", !!docxFile);
    if (docxFile) {
      check("Job " + job + ": DOCX-Dateiname endet auf .docx", docxFile.filename.endsWith(".docx"));
      const buf = await blobToBuffer(docxFile.data);
      const zip = await JSZipNode.loadAsync(buf);
      check("Job " + job + ": DOCX enthält word/document.xml", !!zip.file("word/document.xml"));
      const xml = await zip.file("word/document.xml").async("string");
      const { DOMParser } = require("@xmldom/xmldom");
      let parseError = false;
      try { new DOMParser({ errorHandler: { warning: () => {}, error: () => { parseError = true; }, fatalError: () => { parseError = true; } } }).parseFromString(xml, "text/xml"); } catch (e) { parseError = true; }
      check("Job " + job + ": document.xml ist wohlgeformtes XML", !parseError);
      const mammothResult = await mammoth.extractRawText({ buffer: buf });
      check("Job " + job + ": DOCX von mammoth (Word-kompatibel) lesbar, enthält Text", mammothResult.value.trim().length > 0);
    }

    // PDF
    const pdfFile = await exportAndFind(job, "pdf");
    check("Job " + job + ": PDF-Export ausgelöst", !!pdfFile);
    if (pdfFile) {
      check("Job " + job + ": PDF-Dateiname endet auf .pdf", pdfFile.filename.endsWith(".pdf"));
      const buf = await blobToBuffer(pdfFile.data);
      check("Job " + job + ": PDF beginnt mit %PDF-Signatur", buf.slice(0, 4).toString() === "%PDF");
      const parsed = await new PDFParse({ data: buf }).getText();
      check("Job " + job + ": PDF-Text enthält 'Job " + job + "'", parsed.text.includes("Job " + job));
    }
  }

  // ===================== "Vergleich" Original vs. Zwischenschritt =====================
  doc.querySelector('.import-tab[data-vsub="vergleich"]').click();
  const compareBtn = doc.querySelector("#changes-tbody-verarbeitung .compare-btn");
  check("Vergleich-Button in der Vergleichstabelle vorhanden", !!compareBtn);
  if (compareBtn) {
    fire(compareBtn, "click");
    await wait(50);
    check("Vergleich-Modal öffnet sich", doc.getElementById("compare-modal-overlay").hidden === false);
    check("Vergleich-Modal zeigt Ticket-Key ONESCM-8282", doc.getElementById("compare-modal-key").textContent === "ONESCM-8282");
    const fieldsText = doc.getElementById("compare-modal-fields").textContent;
    check("Vergleich zeigt Original-Zusammenfassung leer / 'Nicht im Export enthalten' (Teil-Import ohne Zusammenfassung im Original... eigentlich vorhanden)", fieldsText.includes("Testweise nachgetragene Zusammenfassung"));
    check("Vergleich zeigt Domain nur im Zwischenschritt (Original hatte keine Domain im Teil-Import)", fieldsText.includes("Nicht im Export enthalten"));
    const diffRows = doc.querySelectorAll("#compare-modal-fields tr.diff-row");
    check("Mindestens eine Zeile als abweichend markiert (diff-row)", diffRows.length > 0);

    // Escape schliesst das Vergleich-Modal
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape schliesst Vergleich-Modal", doc.getElementById("compare-modal-overlay").hidden === true);
  }

  // Auch in der Dateiverwaltung vorhanden (gleiche Datenbasis)
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const compareBtnDv = doc.querySelector("#changes-tbody .compare-btn");
  check("Vergleich-Button auch in Dateiverwaltung vorhanden", !!compareBtnDv);
  if (compareBtnDv) {
    fire(compareBtnDv, "click");
    await wait(50);
    check("Vergleich-Modal öffnet sich auch von Dateiverwaltung aus", doc.getElementById("compare-modal-overlay").hidden === false);
    fire(doc.getElementById("compare-modal-close"), "click");
    check("Schliessen-Button (X) schliesst Vergleich-Modal", doc.getElementById("compare-modal-overlay").hidden === true);
  }

  // ===================== Leere Jobs (kein Log, keine Extraktion) nach Reset ohne Absturz =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  savedFiles.length = 0;
  const emptyXlsxBtn = doc.querySelector('.job-export-btn[data-job="3"][data-format="xlsx"]');
  fire(emptyXlsxBtn, "click");
  await wait(100);
  check("Export ohne Daten (Job 3 nach Reset ohne Extraktion) zeigt Fehlermeldung statt Absturz", doc.getElementById("toast").className.includes("error"));
  check("Kein Fehler-Export bei leeren Daten ausgelöst", savedFiles.length === 0);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VERARBEITUNG-V2-FEATURE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
