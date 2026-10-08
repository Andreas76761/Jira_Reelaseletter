// Import: neues Format "MD-Dateien" - liest zuvor von dieser App als
// Markdown exportierte Einzelticket-Dateien (renderMarkdown()/"Output MD
// Tickets") wieder ein, entweder mehrere einzelne .md-Dateien auf einmal
// oder ein .zip-Archiv mit mehreren .md-Dateien, und fuehrt sie zu EINEM
// Import zusammen (erscheint in Dashboard/Verarbeitung/Dateiverwaltung wie
// jeder andere Import).
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

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name !== "downloads") return Promise.resolve(null);
        return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
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

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Eingebettete Demo-Tickets zuerst entfernen, damit "Output MD Tickets"
  // unten exakt die beiden hier importierten Test-Tickets exportiert.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>MDRT-1</key><summary>Erstes Testticket fuer MD-Reimport</summary>
      <description>Mehrzeilige Beschreibung.
Zweite Zeile der Beschreibung.</description>
      <status>Offen</status><type>Feature</type><priority>Hoch</priority>
      <labels><label>Wichtig</label><label>Reimport</label></labels>
      <component>Kernmodul</component>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>MDRT-2</key><summary>Zweites Testticket fuer MD-Reimport</summary>
      <description>Nur eine Beschreibungszeile.</description>
      <status>Fertig</status><type>Bug</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const importInput = doc.getElementById("file-input");
  Object.defineProperty(importInput, "files", { value: [new win.File([xml], "mdrt_test.xml", { type: "application/xml" })], configurable: true });
  fire(importInput, "change");
  await wait(400);

  // ===================== Echten Export über "Output MD Tickets" einlesen (garantiert exaktes Format) =====================
  doc.querySelector('.nav-item[data-view="output-md"]').click();
  await wait(50);
  fire(doc.getElementById("output-md-export-btn"), "click");
  for (let waited = 0; waited < 5000 && !savedFiles.length; waited += 100) await wait(100);
  check("Output-MD-Export hat genau 1 ZIP gespeichert", savedFiles.length === 1);
  const exportZip = await JSZipNode.loadAsync(savedFiles[0].data);
  const exportNames = Object.keys(exportZip.files).sort();
  check("Export-ZIP enthält genau 2 .md-Dateien (MDRT-1.md, MDRT-2.md)", exportNames.length === 2 && exportNames.includes("MDRT-1.md") && exportNames.includes("MDRT-2.md"));
  const mdrt1Text = await exportZip.file("MDRT-1.md").async("string");
  const mdrt2Text = await exportZip.file("MDRT-2.md").async("string");
  check("Exportierte MDRT-1.md enthält Zwischenüberschrift 'Beschreibung'", mdrt1Text.includes("## Beschreibung"));
  check("Exportierte MDRT-1.md enthält Feld/Wert-Tabelle", mdrt1Text.includes("| Feld | Wert |"));

  // Beide Original-Tickets löschen (über 'Alle Daten löschen'), um den
  // Reimport unten eindeutig nachweisen zu können.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  check("Nach Löschen: Dashboard-Tabelle leer", doc.getElementById("table-body").textContent.trim() === "" || !doc.getElementById("table-body").textContent.includes("MDRT-"));

  // ===================== Neuer Import-Tab "MD-Dateien" =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  const mdTab = doc.querySelector('.import-tab[data-mode="md-dateien"]');
  check("Import-Tab 'MD-Dateien' vorhanden", !!mdTab);
  fire(mdTab, "click");
  await wait(50);
  check("MD-Dateien-Dropzone akzeptiert .md und .zip", doc.getElementById("file-input").getAttribute("accept").includes(".md") && doc.getElementById("file-input").getAttribute("accept").includes(".zip"));
  check("Erklärender Hinweistext bei MD-Dateien sichtbar", doc.getElementById("md-dateien-callout").hidden === false);
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  check("Hinweistext bei anderen Tabs wieder versteckt", doc.getElementById("md-dateien-callout").hidden === true);
  fire(mdTab, "click");
  await wait(50);

  // ===================== (1) Zwei einzelne .md-Dateien auf einmal hochladen -> EIN Import =====================
  const file1 = new win.File([mdrt1Text], "MDRT-1.md", { type: "text/markdown" });
  const file2 = new win.File([mdrt2Text], "MDRT-2.md", { type: "text/markdown" });
  const mdInput = doc.getElementById("file-input");
  Object.defineProperty(mdInput, "files", { value: [file1, file2], configurable: true });
  const toastBefore1 = doc.getElementById("toast").textContent;
  fire(mdInput, "change");
  for (let waited = 0; waited < 5000 && doc.getElementById("toast").textContent === toastBefore1; waited += 100) await wait(100);
  const toast1 = doc.getElementById("toast");
  check("Import-Toast (2 einzelne .md) zeigt keinen Fehler", !toast1.className.includes("error"));
  check("Import-Toast nennt 2 Tickets aus 2/2 Datei(en)", toast1.textContent.includes("2 Tickets aus 2/2"));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  await wait(50);
  const importRows = Array.from(doc.querySelectorAll("#imports-tbody tr"));
  check("Genau EIN Import-Eintrag für die 2 hochgeladenen MD-Dateien (nicht 2 einzelne)", importRows.length === 1);
  check("Import-Format nennt 'MD-Dateien'", importRows[0] && importRows[0].textContent.includes("MD-Dateien"));

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  setValue(doc.getElementById("search-input"), "MDRT-");
  await wait(200);
  const dashboardText1 = doc.getElementById("table-body").textContent;
  check("MDRT-1 nach Reimport im Dashboard auffindbar", dashboardText1.includes("MDRT-1"));
  check("MDRT-2 nach Reimport im Dashboard auffindbar", dashboardText1.includes("MDRT-2"));
  check("Zusammenfassung von MDRT-1 nach Reimport korrekt", dashboardText1.includes("Erstes Testticket fuer MD-Reimport"));

  // Felder (Typ/Status/Priorität/Labels/Komponenten/Custom-Field Domain/
  // mehrzeilige Beschreibung) im Detail-Modal von MDRT-1 prüfen.
  const row1 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("MDRT-1"));
  fire(row1, "click");
  await wait(50);
  const modalText = doc.getElementById("modal-fields").textContent;
  const modalDescText = doc.getElementById("modal-desc").textContent;
  check("Detailansicht MDRT-1: Typ 'Feature' korrekt rückübernommen", modalText.includes("Feature"));
  check("Detailansicht MDRT-1: Status 'Offen' korrekt rückübernommen", modalText.includes("Offen"));
  check("Detailansicht MDRT-1: Priorität 'Hoch' korrekt rückübernommen", modalText.includes("Hoch"));
  check("Detailansicht MDRT-1: Labels 'Wichtig'/'Reimport' korrekt rückübernommen (Array-Feld)", modalText.includes("Wichtig") && modalText.includes("Reimport"));
  check("Detailansicht MDRT-1: Komponente 'Kernmodul' korrekt rückübernommen", modalText.includes("Kernmodul"));
  check("Detailansicht MDRT-1: Custom-Field Domain 'Contract Management' korrekt rückübernommen", modalText.includes("Contract Management"));
  check("Detailansicht MDRT-1: mehrzeilige Beschreibung vollständig rückübernommen", modalDescText.includes("Mehrzeilige Beschreibung.") && modalDescText.includes("Zweite Zeile der Beschreibung."));
  fire(doc.getElementById("modal-close"), "click");
  await wait(30);

  // ===================== (2) Alles löschen, dann ZIP mit mehreren .md-Dateien hochladen -> EIN Import =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  const zip2 = new JSZipNode();
  zip2.file("MDRT-1.md", mdrt1Text);
  zip2.file("MDRT-2.md", mdrt2Text);
  zip2.file("__MACOSX/._MDRT-1.md", "irrelevant");
  const zipBuf2 = await zip2.generateAsync({ type: "nodebuffer" });
  const zipFile2 = new win.File([zipBuf2], "mdrt_export.zip", { type: "application/zip" });

  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  fire(doc.querySelector('.import-tab[data-mode="md-dateien"]'), "click");
  await wait(50);
  const mdInput2 = doc.getElementById("file-input");
  Object.defineProperty(mdInput2, "files", { value: [zipFile2], configurable: true });
  const toastBefore2 = doc.getElementById("toast").textContent;
  fire(mdInput2, "change");
  for (let waited = 0; waited < 5000 && doc.getElementById("toast").textContent === toastBefore2; waited += 100) await wait(100);
  const toast2 = doc.getElementById("toast");
  check("Import-Toast (ZIP mit 2 MD-Dateien) zeigt keinen Fehler", !toast2.className.includes("error"));
  check("Import-Toast (ZIP) nennt 2 Tickets aus 2/2 Datei(en) (macOS-Metadatei ignoriert)", toast2.textContent.includes("2 Tickets aus 2/2"));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  await wait(50);
  const importRows2 = Array.from(doc.querySelectorAll("#imports-tbody tr"));
  check("Genau EIN Import-Eintrag für das ZIP (nicht je Eintrag einer)", importRows2.length === 1);
  check("Import-Zeile nennt den ZIP-Dateinamen", importRows2[0] && importRows2[0].textContent.includes("mdrt_export.zip"));

  // ===================== (3) Teilweiser Fehlschlag: ZIP mit einer kaputten MD-Datei =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  const zip3 = new JSZipNode();
  zip3.file("MDRT-1.md", mdrt1Text);
  zip3.file("kaputt.md", "Das ist keine gültige Ticket-Markdown-Datei ohne Überschrift.");
  const zipBuf3 = await zip3.generateAsync({ type: "nodebuffer" });
  const zipFile3 = new win.File([zipBuf3], "teilweise_kaputt.zip", { type: "application/zip" });

  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  fire(doc.querySelector('.import-tab[data-mode="md-dateien"]'), "click");
  await wait(50);
  const mdInput3 = doc.getElementById("file-input");
  Object.defineProperty(mdInput3, "files", { value: [zipFile3], configurable: true });
  const toastBefore3 = doc.getElementById("toast").textContent;
  fire(mdInput3, "change");
  for (let waited = 0; waited < 5000 && doc.getElementById("toast").textContent === toastBefore3; waited += 100) await wait(100);
  const toast3 = doc.getElementById("toast");
  check("Teilweiser Fehlschlag: Toast meldet 'teilweise erfolgreich'", toast3.textContent.includes("teilweise erfolgreich") || toast3.className.includes("error"));
  check("Teilweiser Fehlschlag: 1/2 Datei(en) gelesen genannt", toast3.textContent.includes("1/2"));
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(50);
  check("Protokoll enthält Fehler-Eintrag für 'kaputt.md'", doc.body.textContent.includes("kaputt.md"));

  function setValue(el, v) { el.value = v; fire(el, "input"); }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MD-DATEIEN-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
