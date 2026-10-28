// Releaseletter/Clickanweisung bleiben vollständig deterministisch (reiner
// Textbaustein aus den Ticket-Rohdaten, KEIN KI-Aufruf im eigentlichen
// Entwurf). Neu: ein opt-in "Mit RAG-Kontext anreichern (KI)"-Button bei
// BEIDEN Generatoren (wireTextGenerator) - EIN zusätzlicher Claude-Call
// nutzt den bereits fertigen Entwurf + passende Textschnipsel aus der
// RAG-Bibliothek (nach Gliederungskapitel der enthaltenen Tickets
// zugeordnet, inkl. automatisch erzeugter Chunks aus v2.103.0) und zeigt
// eine ZUSÄTZLICHE Fassung an - der deterministische Original-Entwurf
// bleibt unverändert der Haupt-Export. Prüft: Guard ohne Entwurf, Chunk-
// Aggregation über die Gliederungskapitel der Tickets, Negativlisten-
// Hervorhebung NUR bei Releaseletter (Clickanweisung bewusst aussen vor,
// wie beim Original-Entwurf), Reset bei erneutem "Entwurf generieren",
// reiner Sitzungs-Anzeigezustand (nicht Teil von "Sitzung speichern").
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
async function sampleImpl(promptText) {
  sampleCalls.push({ input: promptText });
  return { text: "Zusätzlicher Hintergrund aus der RAG-Bibliothek: der Vertrag kann jederzeit angepasst werden.", truncated: false, modelTierApplied: "default" };
}
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
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
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

const KAP7 = "Kapitel 7: Verträge im Alltag verwalten";
const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>GRE-1</key><summary>Vertragsänderung durchführen</summary><description>Der Dealer ändert den Vertrag.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
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
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "gen_rag_enrich_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== RAG-Chunk für Kapitel 7 automatisch erzeugen =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(100);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  fire(doc.getElementById("rag-auto-generate-btn"), "click");
  await wait(50);
  check("RAG-Chunk für Kapitel 7 automatisch erzeugt", doc.querySelectorAll("#rag-library-tbody tr").length >= 1);

  // ===================== Releaseletter: Guard ohne Entwurf =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(100);
  fire(doc.getElementById("releaseletter-rag-enrich-btn"), "click");
  await wait(50);
  check("Releaseletter: RAG-Anreicherung ohne Entwurf zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Kein Entwurf"));
  check("Releaseletter: Anreicherungs-Ergebnis bleibt dabei versteckt", doc.getElementById("releaseletter-rag-enrich-result").hidden === true);

  // ===================== Releaseletter: Entwurf generieren + anreichern =====================
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(100);
  check("Releaseletter: Entwurf generiert", doc.getElementById("releaseletter-download-btn").disabled === false && !doc.getElementById("releaseletter-preview").textContent.includes("Noch kein Entwurf"));

  sampleCalls = [];
  fire(doc.getElementById("releaseletter-rag-enrich-btn"), "click");
  await waitUntil(() => doc.getElementById("releaseletter-rag-enrich-output").textContent.includes("Zusätzlicher Hintergrund"), 2000);
  check("Releaseletter: angereicherte Fassung sichtbar", doc.getElementById("releaseletter-rag-enrich-result").hidden === false);
  check("Releaseletter: sample() genau einmal aufgerufen", sampleCalls.length === 1);
  check("Releaseletter: Prompt enthält den bestehenden Entwurf", sampleCalls[0].input.includes("BESTEHENDER ENTWURF"));
  check("Releaseletter: Prompt nennt den passenden RAG-Chunk (Kapitel 7)", sampleCalls[0].input.includes("Kapitel: " + KAP7));
  check("Releaseletter: Statuszeile nennt mind. 1 passende Quelle", /\d+ passende Quelle/.test(doc.getElementById("releaseletter-rag-enrich-status-note").textContent));
  check("Protokoll vermerkt den Anreicherungs-Lauf", doc.getElementById("log-list").textContent.includes("RAG-Kontext angereicherte Fassung"));
  check("Button nach Abschluss wieder aktiv", doc.getElementById("releaseletter-rag-enrich-btn").disabled === false);
  check("Spinner nach Abschluss wieder versteckt", doc.getElementById("releaseletter-rag-enrich-spinner").hidden === true);

  // ===================== Releaseletter: Negativlisten-Hervorhebung gilt auch hier =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const negInput = doc.getElementById("negative-words-input");
  negInput.value = "Vertrag";
  fire(negInput, "input");
  await wait(50);
  check("Releaseletter: angereicherte Fassung markiert Negativlisten-Treffer live", doc.getElementById("releaseletter-rag-enrich-output").innerHTML.includes("negword-hit"));
  negInput.value = "";
  fire(negInput, "input");
  await wait(50);

  // ===================== Releaseletter: erneutes Generieren setzt Anreicherung zurück =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(100);
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  check("Releaseletter: nach erneutem Generieren ist Anreicherungs-Ergebnis wieder versteckt", doc.getElementById("releaseletter-rag-enrich-result").hidden === true);
  check("Releaseletter: Anreicherungs-Statuszeile geleert", doc.getElementById("releaseletter-rag-enrich-status-note").textContent === "");

  // ===================== Clickanweisung: Guard + Erfolg, OHNE Negativlisten-Hervorhebung =====================
  doc.querySelector('.nav-item[data-view="clickanweisung"]').click();
  await wait(100);
  fire(doc.getElementById("clickanweisung-rag-enrich-btn"), "click");
  await wait(50);
  check("Clickanweisung: RAG-Anreicherung ohne Entwurf zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Kein Entwurf"));

  fire(doc.getElementById("clickanweisung-generate-btn"), "click");
  await wait(100);
  sampleCalls = [];
  fire(doc.getElementById("clickanweisung-rag-enrich-btn"), "click");
  await waitUntil(() => doc.getElementById("clickanweisung-rag-enrich-output").textContent.includes("Zusätzlicher Hintergrund"), 2000);
  check("Clickanweisung: angereicherte Fassung sichtbar", doc.getElementById("clickanweisung-rag-enrich-result").hidden === false);
  check("Clickanweisung: Prompt nennt den passenden RAG-Chunk (Kapitel 7)", sampleCalls.length === 1 && sampleCalls[0].input.includes("Kapitel: " + KAP7));
  check("Clickanweisung: Prompt-Default unterscheidet sich vom Releaseletter-Prompt", sampleCalls[0].input.includes("Klickanweisung (Quick Reference)"));

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  negInput.value = "Vertrag";
  fire(negInput, "input");
  await wait(50);
  check("Clickanweisung: angereicherte Fassung bleibt OHNE Negativlisten-Hervorhebung (bewusst wie der Original-Entwurf)",
    !doc.getElementById("clickanweisung-rag-enrich-output").innerHTML.includes("negword-hit"));
  negInput.value = "";
  fire(negInput, "input");
  await wait(50);

  // ===================== Reiner Sitzungs-Anzeigezustand: nicht Teil von "Sitzung speichern" =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("Export enthält KEIN eigenes Feld für die RAG-Anreicherung (reiner Anzeigezustand)",
    !("releaseletterRagEnrich" in exportedJson) && !("clickanweisungRagEnrich" in exportedJson));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE GEN-RAG-ENRICH-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
