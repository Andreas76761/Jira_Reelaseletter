// EDITO Schritt 2 (Register "Editor", Abschnitt "6. Gesamtdokument"): PDF-
// Download des Gesamtdokuments (zusätzlich zum bestehenden Word-Download,
// beide mit automatisch vorangestelltem Inhaltsverzeichnis - PDF mit
// realer, gerenderter Seitenzahl je Kapitel, Word nur mit der
// Kapitel-Reihenfolge) sowie 2 neue Prüf-Agenten über das GESAMTE
// Gesamtdokument (anders als Agent 1/2, die je EINZELNES Kapitel prüfen):
// Agent 4 (kapitelübergreifende Konsistenz, mind. 2 erzeugte Kapitel nötig)
// und Agent 5 (Vollständigkeit/Abdeckung der zugeordneten Tickets, bereits
// ab 1 erzeugtem Kapitel möglich). Prüft: Guards (0/1 erzeugte Kapitel),
// erfolgreicher Lauf mit 2 Kapiteln (Prompt nennt beide Kapitel bzw. deren
// Tickets), PDF-Download mit echter %PDF-Signatur, Reset bei
// Versionswechsel.
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
  if (/Vergleiche die Kapitel/.test(promptText || "")) {
    return { text: "### Widersprüche zwischen Kapiteln\n- Keine gefunden.\n\n### Redundanzen zwischen Kapiteln\n- Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  if (/Prüfe JE KAPITEL/.test(promptText || "")) {
    return { text: "### Nicht abgedeckte Tickets\n- Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "## Retail\nKapiteltext für Testzwecke.\n", truncated: false, modelTierApplied: "default" };
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
async function blobToBuffer(blob) {
  const arrBuf = await blob.arrayBuffer();
  return Buffer.from(arrBuf);
}

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>ES2-1</key><summary>Servicevertrag im Autohaus anlegen</summary><description>Der Dealer legt den Vertrag an.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>ES2-2</key><summary>Vertragsänderung durchführen</summary><description>Der Dealer ändert den Vertrag.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "edito_schritt2_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  const versionSelect = doc.getElementById("edito-version-select");
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(100);

  function rowFor(sub) {
    return Array.from(doc.getElementById("edito-chapters-tbody").querySelectorAll("tr")).find((r) => r.children[1].textContent.includes(sub));
  }

  // ===================== Guards: ohne jegliches erzeugtes Kapitel =====================
  fire(doc.getElementById("edito-agent5-btn"), "click");
  await wait(50);
  check("Agent 5 ohne erzeugtes Kapitel zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Keine Kapitel"));
  check("Agent-5-Ergebnis bleibt dabei versteckt", doc.getElementById("edito-agent5-result").hidden === true);

  fire(doc.getElementById("edito-agent4-btn"), "click");
  await wait(50);
  check("Agent 4 ohne erzeugte Kapitel zeigt Hinweis auf Mindestanzahl", doc.getElementById("toast").textContent.includes("mindestens 2"));
  check("Agent-4-Ergebnis bleibt dabei versteckt", doc.getElementById("edito-agent4-result").hidden === true);

  // ===================== Kapitel 4 erzeugen (1 von 2) =====================
  fire(rowFor("Kapitel 4").querySelector("[data-edito-generate]"), "click");
  const gen1Done = await waitUntil(() => !!rowFor("Kapitel 4").querySelector("[data-edito-view]"), 2000);
  check("Kapitel 4 erzeugt", gen1Done);

  // ===================== Agent 4 mit nur 1 Kapitel weiterhin blockiert =====================
  fire(doc.getElementById("edito-agent4-btn"), "click");
  await wait(50);
  check("Agent 4 mit nur 1 erzeugtem Kapitel weiterhin blockiert", doc.getElementById("toast").textContent.includes("mindestens 2"));

  // ===================== Agent 5 funktioniert bereits ab 1 Kapitel =====================
  sampleCalls = [];
  fire(doc.getElementById("edito-agent5-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-agent5-output").textContent.includes("Nicht abgedeckte Tickets"), 2000);
  check("Agent 5 mit 1 Kapitel erfolgreich ausgeführt", doc.getElementById("edito-agent5-output").textContent.includes("Nicht abgedeckte Tickets"));
  check("Agent-5-Prompt nennt Kapitel 4 und dessen Ticket", sampleCalls.length === 1 && sampleCalls[0].input.includes("Kapitel 4") && sampleCalls[0].input.includes("ES2-1"));
  check("Agent-5-Statuszeile nennt 1 Kapitel", doc.getElementById("edito-agent5-status-note").textContent.includes("1 Kapitel"));

  // ===================== Kapitel 7 zusätzlich erzeugen (2 von 2) =====================
  fire(rowFor("Kapitel 7").querySelector("[data-edito-generate]"), "click");
  const gen2Done = await waitUntil(() => !!rowFor("Kapitel 7").querySelector("[data-edito-view]"), 2000);
  check("Kapitel 7 zusätzlich erzeugt", gen2Done);

  // ===================== Agent 4 jetzt mit 2 Kapiteln erfolgreich =====================
  sampleCalls = [];
  fire(doc.getElementById("edito-agent4-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-agent4-output").textContent.includes("Redundanzen zwischen Kapiteln"), 2000);
  check("Agent 4 mit 2 Kapiteln erfolgreich ausgeführt", doc.getElementById("edito-agent4-output").textContent.includes("Redundanzen zwischen Kapiteln"));
  check("Agent-4-Prompt nennt beide Kapitel", sampleCalls.length === 1 && sampleCalls[0].input.includes("Kapitel 4") && sampleCalls[0].input.includes("Kapitel 7"));
  check("Agent-4-Statuszeile nennt 2 Kapitel", doc.getElementById("edito-agent4-status-note").textContent.includes("2 Kapitel"));
  check("Protokoll vermerkt Agent-4-Lauf", doc.getElementById("log-list").textContent.includes("Agent 4"));
  check("Spinner (Agent 4) nach Abschluss wieder versteckt", doc.getElementById("edito-agent4-spinner").hidden === true);
  check("Button (Agent 4) nach Abschluss wieder aktiv", doc.getElementById("edito-agent4-btn").disabled === false);

  // ===================== Agent 5 erneut mit jetzt 2 Kapiteln =====================
  sampleCalls = [];
  fire(doc.getElementById("edito-agent5-btn"), "click");
  await waitUntil(() => sampleCalls.length === 1, 2000);
  check("Agent-5-Prompt nennt jetzt beide Kapitel und beide Tickets", sampleCalls[0].input.includes("Kapitel 4") && sampleCalls[0].input.includes("Kapitel 7") && sampleCalls[0].input.includes("ES2-1") && sampleCalls[0].input.includes("ES2-2"));
  check("Protokoll vermerkt Agent-5-Lauf", doc.getElementById("log-list").textContent.includes("Agent 5"));

  // ===================== Gesamtdokument zusammenführen: Word + PDF =====================
  fire(doc.getElementById("edito-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-merge-preview-section").hidden === false, 2000);
  check("Gesamtdokument-Vorschau nennt 2 von 2 Kapiteln", doc.getElementById("edito-merge-status-note").textContent.includes("2 von 2"));

  const savedBeforeDocx = savedFiles.length;
  fire(doc.getElementById("edito-merge-download-btn"), "click");
  await wait(100);
  check("Word-Download des Gesamtdokuments ausgelöst", savedFiles.length === savedBeforeDocx + 1);
  check("Word-Dateiname endet auf .docx", savedFiles[savedFiles.length - 1].filename.endsWith(".docx"));
  const docxZip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer()));
  const docxXml = await docxZip.file("word/document.xml").async("text");
  check("Word-Gesamtdokument enthält ein Inhaltsverzeichnis mit beiden Kapiteln", docxXml.includes("Inhaltsverzeichnis") && docxXml.includes("Kapitel 4") && docxXml.includes("Kapitel 7"));

  const savedBeforePdf = savedFiles.length;
  fire(doc.getElementById("edito-merge-download-pdf-btn"), "click");
  await wait(100);
  check("PDF-Download des Gesamtdokuments ausgelöst", savedFiles.length === savedBeforePdf + 1);
  check("PDF-Dateiname endet auf .pdf", savedFiles[savedFiles.length - 1].filename.endsWith(".pdf"));
  const pdfBuf = await blobToBuffer(savedFiles[savedFiles.length - 1].data);
  check("PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");

  // ===================== Agent 3: Inhaltsverzeichnis jetzt über 2 Kapitel =====================
  fire(doc.getElementById("edito-agent3-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-agent3-result").hidden === false, 2000);
  check("Agent 3 nennt das Inhaltsverzeichnis mit beiden Kapiteln", doc.getElementById("edito-agent3-output").textContent.includes("mit allen 2 Kapiteln"));

  // ===================== Versionswechsel setzt Agent 4/5 + Gesamtdokument-Downloads zurück =====================
  versionSelect.value = "it";
  fire(versionSelect, "change");
  await wait(100);
  check("Nach Versionswechsel: Agent-4-Ergebnis wieder versteckt", doc.getElementById("edito-agent4-result").hidden === true);
  check("Nach Versionswechsel: Agent-5-Ergebnis wieder versteckt", doc.getElementById("edito-agent5-result").hidden === true);
  check("Nach Versionswechsel: Gesamtdokument-Vorschau wieder versteckt", doc.getElementById("edito-merge-preview-section").hidden === true);

  const savedBeforeStaleClick = savedFiles.length;
  fire(doc.getElementById("edito-merge-download-pdf-btn"), "click");
  await wait(50);
  check("Nach Versionswechsel: PDF-Download-Button löst nichts mehr aus (Blob zurückgesetzt)", savedFiles.length === savedBeforeStaleClick);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE EDITO-SCHRITT2-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
