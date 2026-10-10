// Dateiansicht-FastTrack (Import, Job "Dateiansicht"): drei neue gelbe
// Buttons rechts von "Dateiansicht" - "Übersetzen (Deutsch)", "Als Word
// exportieren", "Datei zusammenfassen". Übersetzen/Zusammenfassen arbeiten
// auf den bereinigten Ticket-Rohdaten der ausgewählten Datei und nutzen
// dieselbe budget-chunkende + reaktiv gegen "prompt_too_large" bisektierende
// Architektur wie der Benutzerhandbuch-Kapitel-Generator. "Datei
// zusammenfassen" öffnet ein neues Fenster (Modal) mit Deutsch/English-Wahl.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const calls = [];
let sampleImpl = async (input) => {
  calls.push(input);
  if (input.indexOf("Übersetze den folgenden Text sinngemäß ins Deutsche") !== -1) {
    return { text: "UEBERSETZT: " + input.slice(-40), truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("Fasse den folgenden Dateiinhalt") !== -1) {
    return { text: "ZUSAMMENFASSUNG-DE", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("Summarize the following file content") !== -1) {
    return { text: "SUMMARY-EN", truncated: false, modelTierApplied: "default" };
  }
  return { text: "UNBEKANNT", truncated: false, modelTierApplied: "default" };
};

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = require("jszip");
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

const xmlFixture = `<?xml version="1.0"?><rss><channel>
  <item><key>FT-1</key><summary>First ticket in English</summary><description>Please check this functionality works correctly.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>FT-2</key><summary>Second ticket in English</summary><description>Another description to translate and summarize.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const delBtn = doc.getElementById("delete-all-data-btn");
  if (delBtn) {
    fire(delBtn, "click");
    await wait(30);
    const okBtn = doc.getElementById("confirm-modal-ok-btn");
    if (okBtn) { fire(okBtn, "click"); await wait(200); }
  }

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "ft.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("2 Tickets geladen", doc.getElementById("stat-tickets").textContent === "2");

  const translateBtn = doc.getElementById("fileview-translate-btn");
  const exportDocxBtn = doc.getElementById("fileview-export-docx-btn");
  const summarizeBtn = doc.getElementById("fileview-summarize-btn");
  check("'Übersetzen'-Button vorhanden und gelb (fasttrack)", !!translateBtn && translateBtn.className.indexOf("fasttrack") !== -1);
  check("'Als Word exportieren'-Button vorhanden und gelb (fasttrack)", !!exportDocxBtn && exportDocxBtn.className.indexOf("fasttrack") !== -1);
  check("'Datei zusammenfassen'-Button vorhanden und gelb (fasttrack)", !!summarizeBtn && summarizeBtn.className.indexOf("fasttrack") !== -1);
  check("Alle 3 FastTrack-Buttons initial deaktiviert (noch keine Datei angezeigt)", translateBtn.disabled && exportDocxBtn.disabled && summarizeBtn.disabled);

  const importSelect = doc.getElementById("fileview-import-select");
  const ftOption = Array.from(importSelect.options).find((o) => o.textContent.indexOf("ft.xml") !== -1);
  check("Import 'ft.xml' in Dateiansicht-Auswahl vorhanden", !!ftOption);
  importSelect.value = ftOption.value;
  fire(importSelect, "change");
  fire(doc.getElementById("fileview-show-btn"), "click");
  await wait(100);

  check("FastTrack-Buttons nach 'Dateiansicht' aktiviert", !translateBtn.disabled && !exportDocxBtn.disabled && !summarizeBtn.disabled);
  check("Original-Ansicht zeigt unübersetzten Text ('ticket in English')", doc.getElementById("fileview-content").textContent.indexOf("in English") !== -1);
  check("Original/Übersetzung-Toggle noch versteckt (keine Übersetzung vorhanden)", doc.getElementById("fileview-original-toggle-wrap").hidden === true);

  // ===================== 1) Übersetzen =====================
  fire(translateBtn, "click");
  const translated = await waitUntil(() => !translateBtn.disabled && doc.getElementById("fileview-original-toggle-wrap").hidden === false, 10000);
  check("Übersetzung abgeschlossen (Toggle erscheint)", translated);
  check("Nach Übersetzen: Ansicht zeigt übersetzten Text (Original automatisch ersetzt)", doc.getElementById("fileview-content").textContent.indexOf("UEBERSETZT:") !== -1);
  check("Kein Fehler-Toast nach Übersetzen", doc.getElementById("toast").className.indexOf("error") === -1);

  const origBtn = doc.getElementById("fileview-view-original-btn");
  const transBtn = doc.getElementById("fileview-view-translated-btn");
  fire(origBtn, "click");
  await wait(50);
  check("Umschalten auf 'Original' zeigt wieder Original-Text", doc.getElementById("fileview-content").textContent.indexOf("in English") !== -1);
  fire(transBtn, "click");
  await wait(50);
  check("Umschalten auf 'Übersetzung' zeigt wieder übersetzten Text", doc.getElementById("fileview-content").textContent.indexOf("UEBERSETZT:") !== -1);

  // ===================== 2) Als Word exportieren =====================
  fire(exportDocxBtn, "click");
  await wait(200);
  check("Word-Export ausgelöst (Erfolgs-Toast, kein Fehler)", doc.getElementById("toast").className.indexOf("error") === -1 &&
    doc.getElementById("toast").textContent.indexOf("Word") !== -1);

  // ===================== 3) Datei zusammenfassen (neues Fenster/Modal) =====================
  const summaryModal = doc.getElementById("fileview-summary-modal-overlay");
  check("Zusammenfassungs-Modal initial versteckt", summaryModal.hidden === true);
  fire(summarizeBtn, "click");
  check("Zusammenfassungs-Modal öffnet sich (neues Fenster)", summaryModal.hidden === false);
  check("Sanduhr (Spinner) sofort nach Klick sichtbar (waehrend der Erzeugung)", doc.getElementById("fileview-summary-spinner").hidden === false);
  check("Export-Buttons waehrend des Ladens noch deaktiviert", doc.getElementById("fileview-summary-export-csv-btn").disabled &&
    doc.getElementById("fileview-summary-export-docx-btn").disabled && doc.getElementById("fileview-summary-export-pdf-btn").disabled);
  await wait(50);
  const summaryLoaded = await waitUntil(() => doc.getElementById("fileview-summary-output").textContent === "ZUSAMMENFASSUNG-DE", 10000);
  check("Deutsche Zusammenfassung wird automatisch geladen (Standard)", summaryLoaded);
  check("'Deutsch'-Tab initial aktiv", doc.getElementById("fileview-summary-lang-de-btn").className.indexOf("active") !== -1);
  check("Sanduhr nach Abschluss wieder versteckt", doc.getElementById("fileview-summary-spinner").hidden === true);
  check("Export-Buttons nach erfolgreicher Erzeugung aktiviert", !doc.getElementById("fileview-summary-export-csv-btn").disabled &&
    !doc.getElementById("fileview-summary-export-docx-btn").disabled && !doc.getElementById("fileview-summary-export-pdf-btn").disabled);

  // ===================== 3b) Export der Zusammenfassung als CSV/Word/PDF =====================
  // Regression: diese Export-Buttons teilen sich optisch die .job-export-btn-
  // Klasse mit den Verarbeitung-Job-Exports, duerfen aber NICHT vom dortigen
  // generischen data-job-Handler abgefangen werden (sonst erscheint
  // faelschlich "Noch nicht verfügbar" statt des echten Exports).
  savedFiles.length = 0;
  fire(doc.getElementById("fileview-summary-export-csv-btn"), "click");
  await wait(100);
  check("CSV-Export der Zusammenfassung ausgeloest", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".csv"));
  check("CSV-Export zeigt KEINEN 'Noch nicht verfügbar'-Fehltoast (Regression)", doc.getElementById("toast").textContent.indexOf("Noch nicht verfügbar") === -1);

  savedFiles.length = 0;
  fire(doc.getElementById("fileview-summary-export-docx-btn"), "click");
  await wait(100);
  check("Word-Export der Zusammenfassung ausgeloest", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".docx"));
  check("Word-Export der Zusammenfassung zeigt KEINEN 'Noch nicht verfügbar'-Fehltoast (Regression)", doc.getElementById("toast").textContent.indexOf("Noch nicht verfügbar") === -1);

  savedFiles.length = 0;
  fire(doc.getElementById("fileview-summary-export-pdf-btn"), "click");
  await wait(100);
  check("PDF-Export der Zusammenfassung ausgeloest", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".pdf"));
  check("PDF-Export der Zusammenfassung zeigt KEINEN 'Noch nicht verfügbar'-Fehltoast (Regression)", doc.getElementById("toast").textContent.indexOf("Noch nicht verfügbar") === -1);

  const enBtn = doc.getElementById("fileview-summary-lang-en-btn");
  fire(enBtn, "click");
  const enLoaded = await waitUntil(() => doc.getElementById("fileview-summary-output").textContent === "SUMMARY-EN", 10000);
  check("Nach Klick auf 'English': englische Zusammenfassung geladen", enLoaded);
  check("'English'-Tab jetzt aktiv", enBtn.className.indexOf("active") !== -1);

  const deBtn = doc.getElementById("fileview-summary-lang-de-btn");
  const callsBeforeToggleBack = calls.length;
  fire(deBtn, "click");
  await wait(100);
  check("Zurück zu 'Deutsch': zeigt gecachte deutsche Zusammenfassung sofort", doc.getElementById("fileview-summary-output").textContent === "ZUSAMMENFASSUNG-DE");
  check("Kein erneuter KI-Aufruf beim Zurückschalten (Sprach-Cache)", calls.length === callsBeforeToggleBack);

  fire(doc.getElementById("fileview-summary-modal-close"), "click");
  await wait(50);
  check("Modal nach Schließen-Button wieder versteckt", summaryModal.hidden === true);

  // Escape schliesst Modal ebenfalls
  fire(summarizeBtn, "click");
  await wait(50);
  check("Modal erneut geöffnet", summaryModal.hidden === false);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(50);
  check("Escape schliesst Zusammenfassungs-Modal", summaryModal.hidden === true);

  // ===================== Reset-Verhalten =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(30);
  const okBtn2 = doc.getElementById("confirm-modal-ok-btn");
  if (okBtn2) { fire(okBtn2, "click"); await wait(300); }
  check("Nach 'Sitzung zurücksetzen': Dateiansicht wieder versteckt", doc.getElementById("fileview-wrap").hidden === true);
  check("Nach 'Sitzung zurücksetzen': FastTrack-Buttons wieder deaktiviert", translateBtn.disabled && exportDocxBtn.disabled && summarizeBtn.disabled);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DATEIANSICHT-FASTTRACK-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
