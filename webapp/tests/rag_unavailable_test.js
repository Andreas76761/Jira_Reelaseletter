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

// Kein window.claude ueberhaupt (wie beim lokalen Oeffnen der .build.html-Datei
// ohne Claude-Artifact-Laufzeit) - haeufigster Fall beim Testen/lokalen Oeffnen.
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
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  fire(doc.getElementById("rag-extract-btn"), "click");
  check("Extraktion funktioniert auch ohne window.claude (rein deterministisch)", parseInt(doc.getElementById("rag-extract-count").textContent, 10) > 0);

  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(100);
  check("Ohne sample-Capability: Toast/Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("nicht verfügbar") || doc.getElementById("toast").textContent.includes("Claude"));
  check("Kein Text wurde erfunden (Ausgabe bleibt 'Noch kein Text generiert.')", doc.getElementById("rag-output").textContent.includes("Noch kein Text generiert"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-UNAVAILABLE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
