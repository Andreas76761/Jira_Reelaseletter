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

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
// Eigenes Bestätigungs-Modal statt window.confirm() (siehe ticket_cockpit.html) -
// im Test also wirklich auf OK bzw. Abbrechen klicken statt confirm zu stubben.
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(300);
}
async function cancelViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-cancel-btn"), "click");
  await wait(30);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Navigation + Sidebar =====================
  check("Sidebar hat 'Einstellungen'-Eintrag unter 'Hilfe'", !!doc.querySelector('.nav-item[data-view="einstellungen"]'));
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  check("Einstellungen-Panel sichtbar nach Klick", !doc.querySelector('[data-view-panel="einstellungen"]').hidden);

  // Zusatz-Daten importieren, damit "Loeschen" sichtbar etwas tut
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  const xml = fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "nachtrag.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const ticketsBefore = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  const importsBefore = parseInt(doc.getElementById("stat-imports").textContent, 10);
  check("Ticket-Anzahl in Einstellungen stimmt mit Header ueberein", parseInt(doc.getElementById("settings-current-tickets").textContent, 10) === ticketsBefore);
  check("Import-Anzahl in Einstellungen stimmt mit Header ueberein", parseInt(doc.getElementById("settings-current-imports").textContent, 10) === importsBefore);
  check("Vor Loeschen: mehr als 0 Tickets geladen", ticketsBefore > 0);

  // ===================== Abbruch bei Klick auf 'Abbrechen' aendert nichts =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await cancelViaModal(doc);
  check("Bestätigungs-Modal wurde angezeigt und ist nach Abbrechen wieder versteckt", doc.getElementById("confirm-modal-overlay").hidden === true);
  check("Bei Abbruch: Ticket-Anzahl unveraendert", parseInt(doc.getElementById("stat-tickets").textContent, 10) === ticketsBefore);
  check("Bei Abbruch: Import-Anzahl unveraendert", parseInt(doc.getElementById("stat-imports").textContent, 10) === importsBefore);

  // ===================== Tatsaechliches Loeschen =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  await wait(50);
  check("Nach Loeschen: 0 Tickets (NICHT auf Ausgangsdaten zurueckgesetzt)", doc.getElementById("stat-tickets").textContent === "0");
  check("Nach Loeschen: 0 Imports", doc.getElementById("stat-imports").textContent === "0");
  check("Nach Loeschen: 0 Aenderungen", doc.getElementById("stat-changes").textContent === "0");
  check("Einstellungen-Anzeige zeigt ebenfalls 0/0", doc.getElementById("settings-current-tickets").textContent === "0" && doc.getElementById("settings-current-imports").textContent === "0");

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  check("Dashboard-Tabelle zeigt Empty-State", doc.getElementById("empty-state").hidden === false);
  check("Dashboard-Tabelle hat keine Zeilen", doc.querySelectorAll("#table-body tr").length === 0);

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  check("Dateiverwaltung: Imports-Tabelle leer", doc.querySelectorAll("#imports-tbody tr").length === 0);
  check("Dateiverwaltung: Changes-Tabelle leer / Hinweis sichtbar", doc.getElementById("changes-empty").hidden === false);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="protokoll"]').click();
  check("Verarbeitung-Protokoll enthaelt den Loesch-Log-Eintrag", doc.getElementById("log-list").textContent.includes("Alle geladenen Daten gelöscht"));

  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  check("Job 5 Jira-Liste zeigt 0 nach Loeschen", doc.getElementById("jiraliste-count").textContent === "0");

  doc.querySelector('.nav-item[data-view="import"]').click();
  check("Format-Hinweis ('zuletzt importiert') ist bei 0 Imports versteckt (kein irrefuehrender leerer Hinweis)", doc.getElementById("format-callout").hidden === true);

  // Ohne Daten: Button zeigt Hinweis statt Bestätigungs-Modal
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await wait(50);
  check("Erneuter Klick ohne Daten zeigt Hinweis statt Bestätigungs-Modal", doc.getElementById("confirm-modal-overlay").hidden === true && doc.getElementById("toast").className.includes("error"));

  // ===================== Danach: normaler Import funktioniert weiterhin =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xml], "nachtrag2.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("Nach Loeschen ist ein neuer Import weiterhin moeglich (1 Ticket)", doc.getElementById("stat-tickets").textContent === "1");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE EINSTELLUNGEN-LOESCH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
