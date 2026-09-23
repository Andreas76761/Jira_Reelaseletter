// Benutzerhandbuch-Kapitel-Generator: Map-Reduce-Teilbatches laufen
// PARALLEL statt sequenziell (Promise.all statt for-await-Schleife) -
// unabhängige Ticket-Teilmengen, daher sicher parallelisierbar. Dieser
// Test erzwingt über drei große Tickets (Zeichen-Budget) drei separate
// Batches, lässt sie mit UNTERSCHIEDLICHEN, absichtlich vertauschten
// Verzögerungen "antworten" und prüft zwei Dinge: (1) die Gesamtlaufzeit
// entspricht der LÄNGSTEN Einzelverzögerung, nicht der Summe aller drei
// (Beweis für echte Parallelität) und (2) die Teiltexte landen trotz
// out-of-order-Fertigstellung in der KORREKTEN Reihenfolge im
// Zusammenführungs-Prompt (Promise.all erhält die Array-Reihenfolge).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const sampleCalls = [];
const resolvedOrder = [];
// Absichtlich vertauschte Verzoegerungen: Batch 1 (MP-1) antwortet am
// LANGSAMSTEN, Batch 3 (MP-3) am SCHNELLSTEN. Bei sequenzieller
// Verarbeitung waere die Fertigstellungsreihenfolge zwangslaeufig 1,2,3
// (Batch 2 startet ja erst NACH Batch 1) - bei paralleler Verarbeitung
// dagegen 3,2,1 (kuerzeste Verzoegerung zuerst fertig).
const DELAYS = { 1: 220, 2: 140, 3: 60 };
let sampleImpl = async (input) => {
  sampleCalls.push(input);
  const m = /MP-([123])/.exec(input);
  if (m) {
    const key = m[1];
    await new Promise((r) => setTimeout(r, DELAYS[key]));
    resolvedOrder.push(key);
    return { text: "TeilAntwort-" + key, truncated: false, modelTierApplied: "default" };
  }
  // Zusammenfuehrungs-Aufruf (enthaelt nur noch die generierten
  // Teiltexte "TeilAntwort-N", keine "MP-"-Marker mehr aus den
  // Ticket-Rohdaten).
  return { text: "SyntheseText", truncated: false, modelTierApplied: "default" };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function () { return Promise.resolve({ status: "saved" }); } });
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
    await wait(15);
  }
  return false;
}

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

  // Drei ~5KB-Beschreibungen - je 2 zusammen ueberschreiten das
  // 9000-Zeichen-Batch-Budget (RAG_BATCH_CHAR_BUDGET), erzwingt daher
  // GENAU 3 Batches (1 Ticket je Batch).
  const pad = (ch) => ch.repeat(5000);
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>MP-A</key><summary>Batch-Marker MP-1</summary>
      <description>${pad("X")}</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>MP-B</key><summary>Batch-Marker MP-2</summary>
      <description>${pad("Y")}</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>MP-C</key><summary>Batch-Marker MP-3</summary>
      <description>${pad("Z")}</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "manual_parallel_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { if (o.value === "Contract Management") o.selected = true; });
  fire(domainSelect, "change");
  await wait(30);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  const opt = Array.from(chapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  opt.selected = true;
  fire(chapterSelect, "change");
  await wait(30);

  const t0 = Date.now();
  fire(doc.getElementById("manual-generate-btn"), "click");
  const ready = await waitUntil(() => {
    const ta = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
    return !!ta && ta.value === "SyntheseText";
  }, 3000);
  const elapsedMs = Date.now() - t0;

  check("Generierung abgeschlossen (Zusammenführungs-Ergebnis sichtbar)", ready);
  check("3 Batch-Aufrufe + 1 Zusammenführungs-Aufruf an sample() gesendet", sampleCalls.length === 4);

  const maxDelay = Math.max(DELAYS[1], DELAYS[2], DELAYS[3]);
  const sumDelays = DELAYS[1] + DELAYS[2] + DELAYS[3];
  check("Gesamtlaufzeit liegt nahe der LÄNGSTEN Einzelverzögerung (" + maxDelay + "ms), nicht nahe der SUMME (" + sumDelays + "ms) – Beweis für echte Parallelität statt sequenzieller Verarbeitung",
    elapsedMs < (maxDelay + sumDelays) / 2);
  check("Fertigstellungsreihenfolge ist NICHT 1,2,3 (das wäre nur bei sequenzieller Verarbeitung zwingend, da Batch 2 sonst erst nach Batch 1 überhaupt starten würde)",
    resolvedOrder.join(",") !== "1,2,3");
  check("Schnellster Batch (MP-3, 60ms) ist tatsächlich zuerst fertig", resolvedOrder[0] === "3");

  const synthesisCall = sampleCalls.find((c) => !/MP-[123]/.test(c));
  check("Zusammenführungs-Prompt vorhanden", !!synthesisCall);
  check("Teiltexte stehen trotz Out-of-order-Fertigstellung in der KORREKTEN Reihenfolge (1, 2, 3) im Zusammenführungs-Prompt",
    !!synthesisCall &&
    synthesisCall.indexOf("Teiltext 1:\nTeilAntwort-1") !== -1 &&
    synthesisCall.indexOf("Teiltext 2:\nTeilAntwort-2") !== -1 &&
    synthesisCall.indexOf("Teiltext 3:\nTeilAntwort-3") !== -1 &&
    synthesisCall.indexOf("Teiltext 1:") < synthesisCall.indexOf("Teiltext 2:") &&
    synthesisCall.indexOf("Teiltext 2:") < synthesisCall.indexOf("Teiltext 3:"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KAPITEL-GENERATOR-BATCH-PARALLELISIERUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
