// Persistenter Speicher: graceful Fallback, wenn IndexedDB in der
// Laufzeitumgebung NICHT verfügbar ist (z. B. manche eingebetteten/
// sandboxed Ansichten) - jsdom selbst bringt ohnehin keine IndexedDB mit,
// entspricht also automatisch diesem Fall (siehe autosave_persistence_test.js
// für den Fall MIT IndexedDB, dort über fake-indexeddb simuliert). Prüft:
// kein JS-Fehler, Checkbox erscheint deaktiviert/nicht angehakt mit
// erklärendem Status-Text, App bootet trotzdem normal mit den
// Ausgangsdaten (kein Hänger/Absturz durch den fehlgeschlagenen
// IndexedDB-Zugriff beim Start), und - als Performance-Regressionsschutz -
// es wird bewusst KEIN document-weiter Auto-Save-Listener registriert,
// wenn die Funktion ohnehin nie etwas speichern könnte (sonst würde jeder
// Klick sinnlos einen Timer neu starten).
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = { use: function () { return Promise.resolve(null); } };
    // Bewusst KEIN window.indexedDB gesetzt - entspricht dem realen Fehlen
    // in dieser Umgebung.
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  check("window.indexedDB in dieser Umgebung tatsächlich nicht vorhanden (Testvoraussetzung)", !dom.window.indexedDB);

  check("App bootet trotzdem normal (Ausgangsdaten geladen)", parseInt(doc.getElementById("stat-tickets").textContent, 10) > 0);
  check("Kein Bestätigungsdialog beim Start (nichts zum Wiederherstellen, kein Hänger)", doc.getElementById("confirm-modal-overlay").hidden === true);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const cb = doc.getElementById("autosave-enabled-cb");
  check("Checkbox 'Automatisches Speichern' ist deaktiviert (disabled)", cb.disabled === true);
  check("Checkbox ist nicht angehakt", cb.checked === false);
  check("Status-Text erklärt die fehlende Verfügbarkeit", doc.getElementById("autosave-status").textContent.includes("nicht verfügbar"));

  // Interaktionen loesen bewusst KEINEN Auto-Save-Versuch aus (kein
  // Listener registriert, da die Funktion ohnehin nie speichern könnte) -
  // indirekt daran erkennbar, dass sich der Status-Text auch nach
  // mehreren Klicks + Wartezeit nicht mehr ändert.
  const statusBefore = doc.getElementById("autosave-status").textContent;
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(2900);
  check("Status-Text bleibt nach Interaktionen unverändert (kein sinnloser Auto-Save-Versuch)", doc.getElementById("autosave-status").textContent === statusBefore);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PERSISTENTER-SPEICHER-FALLBACK-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
