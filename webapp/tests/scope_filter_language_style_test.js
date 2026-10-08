// Erweiterung "Verarbeitung/Massenverarbeitung": (a) Sparte-/Rollen-Filter
// (Labels Pkw/Van/Markt bzw. Retail/Markt/MO/HQ) als zusaetzliche, globale
// Einschraenkung von scopedTickets() - wirkt in Verarbeitung (alle Jobs)
// UND in der Massenverarbeitung (neue Grundlage "Tickets aus Import
// uebernehmen", dieselbe geteilte Datei-/Listen- + Sparte-/Rollen-Auswahl
// wie in der Verarbeitung). (b) Globales Sprachstil-Setting (Einstellungen),
// das die eigentlichen Fliesstext-Prompts (RAG Zusammenfassung/Fliesstext,
// Benutzerhandbuch-Kapitel-Generator) ergaenzt, aber Uebersetzung/Vergleich/
// Qualitaetspruefung/KI-Zuordnung unverändert laesst.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Generierter Text.", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
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
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>SCOPE-1</key><summary>Pkw Retail Ticket</summary><description>Pkw Retail Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>SCOPE-2</key><summary>Van MO Ticket</summary><description>Van MO Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Van</label><label>MO</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>SCOPE-3</key><summary>Markt Ticket</summary><description>Markt Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Markt</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>SCOPE-4</key><summary>Ohne Scope-Label Ticket</summary><description>Ohne Scope-Label Beschreibung.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Vorbereitung: alle Daten löschen, dann genau 4 Test-Tickets importieren =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "scopetest.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("Vorbereitung: genau 4 Tickets geladen", doc.getElementById("stat-tickets").textContent === "4");

  // ===================== (1) Sparte-/Rollen-Filter in der Verarbeitung (scopedTickets()) =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(50);
  const toggleBtn = doc.querySelector("#steps-job-4 .step-toggle");
  fire(toggleBtn, "click");
  await wait(30);

  function scopeCheckbox(jobNum, kind, value) {
    return doc.querySelector('#steps-job-' + jobNum + ' input[name="active-scope-filter-' + jobNum + '"][value="' + kind + ':' + value + '"]');
  }
  check("(1) Sparte-Filter-Checkbox 'Pkw' vorhanden", !!scopeCheckbox(4, "sparte", "Pkw"));
  check("(1) Rolle-Filter-Checkbox 'Retail' vorhanden", !!scopeCheckbox(4, "role", "Retail"));

  const pkwCb = scopeCheckbox(4, "sparte", "Pkw");
  pkwCb.checked = true;
  fire(pkwCb, "change");
  await wait(50);
  check("(1) Sparte-Filter 'Pkw': nur SCOPE-1 (1 Ticket)", doc.getElementById("releaseversion-total").textContent === "1");
  check("(1) Gefilterte Tabelle zeigt SCOPE-1", doc.getElementById("releaseversion-tbody").textContent.includes("SCOPE-1"));

  pkwCb.checked = false;
  fire(pkwCb, "change");
  await wait(30);
  const marktSparteCb = scopeCheckbox(4, "sparte", "Markt");
  marktSparteCb.checked = true;
  fire(marktSparteCb, "change");
  await wait(50);
  check("(1) Sparte-Filter 'Markt': nur SCOPE-3 (1 Ticket)", doc.getElementById("releaseversion-total").textContent === "1");
  check("(1) Gefilterte Tabelle zeigt SCOPE-3", doc.getElementById("releaseversion-tbody").textContent.includes("SCOPE-3"));
  marktSparteCb.checked = false;
  fire(marktSparteCb, "change");
  await wait(30);

  const retailCb = scopeCheckbox(4, "role", "Retail");
  retailCb.checked = true;
  fire(retailCb, "change");
  await wait(50);
  check("(1) Rolle-Filter 'Retail': nur SCOPE-1 (1 Ticket)", doc.getElementById("releaseversion-total").textContent === "1");
  retailCb.checked = false;
  fire(retailCb, "change");
  await wait(30);

  // Kombination Sparte "Van" + Rolle "MO" -> SCOPE-2 hat beide Labels.
  const vanCb = scopeCheckbox(4, "sparte", "Van");
  const moCb = scopeCheckbox(4, "role", "MO");
  vanCb.checked = true; fire(vanCb, "change"); await wait(30);
  moCb.checked = true; fire(moCb, "change"); await wait(50);
  check("(1) Kombinierter Filter Sparte 'Van' + Rolle 'MO': genau SCOPE-2 (1 Ticket)",
    doc.getElementById("releaseversion-total").textContent === "1" && doc.getElementById("releaseversion-tbody").textContent.includes("SCOPE-2"));

  // Geteilter globaler Zustand: Job 5 (Jira Liste) übernimmt denselben Filter.
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  await wait(30);
  check("(1) Job 5 übernimmt denselben Sparte-/Rollen-Filter (ebenfalls 1 Ticket)", doc.getElementById("jiraliste-count").textContent === "1");

  // Protokoll vermerkt den Filter.
  doc.querySelector('.import-tab[data-vsub="protokoll"]').click();
  await wait(30);
  const logText = doc.getElementById("log-list").textContent;
  check("(1) Protokoll vermerkt Sparte-Filter", logText.includes("Sparte: Van"));
  check("(1) Protokoll vermerkt Rollen-Filter", logText.includes("Rolle: MO"));

  // Filter wieder zurücksetzen.
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(30);
  const vanCb2 = scopeCheckbox(4, "sparte", "Van");
  const moCb2 = scopeCheckbox(4, "role", "MO");
  vanCb2.checked = false; fire(vanCb2, "change"); await wait(20);
  moCb2.checked = false; fire(moCb2, "change"); await wait(30);
  check("(1) Nach Zurücksetzen: wieder alle 4 Tickets", doc.getElementById("releaseversion-total").textContent === "4");

  // ===================== (2) Massenverarbeitung: Grundlage "Tickets aus Import übernehmen" =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("(2) Container 'Tickets aus Import übernehmen' vorhanden", !!doc.getElementById("mass-ticket-source-wrap"));
  check("(2) Enthält dieselbe Sparte-/Rollen-Filter-UI", doc.getElementById("mass-ticket-source-wrap").textContent.includes("Sparte-/Rollen-Filter"));
  check("(2) Ticketzahl-Hinweis zeigt 4 (kein Filter aktiv)", doc.getElementById("mass-ticket-source-note").textContent.startsWith("4 "));

  const massRetailCb = doc.querySelector('#mass-ticket-source-wrap input[name="active-scope-filter-mass"][value="role:Retail"]');
  check("(2) Rollen-Filter-Checkbox 'Retail' auch im Massenverarbeitung-Container vorhanden", !!massRetailCb);
  massRetailCb.checked = true;
  fire(massRetailCb, "change");
  await wait(50);
  check("(2) Ticketzahl-Hinweis aktualisiert sich auf 1 (Rollen-Filter 'Retail')", doc.getElementById("mass-ticket-source-note").textContent.startsWith("1 "));

  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(50);
  check("(2) Genau 1 Textschnipsel aus SCOPE-1 übernommen", doc.querySelectorAll("#mass-groups tbody tr").length === 1);
  const groupsHtmlA = doc.getElementById("mass-groups").innerHTML;
  check("(2) Bezeichnung enthält Ticket-Schlüssel SCOPE-1", groupsHtmlA.includes("SCOPE-1"));
  check("(2) Quelle 'Jira-Ticket (Import)' angezeigt", groupsHtmlA.includes("Jira-Ticket (Import)"));
  check("(2) Sparte-/Rollen-Badge 'Retail' angezeigt", groupsHtmlA.includes(">Retail<"));
  check("(2) Sparte-/Rollen-Badge 'Pkw' angezeigt", groupsHtmlA.includes(">Pkw<"));

  // Erneuter Klick (gleicher Filter): Dedup über sourceKey, keine Duplikate.
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(50);
  check("(2) Erneuter Klick: Hinweis 'Nichts Neues'", doc.getElementById("toast").textContent.includes("Nichts Neues"));
  check("(2) Weiterhin genau 1 Zeile (keine Duplikate)", doc.querySelectorAll("#mass-groups tbody tr").length === 1);

  // Filter aufheben, restliche 3 Tickets übernehmen.
  massRetailCb.checked = false;
  fire(massRetailCb, "change");
  await wait(50);
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(50);
  check("(2) Nach Filter-Aufhebung: insgesamt 4 Textschnipsel (restliche 3 hinzugefügt)", doc.querySelectorAll("#mass-groups tbody tr").length === 4);
  check("(2) Toast nennt 3 neu übernommene Tickets", doc.getElementById("toast").textContent.includes("3"));

  // ===================== (3) Globales Sprachstil-Setting =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const styleSelect = doc.getElementById("language-style-select");
  check("(3) Sprachstil-Auswahl vorhanden", !!styleSelect);
  check("(3) Standardwert 'neutral'", styleSelect.value === "neutral");

  styleSelect.value = "freundlich";
  fire(styleSelect, "change");
  await wait(30);
  check("(3) Protokoll vermerkt Sprachstil-Änderung", doc.getElementById("log-list").textContent.includes("Sprachstil"));

  // RAG-Fliesstext-Prompt übernimmt den Sprachstil.
  let lastRagPrompt = null;
  const originalSampleImpl = sampleImpl;
  sampleImpl = async (input, opts) => { lastRagPrompt = input; return { text: "RAG-Testtext.", truncated: false, modelTierApplied: "default" }; };
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(50);
  const ragDomainSelect = doc.getElementById("rag-domain-select");
  Array.from(ragDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await waitUntil(() => lastRagPrompt !== null, 3000);
  check("(3) RAG-Prompt enthält die Sprachstil-Zusatzanweisung ('freundlich')", !!lastRagPrompt && lastRagPrompt.includes("freundlichen, zugänglichen Ton"));

  // Kapitel-Generator-Prompt übernimmt denselben Sprachstil.
  let lastManualPrompt = null;
  sampleImpl = async (input, opts) => { lastManualPrompt = input; return { text: "Kapitel-Testtext.", truncated: false, modelTierApplied: "default" }; };
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => lastManualPrompt !== null, 3000);
  check("(3) Kapitel-Generator-Prompt enthält dieselbe Sprachstil-Zusatzanweisung", !!lastManualPrompt && lastManualPrompt.includes("freundlichen, zugänglichen Ton"));

  // Zurück auf "neutral": keine Zusatzanweisung mehr (Standardverhalten unverändert).
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  doc.getElementById("language-style-select").value = "neutral";
  fire(doc.getElementById("language-style-select"), "change");
  await wait(30);
  lastRagPrompt = null;
  sampleImpl = async (input, opts) => { lastRagPrompt = input; return { text: "RAG-Testtext.", truncated: false, modelTierApplied: "default" }; };
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(30);
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await waitUntil(() => lastRagPrompt !== null, 3000);
  check("(3) Bei 'neutral' (Standard) keine Zusatzanweisung im Prompt", !!lastRagPrompt && !lastRagPrompt.includes("freundlichen, zugänglichen Ton"));
  sampleImpl = originalSampleImpl;

  // Sprachstil wieder auf 'freundlich' fuer die folgenden Sitzungs-Checks.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  doc.getElementById("language-style-select").value = "freundlich";
  fire(doc.getElementById("language-style-select"), "change");
  await wait(30);

  // ===================== (4) Sitzung speichern/laden sichert Filter + Sprachstil =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(4) Export enthält languageStyle 'freundlich'", exportedJson.languageStyle === "freundlich");
  check("(4) Export enthält activeSparteFilter (Array)", Array.isArray(exportedJson.activeSparteFilter));
  check("(4) Export enthält activeRoleFilter (Array)", Array.isArray(exportedJson.activeRoleFilter));

  // Filter erneut setzen, damit der Reset-Test etwas zum Zurücksetzen hat.
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(30);
  const pkwCb2 = scopeCheckbox(4, "sparte", "Pkw");
  pkwCb2.checked = true;
  fire(pkwCb2, "change");
  await wait(30);

  // ===================== (5) 'Alle Daten löschen': Filter werden zurückgesetzt, Sprachstil (Konfiguration) bleibt erhalten =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("(5) Sprachstil bleibt nach 'Alle Daten löschen' erhalten (Konfiguration, kein Sitzungsdatensatz)",
    doc.getElementById("language-style-select").value === "freundlich");

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input2 = doc.getElementById("file-input");
  Object.defineProperty(input2, "files", { value: [new win.File([xml], "scopetest2.xml", { type: "application/xml" })], configurable: true });
  fire(input2, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(30);
  check("(5) Sparte-/Rollen-Filter nach 'Alle Daten löschen' zurückgesetzt (wieder alle 4 Tickets)",
    doc.getElementById("releaseversion-total").textContent === "4");

  // ===================== (6) Sitzung laden stellt Filter + Sprachstil wieder her =====================
  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  check("(6) Sprachstil nach Laden wiederhergestellt", doc.getElementById("language-style-select").value === "freundlich");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE SPARTE-/ROLLEN-FILTER- UND SPRACHSTIL-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
