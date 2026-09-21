const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/i)) errors.push(e.message); });

const savedFiles = [];
let sampleCalls = 0;
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        if (name === "sample") return Promise.resolve(function (input, opts) {
          sampleCalls++;
          if (opts && opts.onText) opts.onText({ text: "Text", delta: "Text" });
          return Promise.resolve({ text: "Generierter Text.", truncated: false, modelTierApplied: "default" });
        });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>RCT-1</key><summary>Preisberechnung anpassen</summary>
      <description>Rufe das Vertragsmodul auf.</description>
      <status>Offen</status><type>Epic</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "rct.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();

  // ===================== Fix 1: Job 7 hat eine eigene "Datei auswählen"-Karte =====================
  check("Job 7 hat eine eigene Prozessschritte-Karte (#steps-job-7)", !!doc.getElementById("steps-job-7"));
  const job7Steps = doc.getElementById("steps-job-7").textContent;
  check("Job 7 Prozessschritte zeigen 'Datei(en) ausgewählt/importiert'", job7Steps.includes("Datei(en)"));
  check("Job 7 hat eine eigene 'Datei auswählen'-Radiogruppe (active-import-choice-7)", !!doc.querySelector('input[name="active-import-choice-7"]'));
  check("Burger-Menü / Tab-Leiste unverändert bei 7 Jobs (Regression)", doc.querySelectorAll("#verarbeitung-tabs .import-tab").length === 7);

  // Datei ueber Job 7's eigene Radios scopen (nicht ueber Job 4)
  const job7Radios = Array.from(doc.querySelectorAll('input[name="active-import-choice-7"]'));
  const newImportRadio7 = job7Radios[job7Radios.length - 1];
  newImportRadio7.checked = true;
  fire(newImportRadio7, "change");
  await wait(50);
  check("Scoping über Job 7's eigene Datei-Auswahl wirkt (RAG-Extraktion sieht nur 1 Ticket)", (() => {
    doc.querySelector('.import-tab[data-vsub="rag"]').click();
    fire(doc.getElementById("rag-extract-btn"), "click");
    return doc.getElementById("rag-extract-count").textContent === "1";
  })());

  // ===================== Fix 2: Prozessschritte reagieren auf Extraktion/Generierung =====================
  check("Job 7 Schritt 'Rohdaten extrahiert' zeigt jetzt 'done' (grüner Haken)", (() => {
    const stepsHtml = doc.getElementById("steps-job-7").innerHTML;
    return stepsHtml.includes("Rohdaten extrahiert") && /state-done[^>]*>[\s\S]*?Rohdaten extrahiert/.test(stepsHtml);
  })());

  // ===================== Fix 2: Export der Rohdaten-Tabelle (XLSX/DOCX/PDF) =====================
  check("Export-Zeile für Rohdaten-Tabelle sichtbar nach Extraktion", !doc.getElementById("rag-export-row").hidden);
  const xlsxBtn = doc.querySelector('.job-export-btn[data-job="7"][data-format="xlsx"]');
  const docxBtn = doc.querySelector('.job-export-btn[data-job="7"][data-format="docx"]');
  const pdfBtn = doc.querySelector('.job-export-btn[data-job="7"][data-format="pdf"]');
  check("XLSX/DOCX/PDF-Export-Buttons für Job 7 vorhanden", !!xlsxBtn && !!docxBtn && !!pdfBtn);

  savedFiles.length = 0;
  fire(xlsxBtn, "click");
  await wait(150);
  check("XLSX-Export der Rohdaten-Tabelle ausgelöst und gespeichert", savedFiles.length === 1 && savedFiles[0].filename.includes("rag_rohdaten"));
  const xlsxBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
  const xlsxZip = await JSZipNode.loadAsync(xlsxBuf);
  check("XLSX ist eine gültige ZIP/XLSX-Datei mit Sheet", !!xlsxZip.file("xl/worksheets/sheet1.xml") || Object.keys(xlsxZip.files).some((f) => f.includes("sheet")));

  savedFiles.length = 0;
  fire(docxBtn, "click");
  await wait(150);
  check("DOCX-Export der Rohdaten-Tabelle enthält 'Vertragsmodul'", (() => {
    return savedFiles.length === 1;
  })());
  const docxBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
  const docxZip = await JSZipNode.loadAsync(docxBuf);
  const docxXml = await docxZip.file("word/document.xml").async("string");
  check("DOCX enthält die extrahierte Beschreibung ('Vertragsmodul')", docxXml.includes("Vertragsmodul"));
  check("DOCX enthält Ticket-Key RCT-1 (Rohdaten-Export bleibt Ticket-bezogen, anders als Clickanweisung)", docxXml.includes("RCT-1"));

  savedFiles.length = 0;
  fire(pdfBtn, "click");
  await wait(150);
  check("PDF-Export ausgelöst und gespeichert", savedFiles.length === 1);
  const pdfBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
  check("PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");

  // ===================== Reset: RAG-Prozessschritte + Export-Zeile werden zurückgesetzt =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(350);
  check("Nach 'Alle Daten löschen': Rohdaten-Export-Zeile wieder versteckt", doc.getElementById("rag-export-row").hidden);
  check("Nach 'Alle Daten löschen': Job 7 zeigt 'pending' für Rohdaten (kein stale done-Status)", (() => {
    doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
    const stepsHtml = doc.getElementById("steps-job-7").innerHTML;
    return stepsHtml.includes("state-pending");
  })());

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-KONSISTENZ-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
