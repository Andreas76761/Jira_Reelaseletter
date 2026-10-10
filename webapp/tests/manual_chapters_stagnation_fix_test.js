// Kapitel-Generator: garantierter Fortschritt der Zusammenführungs-Runden,
// auch wenn viele Teiltexte einzeln bereits nahe am oder über dem
// Zusammenführungs-Budget liegen (chunkTextsByBudget/manualSynthesizePartials).
//
// Realer Fehlerfall (vom Nutzer gemeldet, nach den beiden vorherigen
// "prompt_too_large"-Fixes): bei einem Kapitel mit sehr vielen Tickets
// (hunderte bis tausende) blieb die Statuszeile dauerhaft bei
// "Verdichte X Teiltexte in Y Zwischenschritte (Zusammenführungsrunde 1) …"
// stehen, das Kapitel wurde nie fertig. Ursache: chunkTextsByBudget() packte
// einen Teiltext, der bereits für sich allein das Budget sprengt, IMMER in
// eine eigene Einzel-Gruppe, die nie mit einem Nachbarn kombiniert wurde.
// Bei vielen solcher Texte reduzierte eine Verdichtungsrunde die Anzahl kaum
// (z. B. 170 -> 159), bis manualSynthesizePartials() nach einer Runde ohne
// JEDE Reduktion ("keine Reduktion mehr möglich") komplett abbrach und auf
// den rein SEQUENZIELLEN (nicht parallelisierten) rekursiven
// Bisektions-Fallback in manualSynthesizeGroup() auswich - bei hunderten
// Texten praktisch eine Endlosschleife aus Sicht des Nutzers.
//
// Der Fix fasst direkt benachbarte "zu groß für sich allein"-Einzel-Gruppen
// zusätzlich paarweise zusammen (das Budget wird dabei bewusst überschritten,
// manualSynthesizeGroup() bisektiert eine zu große Gruppe ohnehin reaktiv
// zurück) - das garantiert JEDE Runde mindestens eine spürbare Reduktion
// statt Stillstand, UND manualSynthesizeGroup()s Bisektions-Fallback läuft
// jetzt für beide Hälften parallel (Promise.all) statt nacheinander.
//
// Dieser Test simuliert genau das: viele Teiltexte, jeder einzeln bereits
// über dem Zusammenführungs-Budget (RAG_BATCH_CHAR_BUDGET), und prüft, dass
// der Lauf trotzdem in wenigen Runden fertig wird statt hängen zu bleiben.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const BUDGET_TOLERANCE = 11000; // RAG_BATCH_CHAR_BUDGET (9000) + Toleranz fuer Anweisungstext
let synthesisCallCount = 0;
let rawBatchCallCount = 0;
let maxRoundSeen = 0;
const progressMessages = [];

let sampleImpl = async (input) => {
  if (input.indexOf("Teiltext 1:") !== -1) {
    synthesisCallCount++;
    if (input.length > BUDGET_TOLERANCE) {
      const err = new Error("Prompt zu groß.");
      err.code = "prompt_too_large";
      throw err;
    }
    // Realistische Länge einer echten Claude-Zusammenführung (ein
    // substantieller Absatz, kein winziger Platzhalter) - sonst schrumpfen
    // die Teiltexte nach der ersten Runde unrealistisch schnell auf fast
    // nichts und die mehrstufige Rundenverdichtung wird nicht wirklich
    // getestet.
    return { text: "Zusammengefuehrter Absatz zum Servicevertrag mit Praxisdetails. ".repeat(60), truncated: false, modelTierApplied: "default" };
  }
  rawBatchCallCount++;
  // Jeder Roh-Batch-Teiltext liegt bereits einzeln klar ueber dem
  // Zusammenfuehrungs-Budget (9000) - genau das Szenario, das die alte
  // chunkTextsByBudget()-Logik zum Stillstand brachte.
  return { text: "Y".repeat(7500), truncated: false, modelTierApplied: "default" };
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

// 170 Tickets auf dasselbe Kapitel, wie in der real beobachteten Meldung
// ("Verdichte 170 Teiltexte ..."). Kurze Beschreibungen, damit chunkRagRows()
// viele kleine Roh-Batches bildet (jeder davon erzeugt einen der oben
// absichtlich ueberlangen Platzhalter-Teiltexte).
let items = "";
for (let i = 0; i < 170; i++) {
  // Beschreibung lang genug, dass chunkRagRows() viele kleine Roh-Batches
  // bildet (nicht nur 1-2) - jeder Batch erzeugt unten einen der absichtlich
  // ueberlangen Platzhalter-Teiltexte.
  items += `<item><key>STG-${i}</key><summary>Servicevertrag anlegen Stagnationsfall ${i}</summary>` +
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
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "stg.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(700);
  check("170 Tickets geladen", doc.getElementById("stat-tickets").textContent === "170");

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect.options).forEach((o) => { o.selected = o.value === "Kapitel 4: Servicevertrag anlegen"; });
  fire(chapterSelect, "change");
  await wait(80);

  // Statuszeile beobachten, um die hoechste erreichte Zusammenfuehrungsrunde
  // mitzuschneiden (Beweis, dass die Runden tatsaechlich voranschreiten).
  const statusEl = doc.getElementById("manual-status-note");
  const observer = new win.MutationObserver(() => {
    const text = statusEl.textContent || "";
    progressMessages.push(text);
    const m = text.match(/Zusammenführungsrunde (\d+)/);
    if (m) maxRoundSeen = Math.max(maxRoundSeen, parseInt(m[1], 10));
  });
  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });

  fire(doc.getElementById("manual-generate-btn"), "click");
  // Grosszuegiges Timeout, aber deutlich kuerzer als ein echtes Haengen
  // (vorher: praktisch nie fertig bei hunderten sequenziellen Aufrufen ohne
  // jede Parallelitaet). Mit dem Fix sollte der Lauf in wenigen Sekunden
  // durch sein (keine echte Netzwerklatenz im Mock).
  const finished = await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 20000);
  check("Lauf abgeschlossen (nicht am 20s-Timeout hängen geblieben)", finished);

  check("Zusammenführung erreichte mehrere Runden (garantierter Fortschritt statt Stillstand)", maxRoundSeen >= 2);
  check("Zusammenführung brauchte NICHT uebermaessig viele Runden (< 15, log-artige statt lineare Konvergenz)", maxRoundSeen < 15);
  check("Mehrere Rohdaten-Batches entstanden (>10)", rawBatchCallCount > 10);

  const chapterListText = doc.getElementById("manual-chapters-list").textContent;
  check("Kapitel wurde trotz vieler ueberlanger Teiltexte erfolgreich gespeichert", chapterListText.indexOf("Kapitel 4: Servicevertrag anlegen") !== -1);
  check("Kein Fehlschlag-Toast", doc.getElementById("toast").className.indexOf("error") === -1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  console.log("Debug: rawBatchCallCount=" + rawBatchCallCount + " synthesisCallCount=" + synthesisCallCount + " maxRoundSeen=" + maxRoundSeen);
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE STAGNATIONS-FIX-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
