// Handbuch-Änderung nach Kapitel - dieselbe Vergleichsansicht zusätzlich im
// Releaseletter (Teil 9c-4): beide Instanzen (Benutzerhandbuch/
// "refcompare-*" und Releaseletter/"rlrefcompare-*") teilen sich
// app.referenceManuals/app.refCompareActiveManualId, haben aber je ein
// eigenes, unabhängiges Ergebnis-Panel. Prüft: Sektion im Releaseletter
// vorhanden, Zuordnung/aktives Handbuch sind zwischen beiden Ansichten
// synchron, "Vergleichen" in EINER Ansicht befüllt NUR deren eigenes Panel
// (nicht das der anderen Ansicht), und der frühere Initialisierungs-Bug
// (siehe reference_manual_import_test.js-Regression) bleibt behoben -
// dieser Test überdeckt insbesondere, dass die App nach dem Laden
// vollständig funktionsfähig ist (Navigation, Kapitel-Generator etc.).
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

let sampleImpl = async (input) => {
  if (/ALTER STAND:/.test(input)) {
    return { text: "### Neue Features\n- Testfeature\n\n### Widersprüche\nKeine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "Neuer-Stand-Text: Testinhalt.", truncated: false, modelTierApplied: "default" };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
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

  // ===================== Grund-Funktionsfähigkeit (Regressionsschutz gegen den Skript-Abbruch-Bug) =====================
  check("Nav-Punkt Dashboard klickbar (Navigation grundsätzlich verdrahtet)", !!doc.querySelector('.nav-item[data-view="dashboard"]'));
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  check("Dashboard-Panel nach Klick sichtbar", doc.querySelector('[data-view-panel="dashboard"]').hidden === false);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  check("Benutzerhandbuch-Panel nach Klick sichtbar", doc.querySelector('[data-view-panel="benutzerhandbuch"]').hidden === false);
  check("Dashboard-Panel jetzt wieder versteckt (Navigation schaltet tatsächlich um)", doc.querySelector('[data-view-panel="dashboard"]').hidden === true);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== Ticket für Domäne "Contract Management" (-> Kapitel 7) + Referenz-Handbuch =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>RLC-1</key><summary>Testticket</summary><description>Testinhalt für den Releaseletter-Vergleich.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  const mainFileInput = doc.getElementById("file-input");
  Object.defineProperty(mainFileInput, "files", { value: [new win.File([xml], "rlc_test.xml", { type: "application/xml" })], configurable: true });
  fire(mainFileInput, "change");
  await wait(400);

  const bodyXml = paragraphXml("Heading1", "Kapitel 99: Verträge im Alltag verwalten") + paragraphXml(null, "Alter Handbuchtext.");
  const buf = await buildDocxBuffer(bodyXml);
  const refFile = new win.File([buf], "rlc_manual.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const refFileInput = doc.getElementById("reference-manual-file-input");
  doc.getElementById("reference-manual-version-input").value = "RL-Test v1";
  Object.defineProperty(refFileInput, "files", { value: [refFile], configurable: true });
  fire(refFileInput, "change");
  await wait(300);

  // ===================== Sektion im Releaseletter vorhanden und zeigt dieselbe Zuordnung wie im Benutzerhandbuch =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(100);
  check("Releaseletter-Panel sichtbar", doc.querySelector('[data-view-panel="releaseletter"]').hidden === false);
  check("Zuordnungs-Bereich im Releaseletter vorhanden und sichtbar", doc.getElementById("rlrefcompare-controls") && doc.getElementById("rlrefcompare-controls").hidden === false);
  check("Referenz-Handbuch-Auswahl im Releaseletter zeigt den Upload", doc.getElementById("rlrefcompare-manual-select").options.length === 1 &&
    doc.getElementById("rlrefcompare-manual-select").options[0].textContent.includes("RL-Test v1"));
  let rlRows = Array.from(doc.querySelectorAll("#rlrefcompare-mapping-tbody tr"));
  check("Releaseletter-Zuordnungstabelle zeigt 1 Kapitel", rlRows.length === 1);
  const rlSelect = rlRows[0] && rlRows[0].querySelector(".refcompare-mapping-select");
  check("Auto-Zuordnung im Releaseletter identisch zum Benutzerhandbuch (Kapitel 7)", !!rlSelect && rlSelect.value === "Kapitel 7: Verträge im Alltag verwalten");

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  let bhRows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  check("Benutzerhandbuch-Zuordnungstabelle zeigt dieselbe 1 Zeile (geteilte Daten)", bhRows.length === 1);
  const bhSelect = bhRows[0] && bhRows[0].querySelector(".refcompare-mapping-select");
  check("Zuordnung im Benutzerhandbuch ebenfalls Kapitel 7", !!bhSelect && bhSelect.value === "Kapitel 7: Verträge im Alltag verwalten");

  // ===================== Kapitel-Generator-Text erzeugen =====================
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
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
  check("Kapitel-Generator-Text erzeugt", generated);

  // ===================== "Vergleichen" im Releaseletter befüllt NUR dessen eigenes Panel =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(100);
  rlRows = Array.from(doc.querySelectorAll("#rlrefcompare-mapping-tbody tr"));
  const rlRunBtn = rlRows[0] && rlRows[0].querySelector(".refcompare-run-btn");
  check("Vergleichen-Button im Releaseletter aktiviert", !!rlRunBtn && !rlRunBtn.disabled);
  fire(rlRunBtn, "click");
  const rlDone = await waitUntil(() => doc.getElementById("rlrefcompare-analysis-output").textContent.indexOf("Neue Features") !== -1, 3000);
  check("Vergleich im Releaseletter abgeschlossen", rlDone);
  check("Releaseletter-Ergebnis-Panel sichtbar", doc.getElementById("rlrefcompare-result").hidden === false);
  check("Releaseletter Alter-Stand-Fenster zeigt Referenz-Text", doc.getElementById("rlrefcompare-old-text").value.includes("Alter Handbuchtext"));
  check("Releaseletter Neuer-Stand-Fenster zeigt Kapitel-Generator-Text", doc.getElementById("rlrefcompare-new-text").value.includes("Neuer-Stand-Text"));

  // Das Benutzerhandbuch-eigene Panel darf davon UNBERÜHRT bleiben (eigenes,
  // unabhängiges Ergebnis-Panel je Ansicht).
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Benutzerhandbuch-Ergebnis-Panel bleibt versteckt (kein Vergleich dort ausgelöst)", doc.getElementById("refcompare-result").hidden === true);

  // ===================== Manuelle Zuordnungsänderung im Benutzerhandbuch spiegelt sich im Releaseletter =====================
  bhRows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  const bhSelect2 = bhRows[0].querySelector(".refcompare-mapping-select");
  bhSelect2.value = "Kapitel 1: Einführung und Überblick";
  fire(bhSelect2, "change");
  await wait(50);
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(100);
  rlRows = Array.from(doc.querySelectorAll("#rlrefcompare-mapping-tbody tr"));
  const rlSelectAfter = rlRows[0].querySelector(".refcompare-mapping-select");
  check("Im Benutzerhandbuch geänderte Zuordnung erscheint auch im Releaseletter (geteilte Daten)", rlSelectAfter.value === "Kapitel 1: Einführung und Überblick");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RELEASELETTER-VERGLEICH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
