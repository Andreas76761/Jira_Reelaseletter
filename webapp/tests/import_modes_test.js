const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const input = doc.getElementById("file-input");
  function upload(fileObj) {
    Object.defineProperty(input, "files", { value: [fileObj], configurable: true });
    fire(input, "change");
  }

  doc.querySelector('.nav-item[data-view="import"]').click();

  // --- Tab-Steuerung ---
  const tabs = doc.querySelectorAll("#import-tabs .import-tab");
  check("4 Import-Tabs vorhanden", tabs.length === 4);
  check("Standard-Tab 'massenupload' aktiv", doc.querySelector('.import-tab[data-mode="massenupload"]').classList.contains("active"));

  // --- 1. Jira Einzelticket ---
  doc.querySelector('.import-tab[data-mode="einzelticket"]').click();
  check("Dropzone-Hinweis wechselt auf Einzelticket", doc.getElementById("dropzone-title").textContent.includes("Einzelticket") || doc.getElementById("dropzone-title").textContent.includes("Detailseite"));
  const singleHtml = fs.readFileSync(path.join(FIXTURES, "single_ticket_sample.html"), "utf-8");
  upload(new dom.window.File([singleHtml], "ONESCM-50123.html", { type: "text/html" }));
  await wait(300);
  check("Einzelticket importiert: 664 Tickets gesamt", doc.getElementById("stat-tickets").textContent === "664");

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-50123";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  const row = doc.querySelector("#table-body tr");
  fire(row, "click");
  const fieldsText = doc.getElementById("modal-fields").textContent;
  check("Einzelticket zeigt korrekte Zusammenfassung", fieldsText.includes("Vertragsverlängerung schlägt fehl bei Sonderkonditionen"));
  check("Einzelticket-Bearbeiter pseudonymisiert", /Person \d/.test(fieldsText));
  check("Einzelticket zeigt Domain-Custom-Field", fieldsText.includes("Contract Generation and Contract Management"));
  fire(doc.getElementById("modal-close"), "click");
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // --- 2. Releaseinfo ---
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  check("Dropzone-Hinweis wechselt auf Releaseinfo", doc.getElementById("dropzone-title").textContent.includes("Releaseinfo"));
  const releaseinfoText = fs.readFileSync(path.join(FIXTURES, "releaseinfo_full.txt"), "utf-8");
  upload(new dom.window.File([releaseinfoText], "release_notes_sep2026.txt", { type: "text/plain" }));
  await wait(400);
  const totalAfterReleaseinfo = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Releaseinfo importiert: Tickets-Zahl deutlich gestiegen (>700)", totalAfterReleaseinfo > 700);
  console.log("  (Ticket-Gesamtzahl nach Releaseinfo-Import:", totalAfterReleaseinfo, ")");

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-45030";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  const riRow = doc.querySelector("#table-body tr");
  check("Releaseinfo-Ticket ONESCM-45030 gefunden", !!riRow);
  if (riRow) {
    fire(riRow, "click");
    const riFields = doc.getElementById("modal-fields").textContent;
    check("Releaseinfo-Ticket zeigt Zusammenfassung", riFields.includes("Change renaming logic"));
    check("Releaseinfo-Ticket zeigt normalisierte Domain", riFields.includes("Documents & Communications"));
    fire(doc.getElementById("modal-close"), "click");
  }
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // Domain-Chart sollte jetzt neue Domains enthalten (aus Releaseinfo)
  const domainNames = Array.from(doc.querySelectorAll("#domain-chart .domain-row .name")).map((e) => e.textContent);
  check("Neue Domain 'Contract Generation and Contract Management' im Domain-Chart", domainNames.includes("Contract Generation and Contract Management"));

  // --- 3. Andere Importe (Auto-Erkennung, mit einer XML-Datei testen) ---
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="andere"]').click();
  check("Dropzone-Hinweis wechselt auf 'Andere'", doc.getElementById("dropzone-title").textContent.includes("Beliebige"));
  const xmlText = fs.readFileSync(path.join(FIXTURES, "full_export.xml"), "utf-8");
  upload(new dom.window.File([xmlText], "nachtrag.xml", { type: "application/xml" }));
  await wait(300);
  check("'Andere Importe' erkennt XML automatisch (Anzahl weiter gestiegen)", parseInt(doc.getElementById("stat-tickets").textContent, 10) > totalAfterReleaseinfo);

  // Fehlerfall: unbekanntes Format über 'Andere Importe'
  upload(new dom.window.File(["Dies ist irgendein Text ohne Ticketstruktur."], "unsinn.txt", { type: "text/plain" }));
  await wait(300);
  check("Unerkanntes Format zeigt Fehlermeldung (kein Absturz)", doc.getElementById("toast").className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE IMPORT-MODI-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
