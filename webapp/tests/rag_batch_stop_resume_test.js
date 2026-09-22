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

// ===================== Steuerbarer sample()-Mock: der ERSTE Aufruf, der
// "Marker-8" enthaelt (= der zweite Batch, s.u.), haengt absichtlich fest
// und wird NIE von selbst aufgeloest - er reagiert ausschliesslich auf das
// AbortSignal (wie ein echter, laufender Claude-Aufruf, der per Stop-Button
// abgebrochen wird). Jeder WEITERE Aufruf mit "Marker-8" (= der Retry nach
// "Fortsetzen") laeuft normal durch. So laesst sich ein Stop mitten im
// Batch-Lauf deterministisch reproduzieren. =====================
const savedFiles = [];
let sampleCalls = [];
let blockNextMarker8Call = true;
let sampleImpl = async (input, opts) => {
  sampleCalls.push(input);
  if (opts && opts.onText) opts.onText({ text: "…", delta: "…" });
  if (input.indexOf("Verschmelze sie zu EINER einzigen") !== -1) {
    return { text: "Finale zusammengeführte Zusammenfassung.", truncated: false, modelTierApplied: "default" };
  }
  if (blockNextMarker8Call && input.includes("Marker-8")) {
    blockNextMarker8Call = false;
    return new Promise((resolve, reject) => {
      if (opts && opts.signal) {
        if (opts.signal.aborted) { reject({ code: "cancelled", message: "aborted" }); return; }
        opts.signal.addEventListener("abort", function () { reject({ code: "cancelled", message: "aborted" }); });
      }
      // wird absichtlich nie resolved - nur per Abbruch (Stop-Button) beendet
    });
  }
  return { text: "Teiltext-Antwort Nr " + sampleCalls.length, truncated: false, modelTierApplied: "default" };
};

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
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
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > (timeoutMs || 4000)) throw new Error("waitUntil: Zeitüberschreitung");
    await wait(20);
  }
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== 16 Tickets, eigene Domain, je 1000 Zeichen Beschreibung
  // -> mit RAG_BATCH_CHAR_BUDGET=9000 deterministisch genau 2 Batches (8+8),
  // wie im bestehenden rag_batch_translate_test.js. =====================
  const longDesc = "X".repeat(1000);
  let items = "";
  for (let i = 0; i < 16; i++) {
    items += `<item><key>STOP-${i}</key><summary>Marker-${i}</summary><description>${longDesc}</description><status>Offen</status><type>Task</type>` +
      `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>StopDomain</customfieldvalue></customfieldvalues></customfield></customfields></item>`;
  }
  const xml = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "stop16.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);

  const domainSelect = doc.getElementById("rag-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "StopDomain"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Extraktion (gefiltert auf StopDomain) zeigt genau 16 Tickets", doc.getElementById("rag-extract-count").textContent === "16");

  // ===================== Generierung starten, Batch 2 haengt fest =====================
  sampleCalls = [];
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await waitUntil(() => sampleCalls.length >= 2, 3000);
  await wait(30);

  check("Genau 2 Claude-Aufrufe gestartet, bevor Batch 2 haengt (Batch 1 fertig + Batch 2 in Arbeit)", sampleCalls.length === 2);
  check("Batch-Bezeichnung im Statushinweis nutzt Format 'Batch 2 von 2' (nicht '2/2')", doc.getElementById("rag-status-note").textContent.includes("Batch 2 von 2"));
  check("Batch-Protokoll-Tabelle ist sichtbar (mehr als 1 Batch)", !doc.getElementById("rag-batch-list-wrap").hidden);
  const batchTbodyText1 = doc.getElementById("rag-batch-tbody").textContent;
  check("Batch-Protokoll zeigt 'Batch 1 von 2' als fertig (✓)", /Batch 1 von 2[\s\S]*?✓ fertig/.test(batchTbodyText1));
  check("Batch-Protokoll zeigt 'Batch 2 von 2' als 'wird verarbeitet'", /Batch 2 von 2[\s\S]*?wird verarbeitet/.test(batchTbodyText1));
  check("Stop-Button sichtbar waehrend Batch-Lauf", !doc.getElementById("rag-stop-btn").hidden);
  check("'Fortsetzen'-Button noch NICHT sichtbar (Lauf noch nicht angehalten)", doc.getElementById("rag-resume-btn").hidden);

  // ===================== ZIP-Zwischenstand (1 fertiger Batch) kann bereits heruntergeladen werden =====================
  check("Batch-ZIP-Button bereits nach 1 fertigem Batch sichtbar", !doc.getElementById("rag-batch-zip-btn").hidden);
  fire(doc.getElementById("rag-batch-zip-btn"), "click");
  await wait(100);
  check("ZIP-Zwischenstand wurde gespeichert", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".zip"));
  if (savedFiles.length === 1) {
    const buf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    const zip = await JSZipNode.loadAsync(buf);
    const names = Object.keys(zip.files);
    check("ZIP-Zwischenstand enthält genau 1 Batch-Datei (Batch 2 noch nicht fertig)", names.length === 1 && names[0] === "RAG-Batch-01-von-2.md");
    const content1 = await zip.files["RAG-Batch-01-von-2.md"].async("string");
    check("Batch-1-MD-Datei nennt 'Batch 1 von 2' und die Teilschritt-Antwort", content1.includes("Batch 1 von 2") && content1.includes("Teiltext-Antwort Nr 1"));
  }
  savedFiles.length = 0;

  // ===================== Stop mitten im Lauf =====================
  fire(doc.getElementById("rag-stop-btn"), "click");
  await waitUntil(() => !doc.getElementById("rag-resume-btn").hidden, 3000);

  check("Statushinweis meldet Anhalten nach 1 von 2 Teilschritten", doc.getElementById("rag-status-note").textContent.includes("Angehalten nach 1 von 2 Teilschritten"));
  check("Stop-Button nach Anhalten wieder versteckt", doc.getElementById("rag-stop-btn").hidden);
  check("'Fortsetzen'-Button nach Anhalten sichtbar", !doc.getElementById("rag-resume-btn").hidden);
  check("Generieren-Buttons nach Anhalten wieder nutzbar (kein Deadlock)", !doc.getElementById("rag-generate-summary-btn").disabled);
  const batchTbodyText2 = doc.getElementById("rag-batch-tbody").textContent;
  check("Batch-Protokoll nach Anhalten: Batch 1 weiterhin fertig, Batch 2 wieder 'ausstehend'", /Batch 1 von 2[\s\S]*?✓ fertig/.test(batchTbodyText2) && /Batch 2 von 2[\s\S]*?ausstehend/.test(batchTbodyText2));

  // ===================== Fortsetzen: darf Batch 1 NICHT erneut abfragen =====================
  const callsBeforeResume = sampleCalls.length;
  fire(doc.getElementById("rag-resume-btn"), "click");
  await waitUntil(() => doc.getElementById("rag-status-note").textContent.includes("zusammengeführt"), 3000);
  await wait(30);

  const marker0Calls = sampleCalls.filter((c) => c.includes("Marker-0")).length;
  check("Batch 1 (Marker-0) wurde nach 'Fortsetzen' NICHT erneut abgefragt (weiterhin genau 1x)", marker0Calls === 1);
  check("Nach 'Fortsetzen' kamen genau 2 weitere Aufrufe hinzu (Batch-2-Retry + Zusammenführung)", sampleCalls.length === callsBeforeResume + 2);
  check("Finaler Output zeigt die zusammengeführte Antwort", doc.getElementById("rag-output").textContent === "Finale zusammengeführte Zusammenfassung.");
  check("Statushinweis nennt Batch-Zusammenführung", doc.getElementById("rag-status-note").textContent.includes("2 Batches zusammengeführt"));
  check("'Fortsetzen'-Button nach Abschluss wieder versteckt", doc.getElementById("rag-resume-btn").hidden);

  // ===================== Tokenverbrauch (Schaetzung) wird am Ende angezeigt =====================
  const tokenText = doc.getElementById("rag-token-usage").textContent;
  check("Tokenverbrauch-Anzeige ist nicht leer", tokenText.trim().length > 0);
  check("Tokenverbrauch-Anzeige nennt 'Geschätzter Tokenverbrauch'", tokenText.includes("Geschätzter Tokenverbrauch"));
  check("Tokenverbrauch-Anzeige weist explizit auf Schätzung hin (keine echte API-Angabe)", tokenText.includes("Schätzung") && tokenText.includes("keine exakte Angabe"));
  check("Tokenverbrauch-Anzeige enthält eine Zahl > 0", /~([\d.]+)\s*Tokens/.test(tokenText) && parseInt(tokenText.match(/~([\d.,]+)\s*Tokens/)[1].replace(/[.,]/g, ""), 10) > 0);
  check("Protokoll vermerkt geschätzte Tokens", doc.getElementById("log-list").textContent.includes("Tokens"));

  // ===================== ZIP nach Abschluss enthält beide Batch-Dateien + Gesamt-Zusammenfassung =====================
  fire(doc.getElementById("rag-batch-zip-btn"), "click");
  await wait(100);
  check("Finales ZIP wurde gespeichert", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".zip"));
  if (savedFiles.length === 1) {
    const buf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    const zip = await JSZipNode.loadAsync(buf);
    const names = Object.keys(zip.files).sort();
    check("Finales ZIP enthält genau 3 Dateien (2 Batches + Gesamt-Zusammenfassung)", names.length === 3);
    check("Finales ZIP enthält beide Batch-Dateien", names.includes("RAG-Batch-01-von-2.md") && names.includes("RAG-Batch-02-von-2.md"));
    check("Finales ZIP enthält die Gesamt-Zusammenfassungs-Datei", names.includes("00_Gesamt-Zusammenfassung.md"));
    const summaryContent = await zip.files["00_Gesamt-Zusammenfassung.md"].async("string");
    check("Gesamt-Zusammenfassungs-Datei enthält den finalen zusammengeführten Text", summaryContent.includes("Finale zusammengeführte Zusammenfassung."));
  }

  // ===================== Einzelaufruf (kein echter Batch-Lauf): Batch-UI bleibt versteckt =====================
  savedFiles.length = 0;
  let smallItems = "";
  for (let i = 0; i < 2; i++) {
    smallItems += `<item><key>SMALL-${i}</key><summary>Kurzticket ${i}</summary><description>Kurze Beschreibung ${i}.</description><status>Offen</status><type>Task</type>` +
      `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>SingleBatchDomain</customfieldvalue></customfieldvalues></customfield></customfields></item>`;
  }
  const xmlSmall = `<?xml version="1.0"?><rss><channel>${smallItems}</channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlSmall], "small2.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  Array.from(doc.getElementById("rag-domain-select").options).forEach((o) => { o.selected = o.value === "SingleBatchDomain"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Kleine Auswahl (eigene Domain) zeigt genau 2 Tickets", doc.getElementById("rag-extract-count").textContent === "2");

  sampleCalls = [];
  fire(doc.getElementById("rag-generate-fliesstext-btn"), "click");
  await waitUntil(() => sampleCalls.length >= 1 && !doc.getElementById("rag-generate-summary-btn").disabled, 3000);
  await wait(30);
  check("Einzelaufruf: genau 1 Claude-Aufruf (kein Batch-Lauf)", sampleCalls.length === 1);
  check("Einzelaufruf: Batch-Protokoll-Tabelle bleibt versteckt", doc.getElementById("rag-batch-list-wrap").hidden);
  check("Einzelaufruf: Batch-ZIP-Button bleibt versteckt", doc.getElementById("rag-batch-zip-btn").hidden);
  check("Einzelaufruf: 'Fortsetzen'-Button bleibt versteckt", doc.getElementById("rag-resume-btn").hidden);
  check("Einzelaufruf: Tokenverbrauch wird dennoch angezeigt", doc.getElementById("rag-token-usage").textContent.includes("Geschätzter Tokenverbrauch"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-BATCH-STOP/FORTSETZEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
