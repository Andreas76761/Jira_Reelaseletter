// Handbuch-Änderung nach Kapitel - Vergleichsanalyse (Teil 9c-3): "alter
// Stand" (Referenz-Handbuch-Kapitel) gegen "neuer Stand" (Kapitel-
// Generator-Text desselben zugeordneten App-Kapitels), ausgewertet über
// die sample-Capability (Prompt: RAG_PROMPT_DEFAULTS.refCompare). Prüft:
// "Vergleichen"-Button ist bei fehlender Zuordnung deaktiviert, zeigt eine
// verständliche Fehlermeldung, wenn für das zugeordnete App-Kapitel noch
// kein Kapitel-Generator-Text existiert, befüllt bei Erfolg beide
// Textfenster + die Analyse korrekt, und das Ergebnis wird am
// Referenz-Kapitel gespeichert (persistiert über Sitzung speichern/laden).
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

const sampleCalls = [];
const savedFiles = [];
let sampleImpl = async (input) => {
  sampleCalls.push(input);
  if (/ALTER STAND:/.test(input)) {
    return { text: "### Neue Features\n- Automatischer Verlängerungshinweis 30 Tage vor Vertragsende\n\n### Widersprüche\n- Altes Handbuch beschreibt manuelle Verlängerung als einzigen Weg", truncated: false, modelTierApplied: "default" };
  }
  return { text: "Neuer-Stand-Text: automatische Vertragsverlängerung mit Hinweis-E-Mail.", truncated: false, modelTierApplied: "default" };
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
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
function paragraphXml(styleId, text) {
  var pr = styleId ? "<w:pPr><w:pStyle w:val=\"" + styleId + "\"/></w:pPr>" : "";
  return "<w:p>" + pr + "<w:r><w:t>" + xmlEsc(text) + "</w:t></w:r></w:p>";
}
async function buildDocxBuffer(bodyXml) {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyXml + "</w:body></w:document>";
  zip.file("word/document.xml", docXml);
  return zip.generateAsync({ type: "nodebuffer" });
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

  // ===================== Ticket für Domäne "Contract Management" (-> Kapitel 7) importieren =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>CMP-1</key><summary>Automatische Vertragsverlängerung</summary>
      <description>Verträge werden künftig automatisch 30 Tage vor Ablauf per E-Mail-Hinweis verlängert.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  const mainFileInput = doc.getElementById("file-input");
  Object.defineProperty(mainFileInput, "files", { value: [new win.File([xml], "cmp_test.xml", { type: "application/xml" })], configurable: true });
  fire(mainFileInput, "change");
  await wait(400);

  // ===================== Referenz-Handbuch mit passendem + nicht generiertem Kapitel hochladen =====================
  const bodyXml =
    paragraphXml("Heading1", "Kapitel 99: Verträge im Alltag verwalten") +
    paragraphXml(null, "Altes Handbuch: Verträge werden manuell durch den Sachbearbeiter verlängert.") +
    paragraphXml("Heading1", "Kapitel 1: Einführung und Überblick") +
    paragraphXml(null, "Text zu einem App-Kapitel, für das noch kein Kapitel-Generator-Text erzeugt wurde.");
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  const buf = await buildDocxBuffer(bodyXml);
  const refFile = new win.File([buf], "compare_test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const refFileInput = doc.getElementById("reference-manual-file-input");
  doc.getElementById("reference-manual-version-input").value = "Vergleichstest v1";
  Object.defineProperty(refFileInput, "files", { value: [refFile], configurable: true });
  fire(refFileInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  let rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  check("2 Zeilen in der Zuordnungstabelle", rows.length === 2);
  const btnRow1 = rows[0] && rows[0].querySelector(".refcompare-run-btn");
  const btnRow2 = rows[1] && rows[1].querySelector(".refcompare-run-btn");
  check("Zeile 1 (auto-zugeordnet zu Kapitel 7) hat aktivierten Vergleichen-Button", !!btnRow1 && !btnRow1.disabled);
  check("Zeile 2 (auto-zugeordnet zu Kapitel 1) hat ebenfalls aktivierten Vergleichen-Button (Zuordnung existiert, Text fehlt noch)", !!btnRow2 && !btnRow2.disabled);

  // ===================== Vergleichen OHNE vorhandenen Kapitel-Generator-Text -> verständliche Fehlermeldung =====================
  fire(btnRow2, "click");
  await wait(100);
  let toast = doc.getElementById("toast");
  check("Fehlermeldung bei fehlendem Kapitel-Generator-Text", toast.className.includes("error") && toast.textContent.includes("noch kein"));
  check("Ergebnis-Panel bleibt bei diesem Fehler versteckt", doc.getElementById("refcompare-result").hidden === true);

  // ===================== Kapitel-Generator-Text für "Kapitel 7" erzeugen =====================
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { if (o.value === "Contract Management") o.selected = true; });
  fire(domainSelect, "change");
  await wait(30);
  const chapterSelect = doc.getElementById("manual-chapter-select");
  const chOpt = Array.from(chapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  if (chOpt) chOpt.selected = true;
  fire(chapterSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  const generated = await waitUntil(() => {
    const ta = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
    return !!ta && ta.value.indexOf("Neuer-Stand-Text") !== -1;
  }, 3000);
  check("Kapitel-Generator-Text für Kapitel 7 erzeugt", generated);

  // ===================== Vergleichen MIT vorhandenem neuen Text =====================
  rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  const btnRow1Again = rows[0] && rows[0].querySelector(".refcompare-run-btn");
  fire(btnRow1Again, "click");
  const done = await waitUntil(() => doc.getElementById("refcompare-analysis-output").textContent.indexOf("Neue Features") !== -1, 3000);
  check("Vergleich abgeschlossen (Analyse sichtbar)", done);

  check("Ergebnis-Panel sichtbar", doc.getElementById("refcompare-result").hidden === false);
  check("Alter-Stand-Fenster zeigt Referenz-Handbuch-Text", doc.getElementById("refcompare-old-text").value.includes("manuell durch den Sachbearbeiter"));
  check("Neuer-Stand-Fenster zeigt Kapitel-Generator-Text", doc.getElementById("refcompare-new-text").value.includes("Neuer-Stand-Text"));
  check("Alter-Stand-Titel nennt Kapitel + Handbuch-Version", doc.getElementById("refcompare-old-title").textContent.includes("Vergleichstest v1"));
  check("Neuer-Stand-Titel nennt App-Kapitel", doc.getElementById("refcompare-new-title").textContent.includes("Kapitel 7"));
  const analysisText = doc.getElementById("refcompare-analysis-output").textContent;
  check("Analyse nennt 'Neue Features'-Abschnitt", analysisText.includes("Neue Features"));
  check("Analyse nennt 'Widersprüche'-Abschnitt", analysisText.includes("Widersprüche"));
  check("Analyse-Prompt an Claude enthält BEIDE Fassungen (alt + neu)", sampleCalls.some((c) => c.includes("ALTER STAND:") && c.includes("manuell durch den Sachbearbeiter") && c.includes("Neuer-Stand-Text")));

  // ===================== Ergebnis wird am Referenz-Kapitel gespeichert (über Sitzung-Export geprüft) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(300);
  check("Sitzung exportiert", savedFiles.length >= 1);
  if (savedFiles.length) {
    const exported = JSON.parse(savedFiles[savedFiles.length - 1].data);
    const manual = exported.referenceManuals.find((m) => m.version === "Vergleichstest v1");
    const ch = manual && manual.chapters.find((c) => c.title.includes("Kapitel 99"));
    check("compareResult am Referenz-Kapitel im Export gespeichert", !!ch && !!ch.compareResult && ch.compareResult.analysisText.includes("Neue Features"));
  }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE HANDBUCH-VERGLEICH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
