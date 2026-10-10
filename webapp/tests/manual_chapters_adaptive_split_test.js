// Kapitel-Generator: adaptive Bisektion der ROHDATEN-Batches gegen
// "prompt_too_large" (manualGenerateBatchAdaptive). Zweiter Bugfix zum selben
// Fehlerbild wie manual_chapters_large_merge_test.js, aber an einer anderen
// Stelle: dort wurde die ZUSAMMENFÜHRUNG der bereits erzeugten Teiltexte
// abgesichert - hier geht es um den vorgelagerten Schritt, in dem die
// Ticket-ROHDATEN selbst an Claude geschickt werden. chunkRagRows() begrenzt
// zwar die reinen Ticket-Rohdaten auf RAG_BATCH_CHAR_BUDGET, der tatsächliche
// Gesamt-Prompt (inkl. Anweisungstext/Rollenhinweis) kann trotzdem über der
// von der Claude-Artifact-Laufzeit tatsächlich durchgesetzten Grenze liegen -
// und ein einzelnes, ungewöhnlich langes Ticket bildet laut chunkRagRows()
// ohnehin einen UNGEDECKELTEN eigenen Batch. manualGenerateBatchAdaptive()
// bisektiert in diesem Fall reaktiv (Hälfte/Hälfte), bis zu einzelnen
// Tickets, kürzt ein einzelnes, weiterhin zu großes Ticket mit sichtbarem
// Hinweis, und markiert es im (seltenen) Fall, dass selbst das scheitert,
// ehrlich als nicht verarbeitbar statt den gesamten Kapitel-Lauf abzubrechen.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// manualTicketBlock() nimmt NICHT den Ticket-Schlüssel in den Prompt auf
// (nur Domäne/Typ/Status/Überschrift/Beschreibung) - die Mock-Erkennung muss
// sich daher am Summary-Text ("Fall A/B/C/D") orientieren, nicht am
// Jira-Schlüssel. Der Schlüssel selbst wird nur für die abschließende
// "[OFFEN: Ticket ...]"-Markierung aus dem echten Ticket-Objekt gelesen
// (produktionscode-seitig über t.key, unabhängig vom Prompt-Text).
const calls = [];
let sampleImpl = async (input) => {
  calls.push(input);
  if (input.indexOf("Teiltext 1:") !== -1) {
    return { text: "ZUSAMMENGEFUEHRT", truncated: false, modelTierApplied: "default" };
  }
  const faelle = (input.match(/Fall [ABCD]/g) || []);
  const uniqueFaelle = Array.from(new Set(faelle));
  if (uniqueFaelle.length > 1) {
    // Mehrere Tickets in einem Aufruf -> simuliert "insgesamt zu gross",
    // erzwingt Bisektion in manualGenerateBatchAdaptive().
    const err = new Error("Prompt zu groß (mehrere Tickets).");
    err.code = "prompt_too_large";
    throw err;
  }
  if (uniqueFaelle.length === 1) {
    const fall = uniqueFaelle[0];
    if (fall === "Fall A") {
      // Dieses EINE Ticket (ADB-0) ist selbst (ungekürzt) zu gross.
      if (input.indexOf("gekürzt") === -1) {
        const err = new Error("Einzelnes Ticket zu groß.");
        err.code = "prompt_too_large";
        throw err;
      }
      return { text: "TEXT-ADB-0-GEKUERZT", truncated: false, modelTierApplied: "default" };
    }
    if (fall === "Fall B") {
      // Scheitert auch NACH Kuerzung weiterhin (seltener Randfall, ADB-1).
      const err = new Error("Auch gekürzt noch zu groß.");
      err.code = "prompt_too_large";
      throw err;
    }
    const key = fall === "Fall C" ? "ADB-2" : "ADB-3";
    return { text: "TEXT-" + key, truncated: false, modelTierApplied: "default" };
  }
  return { text: "FALLBACK", truncated: false, modelTierApplied: "default" };
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

// 4 Tickets auf DASSELBE Kapitel mit KURZEN Beschreibungen, sodass
// chunkRagRows() sie als EINEN einzigen Batch gruppiert (batches.length<=1 in
// manualGenerateOneChapter) - genau der Fall, in dem der Fehler bisher trotz
// augenscheinlich kleinem Datenvolumen auftreten konnte.
const xmlFixture = `<?xml version="1.0"?><rss><channel>
  <item><key>ADB-0</key><summary>Servicevertrag anlegen Fall A</summary><description>Kurze Beschreibung A.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>ADB-1</key><summary>Servicevertrag anlegen Fall B</summary><description>Kurze Beschreibung B.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>ADB-2</key><summary>Servicevertrag anlegen Fall C</summary><description>Kurze Beschreibung C.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>ADB-3</key><summary>Servicevertrag anlegen Fall D</summary><description>Kurze Beschreibung D.</description><status>Offen</status><type>Bug</type>
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
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "adb.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("4 Tickets geladen", doc.getElementById("stat-tickets").textContent === "4");

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect.options).forEach((o) => { o.selected = o.value === "Kapitel 4: Servicevertrag anlegen"; });
  fire(chapterSelect, "change");
  await wait(80);

  fire(doc.getElementById("manual-generate-btn"), "click");
  const finished = await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 10000);
  check("Lauf abgeschlossen trotz mehrfachem simuliertem 'prompt_too_large'", finished);

  const toastClass = doc.getElementById("toast").className;
  check("Kein Fehlschlag-Toast (Kapitel trotz Bisektion/Kürzung/Fallback erfolgreich)", toastClass.indexOf("error") === -1);

  const combinedCall = calls.find((c) => (new Set(c.match(/Fall [ABCD]/g) || [])).size > 1);
  check("Erster Versuch mit allen 4 Tickets zusammen wurde unternommen (und abgelehnt)", !!combinedCall);

  const truncatedCall = calls.find((c) => c.indexOf("Fall A") !== -1 && c.indexOf("gekürzt") !== -1);
  check("ADB-0 (Fall A) wurde nach Scheitern gekürzt erneut versucht", !!truncatedCall);

  const finalMergeCall = calls.filter((c) => c.indexOf("Teiltext 1:") !== -1).pop();
  check("Finale Zusammenführung erhielt den gekürzten Text für ADB-0", !!finalMergeCall && finalMergeCall.indexOf("TEXT-ADB-0-GEKUERZT") !== -1);
  check("Finale Zusammenführung markiert ADB-1 ehrlich als nicht verarbeitbar (OFFEN)", !!finalMergeCall && finalMergeCall.indexOf("[OFFEN: Ticket ADB-1") !== -1);
  check("Finale Zusammenführung enthält normal erzeugten Text für ADB-2", !!finalMergeCall && finalMergeCall.indexOf("TEXT-ADB-2") !== -1);
  check("Finale Zusammenführung enthält normal erzeugten Text für ADB-3", !!finalMergeCall && finalMergeCall.indexOf("TEXT-ADB-3") !== -1);

  const chapterListText = doc.getElementById("manual-chapters-list").textContent;
  check("Kapitel wurde erfolgreich gespeichert/gerendert", chapterListText.indexOf("Kapitel 4: Servicevertrag anlegen") !== -1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ADAPTIVE-ROHDATEN-BISEKTIONS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
