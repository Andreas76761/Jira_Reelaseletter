const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
let sampleImpl = async (input, opts) => {
  sampleCalls.push(input);
  if (opts && opts.onText) opts.onText({ text: "…", delta: "…" });
  if (input.indexOf("Übersetze den folgenden deutschen Text") === 0) {
    return { text: "This is the translated text.", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("Verschmelze sie zu EINER einzigen") !== -1) {
    return { text: "Finale zusammengeführte Zusammenfassung.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "Teiltext-Antwort Nr " + sampleCalls.length, truncated: false, modelTierApplied: "default" };
};

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function () { return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
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

  // ===================== 16 Tickets mit langer Beschreibung importieren (eigene Domain, damit
  // sich die Extraktion praezise darauf eingrenzen laesst) - jede Beschreibung genau 1000 Zeichen,
  // damit sich bei RAG_BATCH_CHAR_BUDGET=9000 deterministisch genau 2 Batches (8+8) ergeben. =====================
  // ragBuildPrompt() nimmt nur Domäne/Status/Überschrift/Beschreibung in den Prompt auf (keinen
  // Ticket-Key) - daher braucht jedes Ticket eine eindeutige Überschrift ("Marker-N"), um Batches
  // im Prompt-Text unterscheidbar zu machen.
  const longDesc = "X".repeat(1000);
  let batchItems = "";
  for (let i = 0; i < 16; i++) {
    batchItems += `<item><key>BATCH-${i}</key><summary>Marker-${i}</summary><description>${longDesc}</description><status>Offen</status><type>Task</type>` +
      `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>BatchDomain</customfieldvalue></customfieldvalues></customfield></customfields></item>`;
  }
  const xmlBatch = `<?xml version="1.0"?><rss><channel>${batchItems}</channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlBatch], "batch16.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);

  const domainSelect = doc.getElementById("rag-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "BatchDomain"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Extraktion (gefiltert auf BatchDomain) zeigt genau 16 Tickets", doc.getElementById("rag-extract-count").textContent === "16");

  sampleCalls = [];
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(200);
  check("Batch-Verarbeitung: genau 3 Claude-Aufrufe (2 Batches à 8 Tickets + 1 Zusammenführung)", sampleCalls.length === 3);
  check("Batch 1 enthält Marker-0, aber nicht Marker-15 (getrennte Batches)", sampleCalls[0] && sampleCalls[0].includes("Marker-0") && !sampleCalls[0].includes("Marker-15"));
  check("Batch 2 enthält Marker-15, aber nicht Marker-0", sampleCalls[1] && sampleCalls[1].includes("Marker-15") && !sampleCalls[1].includes("Marker-0"));
  check("Zusammenführungs-Prompt referenziert 'Teiltext 1' und 'Teiltext 2'", sampleCalls[2].includes("Teiltext 1:") && sampleCalls[2].includes("Teiltext 2:"));
  check("Zusammenführungs-Prompt enthält beide Batch-Antworten", sampleCalls[2].includes("Teiltext-Antwort Nr 1") && sampleCalls[2].includes("Teiltext-Antwort Nr 2"));
  check("Finaler Output zeigt die zusammengeführte Antwort (nicht nur einen Teiltext)", doc.getElementById("rag-output").textContent === "Finale zusammengeführte Zusammenfassung.");
  check("Statushinweis nennt Batch-Zusammenführung", doc.getElementById("rag-status-note").textContent.includes("2 Batches zusammengeführt"));
  check("Protokoll vermerkt Batches", doc.getElementById("log-list").textContent.includes("2 Batches"));

  // ===================== Übersetzen-Button: Deutsch -> Englisch -> zurück (kein 2. API-Call) =====================
  check("'Übersetzen'-Button nach Generierung aktiviert", !doc.getElementById("rag-translate-btn").disabled);
  sampleCalls = [];
  fire(doc.getElementById("rag-translate-btn"), "click");
  await wait(150);
  check("Übersetzung ausgelöst genau 1 Claude-Aufruf", sampleCalls.length === 1);
  check("Übersetzungs-Prompt enthält den deutschen Originaltext", sampleCalls[0].includes("Finale zusammengeführte Zusammenfassung."));
  check("Ausgabe zeigt übersetzten Text", doc.getElementById("rag-output").textContent === "This is the translated text.");
  check("Button-Beschriftung wechselt zu 'Zurück zu Deutsch'", doc.getElementById("rag-translate-btn").textContent === "Zurück zu Deutsch");
  check("Statushinweis kennzeichnet Übersetzung", doc.getElementById("rag-status-note").textContent.includes("übersetzt"));

  fire(doc.getElementById("rag-translate-btn"), "click");
  await wait(100);
  check("Zurückschalten löst KEINEN weiteren Claude-Aufruf aus (weiterhin genau 1)", sampleCalls.length === 1);
  check("Ausgabe zeigt wieder den deutschen Originaltext", doc.getElementById("rag-output").textContent === "Finale zusammengeführte Zusammenfassung.");
  check("Button-Beschriftung wieder 'Übersetzen (Englisch)'", doc.getElementById("rag-translate-btn").textContent === "Übersetzen (Englisch)");

  // ===================== Download-Dateiname/Inhalt beruecksichtigt Sprache =====================
  fire(doc.getElementById("rag-translate-btn"), "click");
  await wait(150);
  // (jetzt wieder Englisch, 2. Claude-Aufruf fuer diesen Teil erwartet)
  check("Erneutes Übersetzen loest wieder genau 1 zusaetzlichen Aufruf aus (insgesamt 2)", sampleCalls.length === 2);

  // ===================== Neue Generierung setzt Übersetzungs-Zustand zurueck =====================
  sampleCalls = [];
  fire(doc.getElementById("rag-generate-fliesstext-btn"), "click");
  await wait(100);
  check("Nach neuer Generierung: Ausgabe wieder auf Deutsch (kein Alt-Zustand der Übersetzung)", doc.getElementById("rag-output").textContent !== "This is the translated text.");
  check("Nach neuer Generierung: 'Übersetzen'-Button-Text zurückgesetzt", doc.getElementById("rag-translate-btn").textContent === "Übersetzen (Englisch)");

  // ===================== Obergrenze: > 10000 Tickets werden clientseitig abgelehnt (kein API-Call) =====================
  let capItems = "";
  for (let i = 0; i < 9500; i++) {
    capItems += `<item><key>CAP-${i}</key><summary>Cap-Ticket ${i}</summary><description>Kurz ${i}</description><status>Offen</status><type>Task</type></item>`;
  }
  const xmlCap = `<?xml version="1.0"?><rss><channel>${capItems}</channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlCap], "cap9500.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  // Grosszuegige Wartezeit: das Einlesen/Aufbereiten von ~9500 zusaetzlichen
  // Tickets (insgesamt >10000 mit den Demo-/Batch-Tickets) braucht spuerbar
  // laenger als die kleinen Fixtures anderswo in dieser Datei.
  await wait(4000);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  Array.from(doc.getElementById("rag-domain-select").options).forEach((o) => { o.selected = false; });
  Array.from(doc.getElementById("rag-status-select").options).forEach((o) => { o.selected = false; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(300);
  const extractedTotal = parseInt(doc.getElementById("rag-extract-count").textContent, 10);
  check("Gesamtauswahl liegt jetzt über der 10000er-Grenze (663 Demo + 16 + 9500)", extractedTotal > 10000);
  check("Extraktion selbst zeigt bereits proaktiv den Hinweis auf die 10000er-Grenze", doc.getElementById("rag-status-note").textContent.includes("maximal 10000 Tickets"));

  sampleCalls = [];
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(150);
  check("Über 10000 Tickets: Generierung wird clientseitig abgelehnt, KEIN Claude-Aufruf", sampleCalls.length === 0);
  check("Fehlermeldung nennt die 10000er-Grenze", doc.getElementById("rag-status-note").textContent.includes("Maximal 10000"));
  check("Buttons nach Ablehnung weiterhin nutzbar (kein Deadlock)", !doc.getElementById("rag-generate-summary-btn").disabled);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-BATCH/ÜBERSETZUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
