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

    check(kind + ": Toggle-Buttons 'Original'/'Nur Deutsch' vorhanden", !!doc.getElementById(kind + "-variant-full") && !!doc.getElementById(kind + "-variant-de"));
    check(kind + ": 'Original' ist initial aktiv", doc.getElementById(kind + "-variant-full").className.includes("active"));
    check(kind + ": Original-Ansicht enthält den englischen Ticket-Text", preview.textContent.includes("pricing calculation") || preview.textContent.includes("pricing engine"));

    fire(doc.getElementById(kind + "-variant-de"), "click");
    check(kind + ": Nach Klick auf 'Nur Deutsch' ist dieser Button aktiv", doc.getElementById(kind + "-variant-de").className.includes("active"));
    check(kind + ": 'Nur Deutsch'-Ansicht enthält NICHT den englischen Ticket-Text (keine Erfindung, aber auch kein Mischmasch)",
      !preview.textContent.includes("pricing calculation") && !preview.textContent.includes("pricing engine"));
    check(kind + ": 'Nur Deutsch'-Ansicht erklärt ehrlich, warum Freitext fehlt (kein Fake-Erfolg)", preview.textContent.includes("ausgeblendet") || preview.textContent.includes("nicht automatisch"));
    if (kind !== "clickanweisung") {
      check(kind + ": 'Nur Deutsch'-Ansicht enthält weiterhin den Ticket-Key (unser eigener, deutscher Kontext)", preview.textContent.includes("DE-1"));
    } else {
      check("clickanweisung: 'Nur Deutsch'-Ansicht bleibt konsistent zum Redesign (keine Ticket-Referenzen, auch nicht im Deutsch-Modus)", !preview.textContent.includes("DE-1"));
    }

    fire(doc.getElementById(kind + "-variant-full"), "click");
    check(kind + ": Zurück zu 'Original' zeigt wieder den englischen Text", preview.textContent.includes("pricing calculation") || preview.textContent.includes("pricing engine"));
  });

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DEUTSCH-TOGGLE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
