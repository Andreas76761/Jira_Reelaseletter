const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");

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

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(label, ok) { checks.push([label, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + label); }

  // --- 1. Initialzustand ---
  check("Initial: 663 Tickets geladen", doc.getElementById("stat-tickets").textContent === "663");
  check("Initial: 1 Import", doc.getElementById("stat-imports").textContent === "1");
  check("Initial: 0 Änderungen", doc.getElementById("stat-changes").textContent === "0");
  check("Dashboard-Panel initial sichtbar", !doc.querySelector('[data-view-panel="dashboard"]').hidden);
  check("Import-Panel initial versteckt", doc.querySelector('[data-view-panel="import"]').hidden);

  // --- 2. Navigation ---
  ["import", "dateiverwaltung", "verarbeitung", "releaseletter", "benutzerhandbuch", "prozessbild",
   "clickanweisung", "bilder", "output-md", "output-pdf", "infobox", "glossar", "dashboard"].forEach((view) => {
    const navBtn = doc.querySelector('.nav-item[data-view="' + view + '"]');
    fire(navBtn, "click");
    const panel = doc.querySelector('[data-view-panel="' + view + '"]');
    check("Nav -> " + view + " zeigt Panel und markiert Button aktiv", !panel.hidden && navBtn.classList.contains("active"));
  });

  // --- 3. Sidebar collapse ---
  fire(doc.getElementById("sidebar-toggle"), "click");
  check("Sidebar eingeklappt nach Toggle", doc.getElementById("sidebar").classList.contains("collapsed"));
  fire(doc.getElementById("sidebar-open-btn"), "click");
  check("Sidebar wieder ausgeklappt", !doc.getElementById("sidebar").classList.contains("collapsed"));

  // --- 4. Mehrfach-Import mit Änderung (echtes ONESCM-8282 erneut mit anderem Status) ---
  doc.querySelector('.nav-item[data-view="import"]').click();
  const changedXml = `<?xml version="1.0"?><rss><channel>
    <item><key>ONESCM-8282</key><summary>Testfeld</summary><status>Fertig</status>
      <created>01/Jan/24 12:07 PM</created><updated>21/Sep/26 3:00 PM</updated></item>
    <item><key>ONESCM-NEU-1</key><summary>Brandneues Ticket</summary><status>Offen</status></item>
  </channel></rss>`;
  const file2 = new dom.window.File([changedXml], "nachtrag.xml", { type: "application/xml" });
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [file2], configurable: true });
  fire(input, "change");
  await wait(300);

  check("Nach 2. Import: 664 Tickets (663 + 1 neu)", doc.getElementById("stat-tickets").textContent === "664");
  check("Nach 2. Import: 2 Imports", doc.getElementById("stat-imports").textContent === "2");
  check("Nach 2. Import: 1 Änderung erkannt (ONESCM-8282)", doc.getElementById("stat-changes").textContent === "1");
  check("Nav-Badge zeigt 1 Änderung", !doc.getElementById("nav-badge-changes").hidden && doc.getElementById("nav-badge-changes").textContent === "1");

  // Dateiverwaltung prüfen
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRows = doc.querySelectorAll("#imports-tbody tr");
  check("2 Zeilen in Imports-Tabelle", importRows.length === 2);
  const changeRows = doc.querySelectorAll("#changes-tbody tr");
  const changesText = doc.getElementById("changes-tbody").textContent;
  check("Änderungstabelle enthält ONESCM-8282", changesText.includes("ONESCM-8282"));
  check("Änderungstabelle zeigt alten Status 'Geschlossen'", changesText.includes("Geschlossen"));
  check("Änderungstabelle zeigt neuen Status 'Fertig'", changesText.includes("Fertig"));
  check("Änderungstabelle zeigt Quellen (Jira_ONESCM... -> nachtrag.xml)", changesText.includes("nachtrag.xml"));

  // Verarbeitung / Log prüfen
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  const logText = doc.getElementById("log-list").textContent;
  check("Log enthält 2 Import-Einträge", (logText.match(/Import „/g) || []).length === 2);
  check("Log enthält 'geändert' Hinweis", logText.includes("1 geändert"));

  // Dashboard: geändertes Ticket markiert
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-8282";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  const row8282 = doc.querySelector('#table-body tr');
  check("ONESCM-8282 im Dashboard als geändert markiert (is-changed)", row8282 && row8282.classList.contains("is-changed"));
  check("ONESCM-8282 zeigt jetzt Status 'Fertig' (neuester Stand)", row8282 && row8282.textContent.includes("Fertig"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // --- 5. Releaseletter-Generator ---
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  doc.getElementById("releaseletter-keys").value = "ONESCM-8282\nONESCM-NEU-1";
  doc.getElementById("releaseletter-use-filtered").checked = false;
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  const rlPreview = doc.getElementById("releaseletter-preview").textContent;
  check("Releaseletter-Vorschau enthält Titel", rlPreview.includes("# Release Letter"));
  check("Releaseletter-Vorschau enthält beide Ticket-Keys", rlPreview.includes("ONESCM-8282") && rlPreview.includes("ONESCM-NEU-1"));
  check("Download-Button aktiviert", !doc.getElementById("releaseletter-download-btn").disabled);
  fire(doc.getElementById("releaseletter-download-btn"), "click");
  await wait(100);

  // --- 6. Prozessbild-Generator ---
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-keys").value = "ONESCM-8282\nONESCM-NEU-1";
  doc.getElementById("prozessbild-use-filtered").checked = false;
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  const mermaidPre = doc.querySelector("#prozessbild-render pre.mermaid");
  check("Mermaid-Quelltext eingefügt", mermaidPre && mermaidPre.textContent.includes("flowchart TD"));
  check("Mermaid enthält beide Tickets", mermaidPre && mermaidPre.textContent.includes("ONESCM-8282") && mermaidPre.textContent.includes("ONESCM-NEU-1"));

  // Bilder-Galerie
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  check("Galerie enthält 1 generiertes Bild", doc.querySelectorAll("#gallery .gallery-card").length === 1);

  // --- 7. Output MD Export (gefiltert) ---
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-NEU";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  doc.querySelector('.nav-item[data-view="output-md"]').click();
  check("Output-MD zeigt 1 von 664 Tickets (gefiltert)", doc.getElementById("output-md-count").textContent === "1" && doc.getElementById("output-md-total").textContent === "664");
  fire(doc.getElementById("output-md-export-btn"), "click");
  await wait(500);

  // --- 8. Output PDF Export (gefiltert) ---
  doc.querySelector('.nav-item[data-view="output-pdf"]').click();
  fire(doc.getElementById("output-pdf-export-btn"), "click");
  await wait(500);

  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // --- 9. Einzel-PDF-Download aus Modal ---
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const anyRow = doc.querySelector("#table-body tr");
  fire(anyRow, "click");
  fire(doc.getElementById("modal-download-pdf-btn"), "click");
  await wait(300);

  console.log("\ndownloads.save Aufrufe:", savedFiles.map((f) => f.filename));

  const mdZipReq = savedFiles.find((f) => f.filename === "tickets_bereinigt.zip");
  const pdfZipReq = savedFiles.find((f) => f.filename === "tickets_bereinigt_pdf.zip");
  const rlReq = savedFiles.find((f) => f.filename.includes("_releaseletter_") && f.filename.endsWith(".md"));
  const singlePdfReq = savedFiles.find((f) => f.filename.endsWith(".pdf") && f !== pdfZipReq);

  check("MD-ZIP-Export ausgelöst", !!mdZipReq);
  if (mdZipReq) {
    const zip = await JSZipNode.loadAsync(Buffer.from(await mdZipReq.data.arrayBuffer()));
    check("MD-ZIP enthält genau 1 Datei (gefiltert)", Object.keys(zip.files).length === 1);
    check("MD-ZIP enthält ONESCM-NEU-1.md", !!zip.files["ONESCM-NEU-1.md"]);
  }
  check("PDF-ZIP-Export ausgelöst", !!pdfZipReq);
  if (pdfZipReq) {
    const zip = await JSZipNode.loadAsync(Buffer.from(await pdfZipReq.data.arrayBuffer()));
    check("PDF-ZIP enthält genau 1 Datei (gefiltert)", Object.keys(zip.files).length === 1);
    const pdfBuf = await zip.files["ONESCM-NEU-1.pdf"].async("nodebuffer");
    check("PDF in ZIP beginnt mit %PDF", pdfBuf.slice(0, 5).toString() === "%PDF-");
  }
  check("Releaseletter-Download ausgelöst", !!rlReq);
  check("Einzel-PDF-Download aus Modal ausgelöst", !!singlePdfReq);
  if (singlePdfReq) {
    const buf = Buffer.from(await singlePdfReq.data.arrayBuffer());
    check("Einzel-PDF beginnt mit %PDF", buf.slice(0, 5).toString() === "%PDF-");
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    check("Einzel-PDF-Text enthält Ticket-Key", result.text.includes(anyRow.querySelector("td.key").textContent));
  }

  // --- 10. Infobox / Glossar statisch ---
  doc.querySelector('.nav-item[data-view="infobox"]').click();
  check("Infobox zeigt Erklärtext", doc.querySelector('[data-view-panel="infobox"]').textContent.includes("pseudonymisiert"));
  doc.querySelector('.nav-item[data-view="glossar"]').click();
  check("Glossar enthält mind. 8 Begriffe", doc.querySelectorAll('[data-view-panel="glossar"] tbody tr').length >= 8);

  // --- 11. Sitzung zurücksetzen ---
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  check("Nach Reset: wieder 663 Tickets", doc.getElementById("stat-tickets").textContent === "663");
  check("Nach Reset: 1 Import", doc.getElementById("stat-imports").textContent === "1");
  check("Nach Reset: 0 Änderungen", doc.getElementById("stat-changes").textContent === "0");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["Keine JS-Fehler", false]); }

  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  if (failed.length) {
    console.error("\nFEHLGESCHLAGENE CHECKS:");
    failed.forEach((f) => console.error(" - " + f[0]));
    process.exit(1);
  }
  console.log("\nALLE TESTS DER ERWEITERTEN APP BESTANDEN");
})().catch((e) => { console.error("Ausnahme:", e); process.exit(1); });
