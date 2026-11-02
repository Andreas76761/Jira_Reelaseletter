// v2.113.0: Render-Grenzen und Fehlerkorrekturen aus der Optimierungsliste -
// Vergleichstabelle (max. 300 geaenderte Tickets), Protokoll (Anzeige 200,
// Speicher 2000, inkrementelles Einfuegen), Listenauswahl-Vorschau (max. 300
// Zeilen, gespeichert wird alles), Stop-Button fuer die Rovo-KI-Zuordnung,
// Editor-Datei-Loeschen trifft nur die Screens DIESER Datei, abgesicherter
// IndexedDB-Zugriff, <meta charset>.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });

const savedFiles = [];
const sampleCalls = [];

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    // Sandbox-Simulation: Zugriff auf window.indexedDB wirft (wie in manchen
    // iframes) - die App muss trotzdem normal starten.
    Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new Error("SecurityError: indexedDB blockiert"); } });
    // Haengende KI-Antwort, die erst per AbortSignal abgebrochen wird.
    const sample = function (input, opts) {
      sampleCalls.push({ input, opts });
      return new Promise((resolve, reject) => {
        const sig = opts && opts.signal;
        if (sig) sig.addEventListener("abort", () => reject({ code: "cancelled", message: "abgebrochen" }));
      });
    };
    sample.json = sample;
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        if (name === "sample") return Promise.resolve(sample);
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (fn()) return true; await wait(20); }
  return false;
}

function xmlWithStatus(n, status) {
  let items = "";
  for (let i = 1; i <= n; i++) {
    items += `<item><key>PERF-${i}</key><summary>Ticket ${i}</summary><status>${status}</status>` +
      `<created>01/Jan/24 12:07 PM</created><updated>01/Jan/24 12:07 PM</updated></item>`;
  }
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  function nav(view) { doc.querySelector('.nav-item[data-view="' + view + '"]').click(); }
  async function importXml(xml, name) {
    nav("import");
    const input = doc.getElementById("file-input");
    Object.defineProperty(input, "files", { value: [new win.File([xml], name, { type: "application/xml" })], configurable: true });
    fire(input, "change");
  }
  async function exportSession() {
    savedFiles.length = 0;
    fire(doc.getElementById("session-export-btn"), "click");
    await waitUntil(() => savedFiles.length > 0, 5000);
    return savedFiles.length ? JSON.parse(savedFiles[0].data) : {};
  }
  async function importSession(data) {
    const input = doc.getElementById("session-import-input");
    Object.defineProperty(input, "files", { value: [new win.File([JSON.stringify(data)], "s.json", { type: "application/json" })], configurable: true });
    fire(input, "change");
    await wait(50);
    // Bei vorhandenen Tickets fragt die App vor dem Ersetzen nach.
    const ok = doc.getElementById("confirm-modal-ok-btn");
    if (ok && ok.offsetParent !== undefined) fire(ok, "click");
    await wait(600);
  }

  check("App startet trotz blockiertem IndexedDB-Zugriff (Versionsanzeige gesetzt)", /^v2\.\d+\.\d+$/.test(doc.getElementById("app-version").textContent));
  check("Build beginnt mit <meta charset=\"utf-8\">", fragment.startsWith('<meta charset="utf-8">'));

  // ===================== Vergleichstabelle: max. 300 geaenderte Tickets =====================
  await importXml(xmlWithStatus(320, "Offen"), "basis.xml");
  await waitUntil(() => doc.getElementById("stat-tickets").textContent === "320", 10000);
  check("320 Tickets importiert", doc.getElementById("stat-tickets").textContent === "320");
  await importXml(xmlWithStatus(320, "Geschlossen"), "update.xml");
  await waitUntil(() => doc.getElementById("stat-changes").textContent === "320", 10000);
  check("320 Änderungen erkannt", doc.getElementById("stat-changes").textContent === "320");
  for (const id of ["changes-tbody", "changes-tbody-verarbeitung"]) {
    const tbody = doc.getElementById(id);
    check(id + ": genau 300 Vergleich-Buttons gerendert", tbody.querySelectorAll(".compare-btn").length === 300);
    const hint = tbody.querySelector(".changes-truncated-hint");
    check(id + ": Hinweiszeile '300 von 320'", !!hint && hint.textContent.includes("300") && hint.textContent.includes("320"));
  }

  // ===================== Listenauswahl-Vorschau: max. 300 Zeilen =====================
  nav("dashboard");
  const selAll = doc.getElementById("select-all-checkbox");
  selAll.checked = true;
  fire(selAll, "change");
  await wait(100);
  nav("listenauswahl");
  await wait(100);
  const previewRows = doc.querySelectorAll("#listenauswahl-preview-tbody tr:not(.listenauswahl-preview-truncated)").length;
  check("Listenauswahl-Vorschau rendert 300 Ticketzeilen", previewRows === 300);
  check("Vorschau-Zähler nennt alle 320 Tickets", doc.getElementById("listenauswahl-preview-count").textContent === "320");
  const prevHint = doc.querySelector("#listenauswahl-preview-tbody .listenauswahl-preview-truncated");
  check("Vorschau-Hinweis 'gespeichert werden alle 320'", !!prevHint && prevHint.textContent.includes("alle 320"));
  doc.getElementById("listenauswahl-name-input").value = "Perf-Liste";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(200);
  const afterSave = await exportSession();
  const savedList = (afterSave.savedLists || []).filter((l) => l.name === "Perf-Liste")[0];
  check("Gespeicherte Liste enthält alle 320 Tickets (nicht nur die 300 der Vorschau)", !!savedList && savedList.keys.length === 320);

  // ===================== Protokoll: Anzeige 200, Speicher 2000 =====================
  const bigLog = [];
  for (let i = 0; i < 2500; i++) bigLog.push({ when: "01.01.2026 10:00", message: "Alt-Eintrag " + i });
  const sess = await exportSession();
  sess.log = bigLog;
  await importSession(sess);
  nav("verarbeitung");
  const logItems = () => doc.querySelectorAll("#log-list li:not(.log-truncated-hint)").length;
  check("Protokoll zeigt höchstens 200 Einträge", logItems() === 200);
  const logHint = doc.querySelector("#log-list .log-truncated-hint");
  check("Protokoll-Hinweis nennt Gesamtzahl (≤ 2000 nach Laden)", !!logHint && /von 200\d/.test(logHint.textContent));
  const reExported = await exportSession();
  check("Gespeichertes Protokoll auf 2000 Einträge begrenzt", Array.isArray(reExported.log) && reExported.log.length <= 2000 && reExported.log.length >= 1990);

  // Inkrementell: kleines Protokoll -> neuer Eintrag wird oben eingefuegt, bestehende <li> bleiben dieselben Knoten.
  const small = await exportSession();
  small.log = [{ when: "01.01.2026 10:00", message: "Eintrag A" }, { when: "01.01.2026 09:00", message: "Eintrag B" }];
  await importSession(small);
  nav("verarbeitung");
  const firstBefore = doc.querySelector("#log-list li");
  const countBefore = logItems();
  nav("listenauswahl");
  doc.getElementById("listenauswahl-name-input").value = "Perf-Liste 2";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(150);
  const lis = doc.querySelectorAll("#log-list li");
  check("Neuer Protokolleintrag steht oben", lis.length > countBefore && lis[0].textContent.includes("Perf-Liste 2"));
  check("Bestehende Protokollzeilen wurden nicht neu aufgebaut (gleicher DOM-Knoten)", Array.from(lis).indexOf(firstBefore) > 0);

  // ===================== Rovo KI-Zuordnung: Stop-Button =====================
  nav("rovoknowledge");
  for (let i = 0; i < 3; i++) {
    doc.getElementById("rovo-chat-textarea").value = "Frage " + i;
    doc.getElementById("rovo-answer-textarea").value = "Antwort " + i;
    fire(doc.getElementById("rovo-add-entry-btn"), "click");
    await wait(50);
  }
  const stopBtn = doc.getElementById("rovo-ai-stop-btn");
  check("Stop-Button vor dem Lauf ausgeblendet", !!stopBtn && stopBtn.hidden);
  sampleCalls.length = 0;
  fire(doc.getElementById("rovo-ai-assign-btn"), "click");
  await waitUntil(() => sampleCalls.length === 1, 3000);
  check("Stop-Button während des Laufs sichtbar", !stopBtn.hidden);
  check("KI-Aufruf erhält ein AbortSignal", !!(sampleCalls[0] && sampleCalls[0].opts && sampleCalls[0].opts.signal));
  fire(stopBtn, "click");
  await waitUntil(() => doc.getElementById("rovo-ai-status-note").textContent.includes("Gestoppt"), 3000);
  check("Statushinweis meldet 'Gestoppt'", doc.getElementById("rovo-ai-status-note").textContent.includes("Gestoppt"));
  check("Nach Stop keine weiteren KI-Aufrufe (1 statt 3)", sampleCalls.length === 1);
  check("Stop-Button nach dem Lauf wieder ausgeblendet, Start-Button aktiv", stopBtn.hidden && !doc.getElementById("rovo-ai-assign-btn").disabled);

  // Kapitelwechsel in einer Rovo-Zeile baut die Tabelle nicht neu auf.
  const rovoRow = doc.querySelector("#rovo-entries-tbody tr");
  const chapterSel = rovoRow.querySelector(".rovo-chapter-select");
  const chapterValue = Array.from(chapterSel.options).map((o) => o.value).filter(Boolean)[0];
  chapterSel.value = chapterValue;
  fire(chapterSel, "change");
  check("Rovo-Kapitelwechsel: Zeile bleibt derselbe DOM-Knoten", doc.querySelector("#rovo-entries-tbody tr") === rovoRow);
  check("Rovo-Kapitelwechsel: Unterkapitel-Dropdown aktiviert", !rovoRow.querySelector(".rovo-subchapter-select").disabled);

  // ===================== Editor-Datei loeschen: nur Screens DIESER Datei =====================
  const ed = await exportSession();
  const px = fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim();
  const img = (id, extra) => Object.assign({ id, filename: "anleitung.docx - Screen " + id, dataUrl: px, mimeType: "image/png", sizeBytes: 10, when: "x", domain: "", processStep: "", chapter: "", subchapter: "", description: "", sourceFile: "anleitung.docx" }, extra);
  ed.editorFiles = [
    { id: 1, filename: "anleitung.docx", format: "docx", domain: "", status: "Verarbeitet", screenCount: 1, when: "x" },
    { id: 2, filename: "anleitung.docx", format: "docx", domain: "", status: "Verarbeitet", screenCount: 1, when: "x" },
  ];
  ed.uploadedImages = [img(101, { editorFileId: 1 }), img(102, { editorFileId: 2 })];
  await importSession(ed);
  nav("editor");
  await wait(100);
  const delBtn = doc.querySelector('[data-editor-file-delete="1"]');
  check("Editor: Löschen-Button für Datei 1 vorhanden", !!delBtn);
  if (delBtn) fire(delBtn, "click");
  await wait(200);
  const afterDel = await exportSession();
  const leftIds = (afterDel.uploadedImages || []).map((i) => i.id);
  check("Editor: Screen der gelöschten Datei entfernt", leftIds.indexOf(101) === -1);
  check("Editor: Screen der gleichnamigen anderen Datei bleibt erhalten", leftIds.indexOf(102) !== -1);

  // ===================== Negativliste-Link fokussiert die Textarea im richtigen Unter-Tab =====================
  nav("benutzerhandbuch");
  fire(doc.getElementById("benutzerhandbuch-goto-negative-words-btn"), "click");
  const negPanel = doc.getElementById("negative-words-input").closest("[data-esub-panel]");
  check("Negativliste: Unter-Tab 'KI-Texterzeugung' sichtbar", !!negPanel && !negPanel.hidden);
  check("Negativliste: Textarea fokussiert", doc.activeElement === doc.getElementById("negative-words-input"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PERFORMANCE-GRENZEN/FIX-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
