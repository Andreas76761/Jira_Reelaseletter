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
// Die App nutzt statt window.confirm() ein eigenes Modal (sandboxed <iframe>
// wie beim Claude-Artifact kann native Dialoge unterdrücken) - im Test also
// wirklich auf den OK-Button klicken statt window.confirm zu stubben.
async function confirmViaModal(doc) {
  await wait(30);
  const overlay = doc.getElementById("confirm-modal-overlay");
  if (overlay.hidden) throw new Error("Bestätigungs-Modal wurde nicht angezeigt");
  const message = doc.getElementById("confirm-modal-message").textContent;
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(300); // Sanduhr-Verzoegerung im Modal abwarten
  return message;
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Versionsnummer in der Überschrift =====================
  const versionEl = doc.getElementById("app-version");
  check("Versions-Badge in der Überschrift vorhanden", !!versionEl);
  check("Versions-Badge zeigt eine 'v'-Versionsnummer (z. B. v1.1.0)", /^v\d+\.\d+\.\d+$/.test(versionEl.textContent.trim()));
  check("Versions-Badge steht innerhalb der h1-Überschrift", doc.querySelector("h1.app-title #app-version") !== null || doc.querySelector("h1.app-title").contains(versionEl));

  // ===================== Aktion-Spalte + Löschen-Button in Dateiverwaltung =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  const xml1 = `<?xml version="1.0"?><rss><channel>
    <item><key>DEL-ONLY-1</key><summary>Nur in Import 2</summary><status>Offen</status></item>
    <item><key>DEL-SHARED-1</key><summary>Ursprungswert</summary><status>Offen</status></item>
  </channel></rss>`;
  Object.defineProperty(input, "files", { value: [new win.File([xml1], "import2.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);

  const xml2 = `<?xml version="1.0"?><rss><channel>
    <item><key>DEL-SHARED-1</key><summary>Ursprungswert</summary><status>Fertig</status></item>
  </channel></rss>`;
  Object.defineProperty(input, "files", { value: [new win.File([xml2], "import3.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  check("Tabellenkopf hat Spalte 'Aktion'", doc.querySelector("#imports-table thead").textContent.includes("Aktion"));
  const rows = () => Array.from(doc.querySelectorAll("#imports-tbody tr"));
  check("3 Imports vorhanden (Demo + import2 + import3)", rows().length === 3);

  const import2Row = rows().find((r) => r.textContent.includes("import2.xml"));
  check("Löschen-Button in der import2.xml-Zeile vorhanden", !!import2Row.querySelector('button[data-action="delete-import"]'));

  const ticketsBefore = parseInt(doc.getElementById("stat-tickets").textContent, 10);

  // ===================== Import mit ausschließlich eigenem Ticket löschen =====================
  check("Bestätigungs-Modal initial versteckt", doc.getElementById("confirm-modal-overlay").hidden === true);
  fire(import2Row.querySelector('button[data-action="delete-import"]'), "click");
  const confirmMsg = await confirmViaModal(doc);
  check("Bestätigungsdialog wurde angezeigt und erwähnt Quelle/Einschränkung", confirmMsg.includes("import2.xml"));
  check("Bestätigungs-Modal nach Bestätigen wieder versteckt", doc.getElementById("confirm-modal-overlay").hidden === true);

  const ticketsAfter = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Nach Löschen: 2 Imports übrig", rows().length === 2);
  check("Nach Löschen: import2.xml nicht mehr in der Tabelle", !rows().some((r) => r.textContent.includes("import2.xml")));
  check("Ticket, das NUR in import2.xml vorkam, wurde entfernt (Ticketanzahl sinkt um 1)", ticketsAfter === ticketsBefore - 1);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "DEL-ONLY-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  check("DEL-ONLY-1 (nur in gelöschtem Import) ist aus dem Dashboard verschwunden", !doc.getElementById("table-body").textContent.includes("DEL-ONLY-1"));

  doc.getElementById("search-input").value = "DEL-SHARED-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("DEL-SHARED-1 (auch in import3.xml) ist weiterhin vorhanden", doc.getElementById("table-body").textContent.includes("DEL-SHARED-1"));
  check("DEL-SHARED-1 behält den zusammengeführten Status 'Fertig' aus import3.xml", doc.getElementById("table-body").textContent.includes("Fertig"));
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Protokoll-Eintrag zur Löschung =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  check("Protokoll enthält Log-Eintrag zur Import-Löschung", doc.getElementById("log-list").textContent.includes("gelöscht"));

  // ===================== Import-IDs werden nach Löschung nicht wiederverwendet =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xml4 = `<?xml version="1.0"?><rss><channel><item><key>DEL-NEU-1</key><summary>Neu</summary><status>Offen</status></item></channel></rss>`;
  Object.defineProperty(input, "files", { value: [new win.File([xml4], "import4.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importIds = rows().map((r) => r.querySelectorAll("td")[0].textContent.trim());
  check("Import-IDs sind eindeutig (keine Wiederverwendung nach Löschung)", new Set(importIds).size === importIds.length);
  check("Neuer Import bekommt eine höhere ID als alle vorherigen (nie wiederverwendet)", Math.max(...importIds.map(Number)) === Number(importIds[importIds.length - 1]));

  // ===================== Löschen des einzigen/aktiven Imports scoped auf 'Alle Importe' zurück =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const onlyRow = rows()[0];
  fire(onlyRow.querySelector('button[data-action="delete-import"]'), "click");
  await confirmViaModal(doc);
  check("Nach Löschen des einzigen Imports: 0 Tickets, 0 Imports", doc.getElementById("stat-tickets").textContent === "0" && rows().length === 0);
  const importsPanelEmpty = doc.getElementById("format-callout").hidden;
  check("Format-Hinweis bei 0 Imports versteckt (kein irreführender leerer Hinweis)", importsPanelEmpty === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE LOESCH-IMPORT/VERSION-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
