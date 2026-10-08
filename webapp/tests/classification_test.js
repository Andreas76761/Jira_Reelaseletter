// Status-Klassifizierung (genehmigt/in Prüfung/intern/Background): vierte,
// von Sparte/Rolle unabhängige Achse. Automatischer Vorschlag aus Jira-
// Labels ("Intern"/"Background"/"Hintergrund"/"Recherche") bzw. ersatzweise
// aus dem Status-Bucket (erledigt -> genehmigt), manuell je Ticket UND je
// Massenverarbeitung-Textschnipsel überschreibbar. "genehmigt"/"in Prüfung"
// dürfen in RAG/Kapitel-Generator/Releaseletter einfließen, "intern" und
// "background" sind dort zwingend ausgeschlossen - "background" liefert
// stattdessen zusätzliches Wissen für die Lücken-Analyse ("Grill me").
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Generierter Text.", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
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

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>CLS-1</key><summary>Intern klassifiziertes Ticket</summary><description>Nur für interne Zwecke.</description><status>Offen</status><type>Task</type>
    <labels><label>Intern</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>CLS-2</key><summary>Background klassifiziertes Ticket</summary><description>Hintergrundwissen zum Vertragsmanagement.</description><status>Offen</status><type>Task</type>
    <labels><label>Background</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>CLS-3</key><summary>Erledigtes Ticket</summary><description>Abgeschlossene Arbeit.</description><status>Erledigt</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>CLS-4</key><summary>Offenes Ticket ohne Spezial-Label</summary><description>Noch in Arbeit.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>CLS-5</key><summary>Dediziertes Background-Hintergrundwissen-Ticket</summary><description>Spezial-Hinweis-ABC123 zu Vertragsverlaengerung.</description><status>Offen</status><type>Task</type>
    <labels><label>Background</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Vorbereitung =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "classification.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(100);
  check("Vorbereitung: 5 Tickets geladen", doc.getElementById("stat-tickets").textContent === "5");

  // ===================== (1) Dashboard: automatischer Vorschlag je Ticket =====================
  function classRow(key) { return doc.querySelector('select.classification-select[data-key="' + key + '"]'); }
  check("(1) CLS-1 (Label 'Intern') -> automatisch 'intern'", classRow("CLS-1").value === "intern");
  check("(1) CLS-2 (Label 'Background') -> automatisch 'background'", classRow("CLS-2").value === "background");
  check("(1) CLS-3 (Status 'Erledigt') -> automatisch 'genehmigt'", classRow("CLS-3").value === "genehmigt");
  check("(1) CLS-4 (offen, kein Spezial-Label) -> automatisch 'in_pruefung'", classRow("CLS-4").value === "in_pruefung");

  // ===================== (2) RAG-Extraktion schließt intern/background aus =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(50);
  const ragDomainSelect = doc.getElementById("rag-domain-select");
  Array.from(ragDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  const ragTbodyText = doc.getElementById("rag-extract-tbody").textContent;
  check("(2) RAG-Extraktion: CLS-1 (intern) NICHT enthalten", !ragTbodyText.includes("CLS-1"));
  check("(2) RAG-Extraktion: CLS-2 (background) NICHT enthalten", !ragTbodyText.includes("CLS-2"));
  check("(2) RAG-Extraktion: CLS-5 (background) NICHT enthalten", !ragTbodyText.includes("CLS-5"));
  check("(2) RAG-Extraktion: CLS-3 (genehmigt) enthalten", ragTbodyText.includes("CLS-3"));
  check("(2) RAG-Extraktion: CLS-4 (in Prüfung) enthalten", ragTbodyText.includes("CLS-4"));
  check("(2) RAG-Extraktion zeigt genau 2 Tickets (CLS-3 + CLS-4)", doc.getElementById("rag-extract-count").textContent === "2");

  // ===================== (3) Kapitel-Generator (manualMatchedTickets) schließt intern/background aus =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  check("(3) Kapitel-Generator-Treffer: genau 2 Tickets (intern/background ausgeschlossen)", doc.getElementById("manual-match-count").textContent.startsWith("2 "));

  // ===================== (4) Releaseletter (resolveGeneratorTickets) schließt intern/background aus, beide Zweige =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(50);
  // Zweig "use-filtered": Dashboard-Filter auf alle 5 Tickets (keine Einschränkung).
  doc.getElementById("releaseletter-use-filtered").checked = true;
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  let rlPreview = doc.getElementById("releaseletter-preview").textContent;
  check("(4a) Releaseletter (use-filtered): CLS-1 (intern) NICHT im Entwurf", !rlPreview.includes("CLS-1"));
  check("(4a) Releaseletter (use-filtered): CLS-2 (background) NICHT im Entwurf", !rlPreview.includes("CLS-2"));
  check("(4a) Releaseletter (use-filtered): CLS-3 (genehmigt) im Entwurf", rlPreview.includes("CLS-3"));
  check("(4a) Releaseletter (use-filtered): CLS-4 (in Prüfung) im Entwurf", rlPreview.includes("CLS-4"));

  // Zweig Schlüssel-Liste: alle 5 Schlüssel explizit eingetragen.
  doc.getElementById("releaseletter-use-filtered").checked = false;
  doc.getElementById("releaseletter-keys").value = "CLS-1\nCLS-2\nCLS-3\nCLS-4\nCLS-5";
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  rlPreview = doc.getElementById("releaseletter-preview").textContent;
  check("(4b) Releaseletter (Schlüsselliste): CLS-1 (intern) NICHT im Entwurf", !rlPreview.includes("CLS-1"));
  check("(4b) Releaseletter (Schlüsselliste): CLS-2/CLS-5 (background) NICHT im Entwurf", !rlPreview.includes("CLS-2") && !rlPreview.includes("CLS-5"));
  check("(4b) Releaseletter (Schlüsselliste): CLS-3 (genehmigt) im Entwurf", rlPreview.includes("CLS-3"));
  check("(4b) Releaseletter (Schlüsselliste): CLS-4 (in Prüfung) im Entwurf", rlPreview.includes("CLS-4"));

  // ===================== (5) Manuelle Übersteuerung (Dashboard-Dropdown) =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const cls1Select = classRow("CLS-1");
  cls1Select.value = "genehmigt";
  fire(cls1Select, "change");
  await wait(30);
  check("(5) Nach Übersteuerung: Toast/Protokoll vermerkt Änderung", doc.getElementById("log-list").textContent.includes("Klassifizierung von CLS-1"));
  // Persistenz über einen erneuten refreshDashboard()-Aufruf (zweiter Import).
  const xmlExtra = `<?xml version="1.0"?><rss><channel><item><key>CLS-EXTRA</key><summary>Zusatzticket</summary><status>Offen</status><type>Task</type></item></channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlExtra], "extra.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  check("(5) Übersteuerung bleibt nach erneutem refreshDashboard() erhalten", classRow("CLS-1").value === "genehmigt");

  // RAG-Extraktion erneut: CLS-1 jetzt mit dabei (3 statt 2 Tickets).
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(50);
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("(5) Nach Übersteuerung auf 'genehmigt': CLS-1 jetzt in RAG-Extraktion enthalten (3 Tickets)",
    doc.getElementById("rag-extract-tbody").textContent.includes("CLS-1") && doc.getElementById("rag-extract-count").textContent === "3");

  // ===================== (6) Manuelle Übersteuerung im Ticket-Detail-Modal =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const cls2Row = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("CLS-2"));
  fire(cls2Row.querySelector("td.key"), "click");
  await wait(30);
  check("(6) Modal zeigt aktuelle Klassifizierung 'background'", doc.getElementById("modal-classification-select").value === "background");
  const modalSelect = doc.getElementById("modal-classification-select");
  modalSelect.value = "intern";
  fire(modalSelect, "change");
  await wait(30);
  check("(6) Modal-Übersteuerung vermerkt im Protokoll", doc.getElementById("log-list").textContent.includes("Klassifizierung von CLS-2"));
  fire(doc.getElementById("modal-close"), "click");
  await wait(30);
  check("(6) Dashboard-Dropdown übernimmt die im Modal gesetzte Klassifizierung", classRow("CLS-2").value === "intern");

  // ===================== (7) Massenverarbeitung: Klassifizierungs-Spalte + Ausschluss aus Zusammenfassung =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(50);
  check("(7) Massenverarbeitung-Tabelle hat Klassifizierungs-Spalte", doc.getElementById("mass-groups").innerHTML.includes("mass-classification-select"));
  const massClsSelects = Array.from(doc.querySelectorAll(".mass-classification-select"));
  const cls3MassSel = massClsSelects.find((s) => s.closest("tr").textContent.includes("CLS-3"));
  check("(7) Ticket-Grundlage übernimmt die Ticket-eigene Klassifizierung (CLS-3 -> genehmigt)", !!cls3MassSel && cls3MassSel.value === "genehmigt");

  fire(doc.getElementById("mass-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("mass-merge-output").value.trim().length > 0, 3000);
  const mergedText = doc.getElementById("mass-merge-output").value;
  check("(7) Zusammenfassung je Kapitel schließt 'intern' (CLS-2) aus", !mergedText.includes("Background klassifiziertes Ticket"));
  check("(7) Zusammenfassung je Kapitel enthält 'genehmigt'/'in Prüfung' (CLS-3/CLS-4)", mergedText.includes("Erledigtes Ticket") && mergedText.includes("Offenes Ticket ohne Spezial-Label"));
  check("(7) Statuszeile weist auf ausgeschlossene Intern/Background-Einträge hin", doc.getElementById("mass-merge-status-note").textContent.includes("ausgeschlossen"));

  // ===================== (8) "Grill me": Background-Wissen fließt als Zusatzkontext ein =====================
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(100);
  const glSubSelect = doc.getElementById("gl-subchapter-select");
  const glSubOpt = Array.from(glSubSelect.options).find((o) => o.value.indexOf("Kapitel 7") !== -1);
  if (glSubOpt) glSubSelect.value = glSubOpt.value;
  fire(doc.getElementById("gl-generate-btn"), "click");
  await wait(50);
  const keywordsGenerated = doc.getElementById("gl-keywords-empty").hidden === true || doc.getElementById("gl-keywords-list").children.length > 0;
  check("(8) Vorbereitung: Gliederungs-Stichwörter für Kapitel 7 erzeugt", keywordsGenerated);

  let lastGrillPrompt = null;
  sampleImpl = async (input2) => { lastGrillPrompt = input2; return { text: "## Offene Themen\nKeine Auffälligkeiten.\n## Widersprüche\nKeine Auffälligkeiten.\n## Verbesserungen\nKeine Auffälligkeiten.", truncated: false, modelTierApplied: "default" }; };
  fire(doc.getElementById("gl-grill-btn"), "click");
  await waitUntil(() => lastGrillPrompt !== null, 3000);
  check("(8) 'Grill me'-Prompt enthält Hinweis auf zusätzliches Hintergrundwissen", !!lastGrillPrompt && lastGrillPrompt.includes("Zusätzliches Hintergrundwissen"));
  check("(8) 'Grill me'-Prompt enthält den Inhalt des Background-Tickets CLS-5", !!lastGrillPrompt && lastGrillPrompt.includes("Spezial-Hinweis-ABC123"));
  check("(8) 'Grill me'-Prompt weist Claude an, damit Lücken zu erkennen", !!lastGrillPrompt && lastGrillPrompt.includes("Offene Themen"));

  // Chat nutzt bewusst NUR den regulären Kontext, nicht das Background-Wissen.
  let lastChatPrompt = null;
  sampleImpl = async (input2) => { lastChatPrompt = input2; return { text: "Antwort.", truncated: false, modelTierApplied: "default" }; };
  if (doc.getElementById("gl-chat-input")) {
    fire(doc.getElementById("gl-chat-btn"), "click");
    doc.getElementById("gl-chat-input").value = "Testfrage?";
    fire(doc.getElementById("gl-chat-send-btn"), "click");
    await waitUntil(() => lastChatPrompt !== null, 3000);
    const chatText = Array.isArray(lastChatPrompt) ? JSON.stringify(lastChatPrompt) : String(lastChatPrompt);
    check("(8) Chat (im Unterschied zu 'Grill me') enthält NICHT das Background-Hintergrundwissen", !chatText.includes("Spezial-Hinweis-ABC123"));
  }

  // ===================== (9) Sitzung speichern/laden + Persistenz der Übersteuerungen bei 'Alle Daten löschen' =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(9) Export enthält ticketClassificationOverrides", exportedJson.ticketClassificationOverrides && exportedJson.ticketClassificationOverrides["CLS-1"] === "genehmigt");
  check("(9) Export enthält Übersteuerung für CLS-2 (intern)", exportedJson.ticketClassificationOverrides["CLS-2"] === "intern");

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xml], "classification2.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  check("(9) Übersteuerung von CLS-1 überlebt 'Alle Daten löschen' (Konfiguration, an Jira-Nummer gebunden)", classRow("CLS-1").value === "genehmigt");
  check("(9) Übersteuerung von CLS-2 überlebt 'Alle Daten löschen'", classRow("CLS-2").value === "intern");
  check("(9) CLS-3 ohne Übersteuerung weiterhin automatisch 'genehmigt'", classRow("CLS-3").value === "genehmigt");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KLASSIFIZIERUNGS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
