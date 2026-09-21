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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
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
async function blobToBuffer(blob) { return Buffer.from(await blob.arrayBuffer()); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Eigenes Ticket mit Domain/Typ/Beschreibung importieren, damit Meta-Zeile
  // (Domäne/Priorität/Labels) in den Entwürfen ueberhaupt etwas zeigt.
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>GEN-1</key><summary>Neues Dealer Feature</summary>
      <description>Betrifft den Market-Bereich.\nZeile 2 der Beschreibung.</description>
      <status>Offen</status><type>Epic</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
        <customfieldvalues><customfieldvalue>Sales</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "gen_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  async function exportAndFind(kind, suffix) {
    savedFiles.length = 0;
    const btn = doc.getElementById(kind + "-download-" + suffix + "-btn");
    if (!btn) return null;
    fire(btn, "click");
    await wait(150);
    return savedFiles[0] || null;
  }

  // ===================== Releaseletter/Benutzerhandbuch/Clickanweisung =====================
  for (const kind of ["releaseletter", "benutzerhandbuch", "clickanweisung"]) {
    doc.querySelector('.nav-item[data-view="' + kind + '"]').click();
    doc.getElementById(kind + "-use-filtered").checked = false;
    doc.getElementById(kind + "-keys").value = "GEN-1";
    fire(doc.getElementById(kind + "-generate-btn"), "click");

    const preview = doc.getElementById(kind + "-preview").textContent;
    if (kind === "clickanweisung") {
      // Clickanweisung ist bewusst KEIN Ticket-Protokoll (siehe renderClickInstructions):
      // Domäne als Gliederungs-Überschrift, aber keine Ticket-Referenzen/Priorität/Labels im Text.
      check("clickanweisung: Vorschau gliedert nach Domäne ('## Sales')", preview.includes("## Sales"));
      check("clickanweisung: Vorschau enthält KEINE Ticket-Referenz (GEN-1)", !preview.includes("GEN-1"));
      check("clickanweisung: Vorschau enthält Beschreibungstext als Klickschritt", preview.includes("Betrifft den Market-Bereich"));
    } else {
      check(kind + ": Vorschau enthält Domäne-Hinweis", preview.includes("Domäne: Sales"));
      check(kind + ": Vorschau enthält Priorität-Punkte (Epic = 5)", preview.includes("Priorität: 5 Punkt"));
      check(kind + ": Vorschau enthält automatisch erkanntes Label 'Dealer' oder 'Market'", preview.includes("Dealer") || preview.includes("Market"));
    }

    // DOCX
    const docxFile = await exportAndFind(kind, "docx");
    check(kind + ": DOCX-Export ausgelöst", !!docxFile);
    if (docxFile) {
      check(kind + ": DOCX-Dateiname endet auf .docx", docxFile.filename.endsWith(".docx"));
      const buf = await blobToBuffer(docxFile.data);
      const zip = await JSZipNode.loadAsync(buf);
      check(kind + ": DOCX enthält word/document.xml", !!zip.file("word/document.xml"));
      const xmlText = await zip.file("word/document.xml").async("string");
      const { DOMParser } = require("@xmldom/xmldom");
      let parseError = false;
      try { new DOMParser({ errorHandler: { warning: () => {}, error: () => { parseError = true; }, fatalError: () => { parseError = true; } } }).parseFromString(xmlText, "text/xml"); } catch (e) { parseError = true; }
      check(kind + ": document.xml ist wohlgeformtes XML", !parseError);
      const mammothResult = await mammoth.extractRawText({ buffer: buf });
      if (kind === "clickanweisung") {
        check("clickanweisung: DOCX enthält KEINE Ticket-Referenz (GEN-1)", !mammothResult.value.includes("GEN-1"));
        check("clickanweisung: DOCX gliedert nach Domäne ('Sales')", mammothResult.value.includes("Sales"));
      } else {
        check(kind + ": DOCX (mammoth-lesbar) enthält GEN-1", mammothResult.value.includes("GEN-1"));
        check(kind + ": DOCX enthält Domäne-Hinweis", mammothResult.value.includes("Sales"));
      }
    }

    // PDF
    const pdfFile = await exportAndFind(kind, "pdf");
    check(kind + ": PDF-Export ausgelöst", !!pdfFile);
    if (pdfFile) {
      check(kind + ": PDF-Dateiname endet auf .pdf", pdfFile.filename.endsWith(".pdf"));
      const buf = await blobToBuffer(pdfFile.data);
      check(kind + ": PDF beginnt mit %PDF-Signatur", buf.slice(0, 4).toString() === "%PDF");
      const parsed = await new PDFParse({ data: buf }).getText();
      if (kind === "clickanweisung") {
        check("clickanweisung: PDF-Text enthält KEINE Ticket-Referenz (GEN-1)", !parsed.text.includes("GEN-1"));
        check("clickanweisung: PDF-Text gliedert nach Domäne ('Sales')", parsed.text.includes("Sales"));
      } else {
        check(kind + ": PDF-Text enthält GEN-1", parsed.text.includes("GEN-1"));
      }
    }

    // XLSX
    const xlsxFile = await exportAndFind(kind, "xlsx");
    check(kind + ": XLSX-Export ausgelöst", !!xlsxFile);
    if (xlsxFile) {
      const buf = await blobToBuffer(xlsxFile.data);
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      check(kind + ": XLSX-Sheet hat Kopfzeile + Datenzeile", json.length >= 2);
      check(kind + ": XLSX-Header enthält 'Priorität (Punkte)'", json[0].includes("Priorität (Punkte)"));
      const dataRow = json[1];
      check(kind + ": XLSX-Datenzeile enthält GEN-1", dataRow.includes("GEN-1"));
    }
  }

  // ===================== Prozessbild: Schritt-Tabelle exportieren =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-use-filtered").checked = false;
  doc.getElementById("prozessbild-keys").value = "GEN-1";
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await wait(100);

  check("Prozessbild: XLSX-Button nach Generieren aktiv", !doc.getElementById("prozessbild-download-xlsx-btn").disabled);
  const pbXlsx = await exportAndFind("prozessbild", "xlsx");
  check("Prozessbild: XLSX-Export ausgelöst", !!pbXlsx);
  if (pbXlsx) {
    const buf = await blobToBuffer(pbXlsx.data);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    check("Prozessbild-XLSX enthält Schritt-Daten mit GEN-1", json.some((row) => row.includes("GEN-1")));
    check("Prozessbild-XLSX-Header enthält Labels-Spalte", json[0].includes("Labels"));
  }

  const pbDocx = await exportAndFind("prozessbild", "docx");
  check("Prozessbild: DOCX-Export ausgelöst", !!pbDocx);
  if (pbDocx) {
    const buf = await blobToBuffer(pbDocx.data);
    const mammothResult = await mammoth.extractRawText({ buffer: buf });
    check("Prozessbild-DOCX enthält GEN-1", mammothResult.value.includes("GEN-1"));
  }

  const pbPdf = await exportAndFind("prozessbild", "pdf");
  check("Prozessbild: PDF-Export ausgelöst", !!pbPdf);
  if (pbPdf) {
    const buf = await blobToBuffer(pbPdf.data);
    check("Prozessbild-PDF beginnt mit %PDF-Signatur", buf.slice(0, 4).toString() === "%PDF");
  }

  // Bild-Download (SVG/Mermaid) funktioniert weiterhin wie zuvor (Regressionscheck)
  const pbImg = await exportAndFind("prozessbild", null) || (function () {
    savedFiles.length = 0;
    fire(doc.getElementById("prozessbild-download-btn"), "click");
    return null;
  })();
  await wait(100);
  check("Prozessbild: klassischer Bild-Download weiterhin ausgelöst", savedFiles.length === 1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE GENERATOR-EXPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
