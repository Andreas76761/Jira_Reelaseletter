const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name !== "downloads") return Promise.resolve(null);
        return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>SESS-1</key><summary>Sitzungstest Eins</summary><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Sitzungsdomäne</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>SESS-2</key><summary>Sitzungstest Zwei</summary><status>Fertig</status><type>Task</type></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Vorbereitung: eigenen Zustand aufbauen =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "sessiontest.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // Eine Listenauswahl anlegen.
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "SESS-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const cb = doc.querySelector("#table-body .row-select-checkbox");
  if (cb) { cb.checked = true; fire(cb, "click"); }
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  await wait(100);
  doc.getElementById("listenauswahl-name-input").value = "Vor-Speichern-Liste";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(100);

  // Eine Domänenfarbe anpassen (Einstellungen/Farbschema).
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const domainInput = doc.querySelector('.domaincolor-input[data-domain="Sitzungsdomäne"]');
  if (domainInput) { domainInput.value = "#123456"; fire(domainInput, "change"); await wait(100); }

  const ticketCountBefore = doc.getElementById("stat-tickets").textContent;
  const importCountBefore = doc.getElementById("settings-current-imports").textContent;

  // ===================== Export =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(300);
  check("Sitzung wurde als Datei 'gespeichert' (downloads-Capability aufgerufen)", savedFiles.length === 1);
  check("Exportierte Datei endet auf .json", savedFiles.length && /\.json$/.test(savedFiles[0].filename));
  let exportedJson = null;
  if (savedFiles.length) {
    exportedJson = JSON.parse(savedFiles[0].data);
    check("Export enthält ticketStoreEntries (Ticket-Daten)", Array.isArray(exportedJson.ticketStoreEntries) && exportedJson.ticketStoreEntries.length >= 2);
    check("Export enthält die gespeicherte Liste 'Vor-Speichern-Liste'", exportedJson.savedLists.some((l) => l.name === "Vor-Speichern-Liste"));
    check("Export enthält die angepasste Domänenfarbe", exportedJson.domainColors["Sitzungsdomäne"] === "#123456");
  }

  // ===================== Alles löschen, dann aus der exportierten Datei wiederherstellen =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("Nach 'Alle Daten löschen': 0 Tickets", doc.getElementById("settings-current-tickets").textContent === "0");

  // Sitzungsdatei laden (kein Bestätigungsdialog noetig, da aktuell 0 Tickets).
  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);

  check("Nach Laden: Tickets wiederhergestellt (identische Anzahl wie vor dem Export)", doc.getElementById("stat-tickets").textContent === ticketCountBefore);
  check("Nach Laden: Imports wiederhergestellt", doc.getElementById("settings-current-imports").textContent === importCountBefore);

  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  await wait(100);
  check("Nach Laden: gespeicherte Liste 'Vor-Speichern-Liste' wieder vorhanden", doc.getElementById("listenauswahl-tbody").textContent.includes("Vor-Speichern-Liste"));

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const restoredDomainInput = doc.querySelector('.domaincolor-input[data-domain="Sitzungsdomäne"]');
  check("Nach Laden: Domänenfarbe wiederhergestellt", !!restoredDomainInput && restoredDomainInput.value.toLowerCase() === "#123456");

  // ===================== Sicherheitsabfrage beim Laden ueber bereits vorhandene Daten =====================
  const sessionFile2 = new win.File([JSON.stringify(exportedJson)], "session2.json", { type: "application/json" });
  Object.defineProperty(sessionInput, "files", { value: [sessionFile2], configurable: true });
  fire(sessionInput, "change");
  await wait(100);
  check("Beim Laden ueber bestehende Daten erscheint eine Sicherheitsabfrage", doc.getElementById("confirm-modal-overlay").hidden === false);
  fire(doc.getElementById("confirm-modal-cancel-btn"), "click");
  await wait(100);

  // ===================== Ungültige Datei zeigt Fehlermeldung statt Absturz =====================
  const badFile = new win.File(["{ nicht valides JSON"], "bad.json", { type: "application/json" });
  Object.defineProperty(sessionInput, "files", { value: [badFile], configurable: true });
  const errCountBefore = errors.length;
  fire(sessionInput, "change");
  await wait(200);
  check("Ungültige Sitzungsdatei loest keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE SITZUNG-SPEICHERN/LADEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
