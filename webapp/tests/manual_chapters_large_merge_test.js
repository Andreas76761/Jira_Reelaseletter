// Kapitel-Generator: mehrstufige Zusammenführung bei SEHR vielen Tickets
// (manualSynthesizePartials). Bugfix-Regressionstest: manualGenerateOneChapter()
// teilt die Ticket-ROHDATEN bereits über chunkRagRows() in zeichen-budgetierte
// Batches auf (RAG_BATCH_CHAR_BUDGET), aber bei vielen Tickets entstehen
// entsprechend viele Teiltexte - wurden ALLE davon roh in EINEN einzigen
// Zusammenführungs-Aufruf gepackt (alter Code), konnte DIESER Aufruf selbst
// wieder "prompt_too_large" auslösen (genau der vom Nutzer gemeldete Fehler
// bei einem stark frequentierten Kapitel mit hunderten Tickets). Der Fix
// (manualSynthesizePartials) verdichtet die Teiltexte bei Bedarf in mehreren
// Zusammenführungs-RUNDEN (Baum statt ein flacher Merge), bis sie in einen
// einzelnen finalen Aufruf passen.
//
// Dieser Test simuliert den Fehler direkt im Mock: jeder Zusammenführungs-
// Aufruf ("Teiltext"-Prompt), dessen Textlänge das Budget überschreitet,
// wirft "prompt_too_large" - identisch zur echten Claude-Artifact-Laufzeit.
// Besteht der Test, wurde KEIN einziger Zusammenführungs-Aufruf jemals zu
// groß gesendet.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const SYNTH_BUDGET = 9000; // muss mit RAG_BATCH_CHAR_BUDGET in der App übereinstimmen
let synthesisCallCount = 0;
let rawBatchCallCount = 0;
let maxSynthesisPromptLen = 0;
let sawPromptTooLarge = false;

let sampleImpl = async (input) => {
  if (input.indexOf("Teiltext 1:") !== -1) {
    synthesisCallCount++;
    maxSynthesisPromptLen = Math.max(maxSynthesisPromptLen, input.length);
    // Simuliert die reale Claude-Artifact-Laufzeit: ein zu langer Prompt
    // wird mit "prompt_too_large" abgelehnt statt beantwortet.
    if (input.length > SYNTH_BUDGET + 2000 /* grosszuegige Toleranz fuer die Anweisungs-/Rollentexte drumherum */) {
      sawPromptTooLarge = true;
      const err = new Error("Prompt zu groß.");
      err.code = "prompt_too_large";
      throw err;
    }
    return { text: "ZUSAMMENGEFUEHRT-" + Math.round(Math.random() * 1e6), truncated: false, modelTierApplied: "default" };
  }
  rawBatchCallCount++;
  // Fester, bewusst "langer" Platzhaltertext je Roh-Batch, damit viele
  // Teiltexte zusammen garantiert das Zusammenführungs-Budget sprengen,
  // wenn sie (Bug) alle auf einmal in EINEN Aufruf gepackt werden.
  return { text: "X".repeat(650), truncated: false, modelTierApplied: "default" };
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
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

// 150 Tickets mit je ca. 800 Zeichen Beschreibung auf DASSELBE reale
// Gliederungskapitel ("Kapitel 4: Servicevertrag anlegen") - bei
// RAG_BATCH_CHAR_BUDGET=9000 ergibt das weit über 10 Roh-Batches, deren
// (feste) Teiltexte zusammen (150 x ~650 Zeichen Platzhalter weit über 9000
// liegen) OHNE den Fix einen einzelnen, zu grossen Zusammenführungs-Aufruf
// erzwingen wuerden.
let items = "";
for (let i = 0; i < 150; i++) {
  items += `<item><key>LM-${i}</key><summary>Servicevertrag anlegen Testfall ${i}</summary>` +
    `<description>${"D".repeat(800)}</description><status>Offen</status><type>Bug</type>` +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>`;
}
const xmlFixture = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;

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
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "lm.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(600);
  check("150 Tickets geladen", doc.getElementById("stat-tickets").textContent === "150");

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect.options).forEach((o) => { o.selected = o.value === "Kapitel 4: Servicevertrag anlegen"; });
  fire(chapterSelect, "change");
  await wait(80);

  fire(doc.getElementById("manual-generate-btn"), "click");
  const finished = await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 15000);
  check("Lauf abgeschlossen (nicht am 15s-Timeout hängen geblieben)", finished);

  check("KEIN Zusammenführungs-Aufruf hat jemals 'prompt_too_large' ausgelöst", sawPromptTooLarge === false);
  check("Mehrere Rohdaten-Batches entstanden (>10, Beweis für chunkRagRows bei 150 Tickets)", rawBatchCallCount > 10);
  check("Zusammenführung lief in MEHREREN Runden (>1 Zusammenführungs-Aufruf statt einem einzelnen flachen Merge)", synthesisCallCount > 1);
  check("JEDER einzelne Zusammenführungs-Aufruf blieb innerhalb des Budgets (+ Toleranz)", maxSynthesisPromptLen <= SYNTH_BUDGET + 2000);

  const chapterCard = Array.from(doc.querySelectorAll("#manual-chapters-list h3, #manual-chapters-list h4, #manual-chapters-list [class*='title']"))
    .find((el) => el.textContent.indexOf("Kapitel 4: Servicevertrag anlegen") !== -1) ||
    (doc.getElementById("manual-chapters-list").textContent.indexOf("Kapitel 4: Servicevertrag anlegen") !== -1 ? true : null);
  check("Kapitel wurde trotz 150 Tickets erfolgreich gespeichert (kein Fehlschlag)", !!chapterCard);
  check("Statuszeile zeigt keinen Fehlschlag-Toast-Text", doc.getElementById("toast").className.indexOf("error") === -1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  console.log("Debug: rawBatchCallCount=" + rawBatchCallCount + " synthesisCallCount=" + synthesisCallCount + " maxSynthesisPromptLen=" + maxSynthesisPromptLen);
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE GROSS-KAPITEL-ZUSAMMENFUEHRUNGS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
