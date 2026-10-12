// Benutzerhandbuch-Kapitel-Generator: automatische KPI-Bewertung direkt
// nach jeder Kapitel-Erzeugung (manualRunKpiEvaluation, s.
// manualGenerateChapters) - ein zusätzlicher, eigener Claude-Aufruf
// bewertet den generierten Text gegen die 3 KPI-Kriterien
// (Quellenabdeckung/Prüf-Erfüllungsquote/Kritische Befunde) und befüllt
// automatisch die Steuerung&KPI-Felder des zugehörigen Kapitels.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
let kpiResponseText = "QUELLENABDECKUNG: 120\nPRUEF_ERFUELLUNGSQUOTE: 72\nKRITISCHE_BEFUNDE: 2\nGATE: Nicht erfüllt\nBEGRUENDUNG: Zwei Aussagen sind nicht belegt.";
let sampleImpl = async (input) => {
  sampleCalls.push(input);
  if (input.indexOf("KPI-Definitionen") !== -1) {
    return { text: kpiResponseText, truncated: false, modelTierApplied: "default" };
  }
  return {
    text: "Dieses Kapitel führt in den Prozess ein. Ein eigener, erkennbarer Beispieltext fürs Kapitel.",
    truncated: false, modelTierApplied: "default",
  };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
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

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>KPI-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
    <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "kpi_eval_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Kapitel erzeugen -> KPI-Aufruf erfolgt automatisch =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  sampleCalls = [];
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);
  await wait(50);

  check("Kapitel erzeugt", doc.getElementById("manual-chapters-list").textContent.includes("Kapitel 7: Verträge im Alltag verwalten"));
  check("Genau 2 Claude-Aufrufe: Generierung + automatische KPI-Bewertung", sampleCalls.length === 2);
  check("Erster Aufruf ist die normale Kapitel-Generierung (kein KPI-Prompt)", sampleCalls[0].indexOf("KPI-Definitionen") === -1);
  check("Zweiter Aufruf ist die KPI-Bewertung (enthält Kapiteltext)", sampleCalls[1].indexOf("KPI-Definitionen") !== -1 && sampleCalls[1].indexOf("eigener, erkennbarer Beispieltext") !== -1);

  // ===================== Steuerung & KPI automatisch befüllt =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="gliederung"]'), "click");
  await wait(30);
  const row = Array.from(doc.querySelectorAll("#outline-steuerung-tbody tr")).find((tr) => tr.textContent.includes("Kapitel 7"));
  check("Steuerung&KPI-Zeile für Kapitel 7 vorhanden", !!row);
  const qa = row && row.querySelector('input[data-field="quellenabdeckung"]');
  const pe = row && row.querySelector('input[data-field="pruefErfuellungsquote"]');
  const kb = row && row.querySelector('input[data-field="kritischeBefunde"]');
  const gate = row && row.querySelector('select[data-field="gate"]');
  check("Quellenabdeckung auf 100 geklemmt (Antwort war 120, außerhalb 0-100)", qa && qa.value === "100");
  check("Prüf-Erfüllungsquote 72 übernommen", pe && pe.value === "72");
  check("Kritische Befunde 2 übernommen", kb && kb.value === "2");
  check("Gate 'Nicht erfüllt' übernommen", gate && gate.value === "Nicht erfüllt");
  check("Protokoll vermerkt die automatische KPI-Bewertung", doc.getElementById("log-list").textContent.includes("KPI-Bewertung aktualisiert"));

  // ===================== Unparsebare Antwort -> keine Werte, kein Absturz =====================
  kpiResponseText = "Entschuldigung, ich kann das nicht bewerten.";
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const domainSelect2 = doc.getElementById("manual-domain-select");
  Array.from(domainSelect2.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect2, "change");
  await wait(30);
  sampleCalls = [];
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(600);
  check("Kein unbehandelter JS-Fehler bei unparsebarer KPI-Antwort", errors.length === 0);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const row2 = Array.from(doc.querySelectorAll("#outline-steuerung-tbody tr")).find((tr) => tr.textContent.includes("Kapitel 7"));
  const gate2 = row2 && row2.querySelector('select[data-field="gate"]');
  check("Bei unparsebarer Antwort bleibt der vorherige Gate-Wert erhalten (kein Überschreiben mit Unsinn)", gate2 && gate2.value === "Nicht erfüllt");

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE KPI-BEWERTUNGS-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
