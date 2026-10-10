// Regression: "Datei zusammenfassen" (Dateiansicht-FastTrack) blieb ohne
// window.claude (z. B. beim lokalen Oeffnen der .build.html-Datei ausserhalb
// der Claude-Artifact-Laufzeit) dauerhaft auf "Erzeuge Zusammenfassung ..."
// haengen: fileviewLoadSummaryLang() pruefte sampleApi erst NACH dem
// Anzeigen des Lade-Zustands und kehrte bei fehlender KI-Funktion sofort
// zurueck, ohne den Lade-Zustand je wieder auszublenden. Dieser Test prueft
// bewusst OHNE window.claude (wie rag_unavailable_test.js), dass das Modal
// stattdessen einen klaren Hinweistext zeigt und sich normal bedienen laesst.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// Kein window.claude ueberhaupt.
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

  // Basis-Import: die App startet bewusst mit 0 eingebetteten Tickets (s.
  // data/tickets.json).
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>NOCL-1</key><summary>Testticket ohne KI-Laufzeit</summary><description>Beschreibung.</description><status>Offen</status></item>
  </channel></rss>`;
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "nocl.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  const select = doc.getElementById("fileview-import-select");
  const option = Array.from(select.options).find((o) => o.textContent.indexOf("nocl.xml") !== -1);
  check("Import 'nocl.xml' in Dateiansicht-Auswahl vorhanden", !!option);
  select.value = option.value;
  fire(select, "change");
  fire(doc.getElementById("fileview-show-btn"), "click");
  await wait(100);

  const summarizeBtn = doc.getElementById("fileview-summarize-btn");
  check("'Datei zusammenfassen'-Button aktiv", !summarizeBtn.disabled);

  fire(summarizeBtn, "click");
  await wait(600); // grosszuegige Wartezeit - der alte Bug blieb auch danach noch haengen
  check("BUGFIX: Lade-Hinweis bleibt NICHT dauerhaft sichtbar", doc.getElementById("fileview-summary-loading").hidden === true);
  check("BUGFIX: Sanduhr (Spinner) bleibt NICHT dauerhaft sichtbar", doc.getElementById("fileview-summary-spinner").hidden === true);
  check("Ausgabe zeigt verstaendlichen Hinweis statt leer zu bleiben", doc.getElementById("fileview-summary-output").textContent.includes("nicht verfügbar"));
  check("Hinweistoast informiert ueber fehlende KI-Funktion", doc.getElementById("toast").textContent.includes("nicht verfügbar"));
  check("Export-Buttons bleiben deaktiviert (kein Text zum Exportieren vorhanden)",
    doc.getElementById("fileview-summary-export-csv-btn").disabled &&
    doc.getElementById("fileview-summary-export-docx-btn").disabled &&
    doc.getElementById("fileview-summary-export-pdf-btn").disabled);

  // Modal laesst sich trotzdem normal bedienen (Sprachwechsel, Schliessen) -
  // kein Deadlock durch den vorherigen Fehlerzustand.
  fire(doc.getElementById("fileview-summary-lang-en-btn"), "click");
  await wait(100);
  check("Sprachwechsel auf English zeigt ebenfalls den Hinweis statt haengen zu bleiben",
    doc.getElementById("fileview-summary-loading").hidden === true && doc.getElementById("fileview-summary-output").textContent.includes("nicht verfügbar"));
  fire(doc.getElementById("fileview-summary-modal-close"), "click");
  await wait(50);
  check("Modal laesst sich trotz fehlender KI-Funktion normal schliessen", doc.getElementById("fileview-summary-modal-overlay").hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FILEVIEW-SUMMARY-UNAVAILABLE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
