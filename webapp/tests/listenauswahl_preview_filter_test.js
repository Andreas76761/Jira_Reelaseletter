const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
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

  // Vier Tickets mit unterschiedlichem Typ importieren.
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>LP-1</key><summary>Epic-Ticket</summary><description>Epic-Beschreibung fuer LP-1</description><status>Offen</status><type>Epic</type></item>
    <item><key>LP-2</key><summary>Bug-Ticket</summary><description>Bug-Beschreibung fuer LP-2</description><status>Offen</status><type>Bug</type></item>
    <item><key>LP-3</key><summary>Reporting-Ticket</summary><description>Reporting-Beschreibung fuer LP-3</description><status>Offen</status><type>Reporting</type></item>
    <item><key>LP-4</key><summary>Story-Ticket</summary><description>Story-Beschreibung fuer LP-4</description><status>Offen</status><type>Story</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "lp.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "LP-";
  fire(doc.getElementById("search-input"), "input");
  await wait(250);

  // Alle 4 LP-Tickets per Checkbox auswaehlen.
  ["LP-1", "LP-2", "LP-3", "LP-4"].forEach((key) => {
    const cb = doc.querySelector('input.row-select-checkbox[data-key="' + key + '"]');
    cb.checked = true;
    fire(cb, "click");
  });
  await wait(100);
  check("4 Tickets im Dashboard ausgewaehlt", doc.getElementById("selection-count").textContent.includes("4"));

  // Zur Listenauswahl wechseln.
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  await wait(100);

  check("Listenauswahl: Typ-Schnellfilter-Chips sichtbar (mindestens 'Alle Typen')", doc.getElementById("listenauswahl-type-chips").children.length >= 1);
  const presetBtns = Array.from(doc.querySelectorAll("#listenauswahl-type-presets button[data-preset]"));
  check("Listenauswahl: 4 Presets vorhanden", presetBtns.length === 4);
  check("Listenauswahl-Vorschau zeigt alle 4 ausgewaehlten Tickets ohne Filter", doc.getElementById("listenauswahl-preview-count").textContent.trim() === "4");
  check("Listenauswahl-Vorschau-Gesamt zeigt 4", doc.getElementById("listenauswahl-preview-total").textContent.trim() === "4");
  let previewRows = Array.from(doc.querySelectorAll("#listenauswahl-preview-tbody tr"));
  check("Vorschau-Tabelle hat 4 Zeilen", previewRows.length === 4);
  check("Vorschau-Zeile zeigt Beschreibung (nicht nur Ticket)", previewRows.some((r) => r.textContent.includes("Epic-Beschreibung")));

  // "Ohne Bugs" filtert nur die Vorschau, nicht die Dashboard-Auswahl.
  const noBugBtn = presetBtns.find((b) => b.textContent === "Ohne Bugs");
  fire(noBugBtn, "click");
  await wait(50);
  check("'Ohne Bugs' reduziert Vorschau auf 3", doc.getElementById("listenauswahl-preview-count").textContent.trim() === "3");
  check("'Ohne Bugs' laesst Gesamt-Auswahl (4) unveraendert", doc.getElementById("listenauswahl-preview-total").textContent.trim() === "4");
  previewRows = Array.from(doc.querySelectorAll("#listenauswahl-preview-tbody tr"));
  check("LP-2 (Bug) nicht mehr in Vorschau", !previewRows.some((r) => r.textContent.includes("LP-2")));
  check("'Ohne Bugs'-Button aktiv markiert", noBugBtn.className.includes("active"));

  // Dashboard-Auswahl selbst bleibt unveraendert (Rueckwechsel prüfen).
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  check("Dashboard-Auswahl weiterhin 4 Tickets (Vorschau-Filter wirkt NICHT auf Dashboard)", doc.getElementById("selection-count").textContent.includes("4"));
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  await wait(50);

  // Gefilterte Vorschau als Liste speichern -> nur 3 Tickets im Snapshot.
  doc.getElementById("listenauswahl-name-input").value = "Testliste ohne Bugs";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(100);
  check("Gespeicherte Liste hat 3 Tickets (gefilterte Vorschau, nicht rohe Auswahl)", doc.getElementById("listenauswahl-tbody").textContent.includes("3"));
  check("Gespeicherte Liste zeigt Namen", doc.getElementById("listenauswahl-tbody").textContent.includes("Testliste ohne Bugs"));

  // Preset zuruecksetzen, dann "Nur Epics".
  fire(noBugBtn, "click");
  await wait(50);
  const onlyEpicBtn = presetBtns.find((b) => b.textContent === "Nur Epics");
  fire(onlyEpicBtn, "click");
  await wait(50);
  check("'Nur Epics' zeigt genau 1 Ticket in der Vorschau", doc.getElementById("listenauswahl-preview-count").textContent.trim() === "1");
  check("Speichern-Button bleibt bei 1 gefiltertem Ticket aktiv (nicht disabled)", !doc.getElementById("listenauswahl-save-btn").disabled);

  // Filter, der alle ausblendet -> Speichern-Button disabled, Empty-Hinweis sichtbar.
  fire(onlyEpicBtn, "click"); // aus
  const noReportBtn = presetBtns.find((b) => b.textContent === "Ohne Reporting");
  const noTestBtn = presetBtns.find((b) => b.textContent === "Ohne Testing");
  // Alles bis auf LP-3 (Reporting) ausschliessen, dann zusaetzlich Reporting ausschliessen -> 0 uebrig ist nicht ganz erreichbar mit den 4 Presets allein,
  // stattdessen: "Nur Epics" + danach nochmal draufklicken simuliert leere Menge über Story/Bug/Reporting-Ausschluss.
  fire(noBugBtn, "click");
  fire(noReportBtn, "click");
  await wait(50);
  // Uebrig: LP-1 (Epic), LP-4 (Story) -> 2 Tickets, save button aktiv.
  check("'Ohne Bugs' + 'Ohne Reporting' kombiniert: 2 Tickets uebrig", doc.getElementById("listenauswahl-preview-count").textContent.trim() === "2");
  fire(noTestBtn, "click");
  await wait(50);
  check("Zusaetzlich 'Ohne Testing' (kein Testing-Ticket vorhanden): weiterhin 2 Tickets", doc.getElementById("listenauswahl-preview-count").textContent.trim() === "2");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE LISTENAUSWAHL-VORSCHAU-FILTER-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
