const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|Could not load script/i)) errors.push(e.message); });

// Simuliert pdf.js (window.pdfjsLib) mit kontrollierbaren Textfragment-
// Positionen (x=transform[4], y=transform[5]) - testet damit gezielt die
// eigene Zeilen-/Spalten-Rekonstruktion in extractTextFromPdf() (siehe
// ticket_cockpit.html), ohne auf eine echte pdf.js-CDN-Ladung angewiesen
// zu sein (im Sandbox-Testnetz ohnehin nicht erreichbar - wie bei
// jszip/jspdf/tesseract auch).
function makeFakeItem(str, x, y, width) { return { str: str, transform: [1, 0, 0, 1, x, y], width: width }; }

// Seite 1: Service-Header-Zeile, Kopfzeile (Schlüssel/Status/Zusammenfassung), zwei Datenzeilen.
// Grosse x-Luecken (>10) zwischen Spalten simulieren echte Tabellen-Spalten in der PDF.
var PAGE1_ITEMS = [
  makeFakeItem("Contract Management ( CM-1.0 ) - Domain: Contract Management", 50, 700, 300),
  makeFakeItem("Schlüssel", 50, 680, 40), makeFakeItem("Status", 120, 680, 30), makeFakeItem("Zusammenfassung", 200, 680, 60),
  makeFakeItem("PDF-1", 50, 660, 35), makeFakeItem("Offen", 120, 660, 30), makeFakeItem("Preisberechnung anpassen", 200, 660, 120),
  makeFakeItem("PDF-2", 50, 640, 35), makeFakeItem("Geschlossen", 120, 640, 50), makeFakeItem("Rechnungsexport reparieren", 200, 640, 130),
];

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: function () {
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: function () { return Promise.resolve({ getTextContent: function () { return Promise.resolve({ items: PAGE1_ITEMS }); } }); },
            destroy: function () { return Promise.resolve(); },
          }),
        };
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

  // ===================== UI: PDF als akzeptierter Dateityp =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  check("Releaseinfo-Dropzone akzeptiert .pdf", doc.getElementById("file-input").getAttribute("accept").includes(".pdf"));
  check("Releaseinfo-Hinweistext erwähnt PDF-Export", doc.getElementById("dropzone-hint").textContent.includes("PDF"));
  check("Releaseinfo-Titel erwähnt Confluence deutlicher", doc.getElementById("dropzone-title").textContent.includes("Confluence"));

  doc.querySelector('.import-tab[data-mode="andere"]').click();
  check("'Andere Importe'-Dropzone akzeptiert ebenfalls .pdf", doc.getElementById("file-input").getAttribute("accept").includes(".pdf"));

  // ===================== Funktionaler Import: PDF -> Text -> Releaseinfo-Parser -> Tickets =====================
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" - Inhalt irrelevant, da getDocument gemockt ist
  const pdfFile = new win.File([pdfBytes], "release_notes.pdf", { type: "application/pdf" });
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [pdfFile], configurable: true });
  fire(input, "change");
  await wait(400);

  check("Import-Erfolg-Toast nach PDF-Upload", doc.getElementById("toast").textContent.includes("Import erfolgreich") || doc.getElementById("toast").textContent.includes("release_notes.pdf"));
  check("Import-Toast meldet 2 Tickets aus dem PDF", doc.getElementById("toast").textContent.includes("2 Tickets"));

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const rowPdf1 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("PDF-1"));
  check("Ticket PDF-1 aus dem PDF korrekt geparst (Status 'Offen')", !!rowPdf1 && rowPdf1.textContent.includes("Offen"));
  fire(rowPdf1, "click");
  check("PDF-1 Zusammenfassung korrekt aus rekonstruierter Spalte übernommen", doc.getElementById("modal-title").textContent.includes("Preisberechnung anpassen"));
  check("PDF-1 Domäne aus Service-Header-Zeile korrekt zugeordnet", doc.getElementById("modal-fields").textContent.includes("Contract Management"));
  fire(doc.getElementById("modal-close"), "click");

  const rowPdf2 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("PDF-2"));
  check("Ticket PDF-2 aus dem PDF korrekt geparst (Status 'Geschlossen')", !!rowPdf2 && rowPdf2.textContent.includes("Geschlossen"));

  // ===================== Fehlerfall: leere/reine Bild-PDF ohne Text =====================
  win.pdfjsLib.getDocument = function () {
    return { promise: Promise.resolve({ numPages: 1, getPage: function () { return Promise.resolve({ getTextContent: function () { return Promise.resolve({ items: [] }); } }); }, destroy: function () { return Promise.resolve(); } }) };
  };
  const emptyPdfFile = new win.File([pdfBytes], "scan.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [emptyPdfFile], configurable: true });
  fire(input, "change");
  await wait(300);
  check("Leere/Bild-PDF ohne Text zeigt verständliche Fehlermeldung statt Absturz", doc.getElementById("toast").textContent.includes("fehlgeschlagen") || doc.getElementById("toast").className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PDF-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
