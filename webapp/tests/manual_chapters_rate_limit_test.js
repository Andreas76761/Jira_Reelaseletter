// Regressionstest für einen von einem Nutzer gemeldeten Fehler: bei einem
// Kapitel mit vielen Tickets (viele Zeichen-Budget-Teil-Batches, s.
// chunkRagRows) führte die volle Parallelisierung ALLER Batches
// (Promise.all, v2.32.0) dazu, dass die Claude-Artifact-Laufzeit einzelne
// gleichzeitige Aufrufe mit "rate_limited" ablehnte ("Zu viele Anfragen -
// bitte später erneut versuchen."), statt das Kapitel fertigzustellen.
// Behoben durch (1) eine Obergrenze für GLEICHZEITIG laufende Batches
// (MANUAL_BATCH_CONCURRENCY, mapWithConcurrency statt Promise.all) und (2)
// automatische Wiederholung mit Backoff NUR für den Fehlercode
// "rate_limited" (sampleWithRateLimitRetry). Prüft: (A) die Anzahl
// gleichzeitig laufender Batch-Aufrufe überschreitet die Obergrenze nie,
// bei mehr Batches als die Obergrenze aber auch tatsächlich ausgeschöpft
// wird (kein Rückfall auf sequenziell), (B) ein einzelner transienter
// "rate_limited"-Fehler wird automatisch wiederholt und das Kapitel
// trotzdem erfolgreich fertiggestellt, (C) nach Ausschöpfen aller
// Wiederholungen wird der Fehler ehrlich gemeldet (kein Endlos-Retry,
// keine Vortäuschung eines Erfolgs), (D) "Abbrechen" während einer
// Backoff-Wartezeit reagiert sofort statt die volle Wartezeit
// abzuwarten.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "unset", truncated: false, modelTierApplied: "default" });
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
    await wait(20);
  }
  return false;
}
const pad = (ch) => ch.repeat(5000);
function batchXml(n, prefix) {
  let items = "";
  for (let i = 1; i <= n; i++) {
    items += `<item><key>${prefix}-${i}</key><summary>Marker-${prefix}-${i}</summary>` +
      `<description>${pad(String(i))}</description><status>Offen</status><type>Task</type>` +
      `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>`;
  }
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}
async function setupChapter(doc, win, n, prefix) {
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([batchXml(n, prefix)], prefix + ".xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(30);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  const opt = Array.from(chapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  if (opt) opt.selected = true;
  fire(chapterSelect, "change");
  await wait(30);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== (A) Begrenzte Parallelität bei vielen Batches =====================
  await setupChapter(doc, win, 5, "CC");
  let inFlight = 0, maxInFlight = 0;
  const callTimestamps = [];
  sampleImpl = async (input) => {
    const m = /Marker-CC-(\d)/.exec(input);
    if (m) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      callTimestamps.push(Date.now());
      await wait(150);
      inFlight--;
      return { text: "TeilAntwort-" + m[1], truncated: false, modelTierApplied: "default" };
    }
    return { text: "SyntheseText-A", truncated: false, modelTierApplied: "default" };
  };
  fire(doc.getElementById("manual-generate-btn"), "click");
  const doneA = await waitUntil(() => {
    const ta = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
    return !!ta && ta.value === "SyntheseText-A";
  }, 5000);
  check("(A) Generierung mit 5 Teil-Batches erfolgreich abgeschlossen", doneA);
  check("(A) Nie mehr als 3 Batches gleichzeitig in Bearbeitung (Obergrenze eingehalten)", maxInFlight <= 3);
  check("(A) Obergrenze wird tatsächlich ausgeschöpft (nicht auf sequenziell zurückgefallen)", maxInFlight === 3);

  // ===================== (B) Transienter rate_limited-Fehler wird automatisch wiederholt =====================
  await setupChapter(doc, win, 1, "RL1");
  let rl1Attempts = 0;
  sampleImpl = async (input) => {
    if (/Marker-RL1-1/.test(input)) {
      rl1Attempts++;
      if (rl1Attempts === 1) { const err = new Error("Rate limited"); err.code = "rate_limited"; throw err; }
      return { text: "ErfolgNachRetry", truncated: false, modelTierApplied: "default" };
    }
    return { text: "SyntheseText-B", truncated: false, modelTierApplied: "default" };
  };
  fire(doc.getElementById("manual-generate-btn"), "click");
  const doneB = await waitUntil(() => {
    const ta = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
    return !!ta && ta.value === "ErfolgNachRetry";
  }, 5000);
  check("(B) Nach einem einzelnen transienten rate_limited-Fehler trotzdem erfolgreich (automatischer Retry)", doneB);
  check("(B) Genau 2 Versuche für diesen einen Batch (1 fehlgeschlagen + 1 erfolgreicher Retry)", rl1Attempts === 2);
  const toastB = doc.getElementById("toast");
  check("(B) Kein Fehler-Toast trotz des zwischenzeitlichen rate_limited-Fehlers", !toastB.className.includes("error"));

  // ===================== (C) Nach Ausschöpfen aller Wiederholungen: ehrlicher Fehler =====================
  await setupChapter(doc, win, 1, "RL2");
  let rl2Attempts = 0;
  sampleImpl = async (input) => {
    if (/Marker-RL2-1/.test(input)) {
      rl2Attempts++;
      const err = new Error("Rate limited");
      err.code = "rate_limited";
      throw err;
    }
    return { text: "SyntheseText-C", truncated: false, modelTierApplied: "default" };
  };
  fire(doc.getElementById("manual-generate-btn"), "click");
  const failedC = await waitUntil(() => doc.getElementById("toast").className.includes("error"), 6000);
  check("(C) Nach dauerhaftem rate_limited erscheint ein Fehler-Toast (kein stiller/endloser Retry)", failedC);
  const toastC = doc.getElementById("toast");
  check("(C) Fehlermeldung nennt den verständlichen Rate-Limit-Hinweis", toastC.textContent.includes("Zu viele Anfragen"));
  check("(C) Genau 3 Versuche (1 initial + 2 Wiederholungen), dann aufgegeben", rl2Attempts === 3);

  // ===================== (D) Abbrechen während einer Backoff-Wartezeit reagiert sofort =====================
  await setupChapter(doc, win, 1, "RL3");
  sampleImpl = async (input) => {
    if (/Marker-RL3-1/.test(input)) {
      const err = new Error("Rate limited");
      err.code = "rate_limited";
      throw err;
    }
    return { text: "SyntheseText-D", truncated: false, modelTierApplied: "default" };
  };
  const tD0 = Date.now();
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(200); // erster Versuch ist sicher schon fehlgeschlagen, Backoff-Wartezeit (1500ms) laeuft
  fire(doc.getElementById("manual-stop-btn"), "click");
  const stoppedD = await waitUntil(() => doc.getElementById("manual-status-note").textContent === "Abgebrochen.", 1200);
  const elapsedD = Date.now() - tD0;
  check("(D) 'Abbrechen' während einer Rate-Limit-Backoff-Pause wirkt zeitnah", stoppedD);
  check("(D) Deutlich schneller als die volle Backoff-Wartezeit (1500ms) abzuwarten", elapsedD < 1400);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KAPITEL-GENERATOR-RATE-LIMIT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
