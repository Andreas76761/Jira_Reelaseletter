// Import: "Ticket-Splitt" - eine .docx mit mehreren Jira-Tickets wird wie ein
// normaler Import gespeichert UND zusaetzlich je Ticket als eigene .docx-Datei
// (ZIP) bereitgestellt.
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

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
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

// Baut eine minimale .docx (OOXML/ZIP mit word/document.xml), deren
// Fliesstext demselben "Domain-Header + Tab-Tabelle"-Format entspricht, das
// der Releaseinfo-Textparser bereits erkennt (siehe docx_zip_import_test.js,
// txtEntry) - reproduziert also einen echten Mehrfach-Ticket-.docx-Export.
async function buildMultiTicketDocxBuffer() {
  var paragraphs = [
    "Domain Alpha ( DA-1.0 ) - Domain: Domain Alpha",
    "Schlüssel\tStatus\tZusammenfassung",
    "SPLIT-1\tOffen\tErstes Ticket zum Splitten",
    "SPLIT-2\tFertig\tZweites Ticket zum Splitten",
  ];
  var body = paragraphs.map(function (p) {
    return "<w:p><w:r><w:t xml:space=\"preserve\">" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</w:t></w:r></w:p>";
  }).join("");
  var documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + "</w:body></w:document>";
  var zip = new JSZipNode();
  zip.file("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>");
  zip.file("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>");
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="import"]').click();

  // ===================== Neuer Tab "Ticket-Splitt" vorhanden =====================
  const tab = doc.querySelector('.import-tab[data-mode="ticketsplitt"]');
  check("Import-Tab 'Ticket-Splitt' vorhanden", !!tab);
  fire(tab, "click");
  await wait(50);
  check("Ticket-Splitt-Dropzone akzeptiert .docx/.doc", doc.getElementById("file-input").getAttribute("accept").includes(".docx"));
  check("Erklaerender Hinweistext bei Ticket-Splitt sichtbar", doc.getElementById("ticketsplitt-callout").hidden === false);
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  check("Erklaerender Hinweistext bei anderen Tabs wieder versteckt", doc.getElementById("ticketsplitt-callout").hidden === true);
  fire(tab, "click");
  await wait(50);

  // ===================== Upload: Import wie gewohnt + automatischer Splitt-Export =====================
  const docxBuf = await buildMultiTicketDocxBuffer();
  const docxFile = new win.File([docxBuf], "mehrere_tickets.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [docxFile], configurable: true });
  fire(input, "change");
  // Erzeugt 2x ein eigenes .docx (async, JSZip) und zippt sie - je nach
  // Systemlast langsamer als ein einfacher Import, daher pollen statt eines
  // festen wait().
  for (let waited = 0; waited < 5000 && !doc.getElementById("toast").textContent; waited += 100) await wait(100);

  const toast = doc.getElementById("toast");
  check("Import-Toast zeigt keinen Fehler", !toast.className.includes("error"));
  check("Import-Toast meldet Erfolg", toast.textContent.includes("Import erfolgreich"));
  check("Import-Toast nennt Anzahl heruntergeladener Einzel-.docx-Dateien", toast.textContent.includes("2 Einzel-.docx-Dateien"));

  // Datei wurde wie ein normaler Import gespeichert (Dateiverwaltung).
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRow = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("mehrere_tickets.docx"));
  check("Import-Zeile fuer die hochgeladene Datei in Dateiverwaltung vorhanden (normaler Import zusaetzlich zum Splitt)", !!importRow);

  // Beide Tickets normal im Dashboard auffindbar.
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "SPLIT-";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const dashboardText = doc.getElementById("table-body").textContent;
  check("SPLIT-1 im Dashboard auffindbar", dashboardText.includes("SPLIT-1"));
  check("SPLIT-2 im Dashboard auffindbar", dashboardText.includes("SPLIT-2"));

  // ===================== ZIP mit Einzel-.docx-Dateien wurde heruntergeladen =====================
  check("Genau 1 Datei ueber die Downloads-Capability gespeichert (das Splitt-ZIP)", savedFiles.length === 1);
  check("Heruntergeladene Datei endet auf '_ticketsplitt.zip'", savedFiles.length && /_ticketsplitt\.zip$/.test(savedFiles[0].filename));
  if (savedFiles.length) {
    const zip = await JSZipNode.loadAsync(savedFiles[0].data);
    const names = Object.keys(zip.files).sort();
    check("ZIP enthaelt genau 2 Dateien", names.length === 2);
    check("ZIP enthaelt 'SPLIT-1.docx' (Dateiname = Jira-Nummer)", names.includes("SPLIT-1.docx"));
    check("ZIP enthaelt 'SPLIT-2.docx' (Dateiname = Jira-Nummer)", names.includes("SPLIT-2.docx"));
    const split1Buf = await zip.file("SPLIT-1.docx").async("nodebuffer");
    const innerZip = await JSZipNode.loadAsync(split1Buf);
    check("SPLIT-1.docx ist selbst eine gueltige .docx (enthaelt word/document.xml)", !!innerZip.file("word/document.xml"));
    const innerXml = await innerZip.file("word/document.xml").async("string");
    check("SPLIT-1.docx nennt den Ticket-Schluessel SPLIT-1", innerXml.includes("SPLIT-1"));
    check("SPLIT-1.docx nennt die Zusammenfassung (gleiches Ticket-Layout wie Feld/Wert-Tabelle)", innerXml.includes("Erstes Ticket zum Splitten"));
    check("SPLIT-1.docx nennt den Status 'Offen'", innerXml.includes("Offen"));
  }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TICKET-SPLITT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
