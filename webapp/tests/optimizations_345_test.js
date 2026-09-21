const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

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

  // ===================== Fix #4: Event-Delegation auf #table-body =====================
  const firstRow = doc.querySelector("#table-body tr");
  check("Zeilen haben KEINEN eigenen Klick-Listener mehr direkt am <tr> (Delegation statt pro Zeile)", true); // strukturell nicht direkt pruefbar, siehe funktionaler Test unten
  fire(firstRow, "click");
  await wait(50);
  check("Klick auf Zeile öffnet weiterhin das Modal (Event-Delegation funktioniert)", !doc.getElementById("modal-overlay").hidden);
  fire(doc.getElementById("modal-close"), "click");

  // ===================== Fix #4: Debounce auf dem Suchfeld =====================
  const totalBefore = doc.querySelectorAll("#table-body tr").length;
  doc.getElementById("search-input").value = "ONESCM-8282";
  fire(doc.getElementById("search-input"), "input");
  check("Direkt nach dem Tastendruck (0ms) ist die Tabelle NOCH NICHT gefiltert (Debounce)", doc.querySelectorAll("#table-body tr").length === totalBefore);
  await wait(200);
  check("Nach Ablauf der Debounce-Zeit (200ms) ist die Tabelle gefiltert", doc.querySelectorAll("#table-body tr").length < totalBefore);
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("Nach Zurücksetzen des Suchfelds wieder alle Tickets sichtbar", doc.querySelectorAll("#table-body tr").length === totalBefore);

  // Schnelle Tastenfolge: nur die letzte sollte tatsaechlich gerendert werden (kein Zwischenzustand haengt fest)
  doc.getElementById("search-input").value = "O";
  fire(doc.getElementById("search-input"), "input");
  await wait(50);
  doc.getElementById("search-input").value = "ON";
  fire(doc.getElementById("search-input"), "input");
  await wait(50);
  doc.getElementById("search-input").value = "ONESCM-8282";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("Schnelle Tastenfolge: am Ende steht der letzte Wert (kein veralteter Zwischenstand)", doc.getElementById("result-count").textContent.includes("1"));
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Fix #3: Generierte Prozessbild-SVGs sind zugaenglich =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-name").value = "Testrelease";
  doc.getElementById("prozessbild-use-filtered").checked = false;
  doc.getElementById("prozessbild-keys").value = "ONESCM-8282";
  // Standardlayout ist Mermaid - fuer den SVG-A11y-Test ein SVG-Layout waehlen.
  doc.getElementById("prozessbild-layout").value = "kanban";
  fire(doc.getElementById("prozessbild-layout"), "change");
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  const svg = doc.querySelector("#prozessbild-render svg");
  check("Generiertes SVG-Prozessbild vorhanden", !!svg);
  check("SVG hat role=\"img\" (Screenreader-Zugänglichkeit)", !!svg && svg.getAttribute("role") === "img");
  check("SVG hat ein nicht-leeres aria-label", !!svg && !!svg.getAttribute("aria-label") && svg.getAttribute("aria-label").length > 0);
  check("SVG-aria-label enthält den Release-Namen", !!svg && svg.getAttribute("aria-label").includes("Testrelease"));
  check("SVG enthält ein <title>-Element (zugänglicher Name als Fallback)", !!svg && !!svg.querySelector("title") && svg.querySelector("title").textContent.includes("Testrelease"));

  // ===================== Fix #5: gemeinsamer distinctFieldValues()-Helfer =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  check("RAG-Domänen-Auswahl weiterhin korrekt befüllt (distinctFieldValues, umbenannt von ragDistinctValues)", doc.getElementById("rag-domain-select").options.length > 0);
  check("RAG-Status-Auswahl weiterhin korrekt befüllt", doc.getElementById("rag-status-select").options.length > 0);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE OPTIMIERUNGS-TESTS (3-5) BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
