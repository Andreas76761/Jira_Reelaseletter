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

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>DE-1</key><summary>Improve pricing calculation for dealer contracts</summary>
      <description>The pricing engine must recalculate totals whenever a contract line changes.</description>
      <status>Offen</status><type>Epic</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "de_toggle.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  ["releaseletter", "benutzerhandbuch", "clickanweisung"].forEach((kind) => {
    doc.querySelector('.nav-item[data-view="' + kind + '"]').click();
    const genBtn = doc.getElementById(kind + "-generate-btn");
    fire(genBtn, "click");
    const preview = doc.getElementById(kind + "-preview");

    check(kind + ": Toggle-Buttons 'Deutsch'/'English' vorhanden", !!doc.getElementById(kind + "-variant-de") && !!doc.getElementById(kind + "-variant-en"));
    check(kind + ": 'Deutsch' ist initial aktiv", doc.getElementById(kind + "-variant-de").className.includes("active"));

    // Ticket-Freitext (hier Englisch) bleibt in BEIDEN Sprachmodi sichtbar -
    // die App uebersetzt ihn bewusst nicht (Risiko fachlicher Verfaelschung).
    if (kind !== "clickanweisung") {
      check(kind + ": Deutsch-Ansicht zeigt weiterhin den (englischen) Ticket-Freitext unveraendert", preview.textContent.includes("pricing calculation") || preview.textContent.includes("pricing engine"));
      check(kind + ": Deutsch-Ansicht enthält deutsche Vorlagen-Labels", preview.textContent.includes("Stand:") || preview.textContent.includes("Ticket:"));
    } else {
      check("clickanweisung: Deutsch-Ansicht zeigt den Klickschritt-Text (aus der Ticket-Beschreibung) unveraendert", preview.textContent.includes("pricing engine"));
      check("clickanweisung: bleibt konsistent zum Redesign (keine Ticket-Referenzen, auch im Deutsch-Modus)", !preview.textContent.includes("DE-1"));
    }
    check(kind + ": Hinweis auf nicht-automatische Übersetzung ist sichtbar", preview.textContent.includes("NICHT automatisch übersetzt"));

    fire(doc.getElementById(kind + "-variant-en"), "click");
    check(kind + ": Nach Klick auf 'English' ist dieser Button aktiv", doc.getElementById(kind + "-variant-en").className.includes("active"));
    check(kind + ": English-Ansicht nutzt englische Vorlagen-Labels", preview.textContent.includes("As of:") || preview.textContent.includes("Ticket:"));
    if (kind === "releaseletter") check("releaseletter: English-Ansicht zeigt 'New Features & Changes' statt 'Neue Funktionen'", preview.textContent.includes("New Features & Changes"));
    if (kind === "benutzerhandbuch") check("benutzerhandbuch: English-Ansicht zeigt 'User Manual'", preview.textContent.includes("User Manual"));
    if (kind === "clickanweisung") check("clickanweisung: English-Ansicht zeigt 'Operating Instructions'", preview.textContent.includes("Operating Instructions"));

    fire(doc.getElementById(kind + "-variant-de"), "click");
    check(kind + ": Zurück zu 'Deutsch' zeigt wieder deutsche Vorlagen-Labels", preview.textContent.includes("Stand:") || preview.textContent.includes("Deutsch"));
  });

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE SPRACHUMSCHALTER-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
