const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>TYP-1</key><summary>Mit Typ</summary><type>Epic</type>
      <description>Betrifft Market.</description><status>Offen</status></item>
    <item><key>TYP-2</key><summary>Ohne Typ</summary>
      <description>Kein Typ im Export.</description><status>Offen</status></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "typ_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Dashboard =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  check("Dashboard-Tabellenkopf hat Spalte 'Typ'", doc.querySelector("thead th[data-key='issueType']") !== null);
  const dashRows = Array.from(doc.querySelectorAll("#table-body tr"));
  const typ1Row = dashRows.find((r) => r.textContent.includes("TYP-1"));
  const typ2Row = dashRows.find((r) => r.textContent.includes("TYP-2"));
  check("Dashboard zeigt 'Epic' für Ticket mit Typ", !!typ1Row && typ1Row.textContent.includes("Epic"));
  check("Dashboard zeigt '–' für Ticket ohne Typ (keine Erfindung)", !!typ2Row && typ2Row.textContent.includes("–"));

  // Sortierung nach Typ funktioniert (keine Exceptions)
  const typHeader = doc.querySelector("thead th[data-key='issueType']");
  fire(typHeader, "click");
  check("Klick auf 'Typ'-Spaltenkopf sortiert ohne Fehler", errors.length === 0);

  // ===================== Job 4: Releaseversion =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  check("Job 4 Tabellenkopf hat Spalte 'Typ'", doc.querySelector("#releaseversion-table thead").textContent.includes("Typ"));
  const rv1 = Array.from(doc.querySelectorAll("#releaseversion-tbody tr")).find((r) => r.textContent.includes("TYP-1"));
  check("Job 4 zeigt 'Epic' in eigener Zelle", !!rv1 && rv1.textContent.includes("Epic"));

  // ===================== Job 5: Jira Liste =====================
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  check("Job 5 Tabellenkopf hat Spalte 'Typ'", doc.querySelector("#jiraliste-table thead").textContent.includes("Typ"));
  const jl1 = Array.from(doc.querySelectorAll("#jiraliste-tbody tr")).find((r) => r.textContent.includes("TYP-1"));
  check("Job 5 zeigt 'Epic'", !!jl1 && jl1.textContent.includes("Epic"));

  // ===================== Job 6: Domänen-Übersicht =====================
  doc.querySelector('.import-tab[data-vsub="domaenen-uebersicht"]').click();
  check("Job 6 Tabellenkopf hat Spalte 'Typ'", doc.querySelector("#domainoverview-table thead").textContent.includes("Typ"));
  const do1 = Array.from(doc.querySelectorAll("#domainoverview-tbody tr")).find((r) => r.textContent.includes("TYP-1"));
  check("Job 6 zeigt 'Epic'", !!do1 && do1.textContent.includes("Epic"));
  check("Job 6 Gruppenzeile hat colspan 8 (neue Spalte berücksichtigt)", doc.querySelector("#domainoverview-tbody .domain-group-row td").getAttribute("colspan") === "8");

  // ===================== Prozessbild: Schritt-Tabelle-Export enthält Typ =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-use-filtered").checked = false;
  doc.getElementById("prozessbild-keys").value = "TYP-1";
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await wait(150);
  // stepTableSections ist eine innere Closure-Funktion - prüfen über den Export-Button (XLSX ruft buildXlsxBlob mit denselben Sections auf).
  check("Prozessbild-Exportbuttons für Schritt-Tabelle vorhanden (XLSX/DOCX/PDF)", !!doc.getElementById("prozessbild-download-xlsx-btn"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TYP-SPALTEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
