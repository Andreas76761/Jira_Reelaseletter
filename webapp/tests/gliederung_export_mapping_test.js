// Register "Gliederung": Funktion "Gliederung exportieren & zuordnen"
// (Teil 9d) - umgebaut von einem einmaligen Struktur-Diff zu einer
// dauerhaften, fuzzy-gematchten Kapitel-Zuordnungstabelle (analog zum
// Referenz-Handbuch-Mapping). Prüft: Export der aktuellen Gliederung als
// eigenes JSON-Format (Round-Trip), Hochladen einer JSON- sowie einer
// .docx-Gliederung (mehrere gleichzeitig), automatischer Zuordnungs-
// Vorschlag per Fuzzy-Matching (wortbasierte Titel-Ähnlichkeit - auch bei
// NICHT exakt identischen Titeln), "– nicht zugeordnet –" bei zu
// unähnlichen Titeln, manuelle Korrektur per Dropdown bleibt dauerhaft
// erhalten, Umschalten zwischen MEHREREN hochgeladenen Gliederungen (jede
// mit eigener, unabhängiger Zuordnung), Ablehnung nicht unterstützter
// Dateiformate/kaputter JSON-Dateien, Löschen (inkl. Fallback bei Löschen
// der aktiven Gliederung) sowie Einbindung in Sitzung speichern/laden.
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
  var pr = styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : "";
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

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>GL-1</key><summary>Testticket für Sitzung-Export</summary>
    <description>Dummy-Ticket, nur damit der Sitzung-Export nicht wegen 0 Tickets blockiert.</description>
    <status>Offen</status><type>Task</type></item>
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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "gl_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(100);

  check("Export-Button vorhanden", !!doc.getElementById("outline-export-btn"));
  check("Upload-Dropzone vorhanden", !!doc.getElementById("outline-compare-dropzone"));
  check("Leer-Hinweis anfangs sichtbar (noch keine Gliederung hochgeladen)", doc.getElementById("outline-uploaded-empty").hidden === false);
  check("Zuordnungs-Bereich anfangs versteckt (noch keine Gliederung hochgeladen)", doc.getElementById("outline-mapping-wrap").hidden === true);

  // ===================== Export der aktuellen Gliederung =====================
  const savedBefore = savedFiles.length;
  fire(doc.getElementById("outline-export-btn"), "click");
  await wait(100);
  check("Export ausgelöst (neue Datei gespeichert)", savedFiles.length === savedBefore + 1);
  const exportFile = savedFiles[savedBefore];
  check("Exportierte Datei endet auf .json", (exportFile.filename || "").endsWith(".json"));
  const exportedPayload = JSON.parse(exportFile.data);
  check("Export enthält Feld „outline“ mit mind. 2 Kapiteln", Array.isArray(exportedPayload.outline) && exportedPayload.outline.length > 1);

  const realFirstChapter = exportedPayload.outline[0].title;
  const realSecondChapter = exportedPayload.outline[1].title;

  // ===================== Erste hochgeladene Gliederung (JSON) - Fuzzy-Matching =====================
  // Enthaelt: (a) eine LEICHT ABWEICHENDE Variante des ersten echten
  // Kapiteltitels (Woerter geteilt, aber nicht identisch - prueft echtes
  // Fuzzy-Matching statt reinem exaktem Abgleich), (b) einen voellig
  // unaehnlichen Titel (sollte NICHT zugeordnet werden).
  const fuzzyVariant = realFirstChapter + " (aktualisiert)";
  const unrelatedTitle = "Zufälliges Thema XYZ 42";
  const outlineA = {
    outline: [
      { title: fuzzyVariant, subs: [] },
      { title: unrelatedTitle, subs: [] }
    ]
  };
  const jsonInputA = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(jsonInputA, "files", { value: [new win.File([JSON.stringify(outlineA)], "gliederung_a.json", { type: "application/json" })], configurable: true });
  fire(jsonInputA, "change");
  await wait(150);

  check("Gliederung A hochgeladen (1 Eintrag in der Übersicht)", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 1);
  check("Zuordnungs-Bereich nach Upload sichtbar", doc.getElementById("outline-mapping-wrap").hidden === false);
  check("Zuordnungs-Auswahl zeigt Gliederung A als aktiv", doc.getElementById("outline-mapping-select").value !== "" &&
    doc.getElementById("outline-mapping-select").options[doc.getElementById("outline-mapping-select").selectedIndex].textContent.includes("gliederung_a.json"));

  const mappingRowFor = (chapterTitle) => Array.from(doc.getElementById("outline-mapping-tbody").querySelectorAll("tr")).find((r) => r.children[0].textContent === chapterTitle);

  const rowFirst = mappingRowFor(realFirstChapter);
  check("Fuzzy-Matching: leicht abweichender Titel wird trotzdem automatisch zugeordnet", !!rowFirst && rowFirst.querySelector(".outline-mapping-select").value === fuzzyVariant);
  const rowSecond = mappingRowFor(realSecondChapter);
  check("Kein passendes Kapitel: bleibt „– nicht zugeordnet –“", !!rowSecond && rowSecond.querySelector(".outline-mapping-select").value === "");
  check("Dropdown bietet auch den unähnlichen Titel zur manuellen Auswahl an",
    !!rowSecond && Array.from(rowSecond.querySelector(".outline-mapping-select").options).some((o) => o.value === unrelatedTitle));

  // ===================== Manuelle Korrektur bleibt dauerhaft erhalten =====================
  const rowSecondSelect = rowSecond.querySelector(".outline-mapping-select");
  rowSecondSelect.value = unrelatedTitle;
  fire(rowSecondSelect, "change");
  await wait(30);
  // Zuordnungs-Auswahl einmal weg- und wieder hin-wechseln (Re-Render), um zu pruefen, dass die manuelle Korrektur nicht verlorengeht.
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(30);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(30);
  const rowSecondAfter = mappingRowFor(realSecondChapter);
  check("Manuelle Korrektur bleibt nach Re-Render erhalten", !!rowSecondAfter && rowSecondAfter.querySelector(".outline-mapping-select").value === unrelatedTitle);

  // ===================== Zweite hochgeladene Gliederung (.docx) - mehrere Gliederungen gleichzeitig =====================
  var docxBody = paragraphXml("Heading1", realFirstChapter) + paragraphXml("Heading1", "Docx-Kapitel Zwei");
  var docxBuf = await buildDocxBuffer(docxBody);
  const docxInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(docxInput, "files", { value: [new win.File([docxBuf], "gliederung_b.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })], configurable: true });
  fire(docxInput, "change");
  await wait(300);

  check("Jetzt 2 hochgeladene Gliederungen in der Übersicht", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);
  check("Zuordnungs-Auswahl bietet beide Gliederungen an", doc.getElementById("outline-mapping-select").options.length === 2);
  check("Neueste (Gliederung B) automatisch aktiv", doc.getElementById("outline-mapping-select").options[doc.getElementById("outline-mapping-select").selectedIndex].textContent.includes("gliederung_b.docx"));
  const rowFirstForB = mappingRowFor(realFirstChapter);
  check("Gliederung B: erstes Kapitel exakt zugeordnet (identischer Titel aus dem docx)", !!rowFirstForB && rowFirstForB.querySelector(".outline-mapping-select").value === realFirstChapter);

  // ===================== Umschalten zurück zu Gliederung A: eigene (unabhängige) Zuordnung bleibt erhalten =====================
  const mappingSelect = doc.getElementById("outline-mapping-select");
  const optionA = Array.from(mappingSelect.options).find((o) => o.textContent.includes("gliederung_a.json"));
  mappingSelect.value = optionA.value;
  fire(mappingSelect, "change");
  await wait(30);
  const rowSecondBackToA = mappingRowFor(realSecondChapter);
  check("Zurück zu Gliederung A: die dort gespeicherte manuelle Zuordnung ist weiterhin vorhanden (unabhängig von Gliederung B)",
    !!rowSecondBackToA && rowSecondBackToA.querySelector(".outline-mapping-select").value === unrelatedTitle);
  const rowFirstBackToA = mappingRowFor(realFirstChapter);
  check("Zurück zu Gliederung A: Fuzzy-Vorschlag (nicht Gliederung-B-Wert) weiterhin korrekt",
    !!rowFirstBackToA && rowFirstBackToA.querySelector(".outline-mapping-select").value === fuzzyVariant);

  // ===================== Nicht unterstütztes Format =====================
  const badInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(badInput, "files", { value: [new win.File(["Ein beliebiger Text."], "gliederung.txt", { type: "text/plain" })], configurable: true });
  fire(badInput, "change");
  await wait(100);
  check("Nicht unterstütztes Format zeigt verständlichen Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Format nicht unterstützt"));
  check("Nach abgelehntem Format weiterhin 2 Einträge (kein Geister-Eintrag)", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);

  // ===================== Kaputte JSON-Datei =====================
  const brokenInput = doc.getElementById("outline-compare-file-input");
  Object.defineProperty(brokenInput, "files", { value: [new win.File(["{ das ist kein gueltiges JSON"], "kaputt.json", { type: "application/json" })], configurable: true });
  fire(brokenInput, "change");
  await wait(100);
  check("Kaputte JSON-Datei zeigt Fehler-Toast statt Absturz", doc.getElementById("toast").textContent.includes("fehlgeschlagen"));
  check("Nach kaputter Datei weiterhin 2 Einträge", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);

  // ===================== Sitzung speichern/laden (chapterMapping + aktive Auswahl) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const sessionSavedBefore = savedFiles.length;
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(100);
  const sessionJson = savedFiles[sessionSavedBefore].data;
  const sessionData = JSON.parse(sessionJson);
  check("Gesicherte Sitzung enthält uploadedOutlines (2 Einträge)", Array.isArray(sessionData.uploadedOutlines) && sessionData.uploadedOutlines.length === 2);
  const savedEntryA = sessionData.uploadedOutlines.find((u) => u.filename === "gliederung_a.json");
  check("Gesicherte Sitzung enthält die manuelle Zuordnung von Gliederung A", !!savedEntryA && savedEntryA.chapterMapping[realSecondChapter] === unrelatedTitle);
  check("Gesicherte Sitzung enthält outlineCompareActiveId", sessionData.outlineCompareActiveId !== undefined);

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  check("Nach „Alle Daten löschen“: Zuordnungs-Bereich wieder versteckt", doc.getElementById("outline-mapping-wrap").hidden === true);

  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "sitzung.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(200);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  check("Nach Sitzung-Laden: beide hochgeladenen Gliederungen wiederhergestellt", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 2);
  const mappingSelectAfterLoad = doc.getElementById("outline-mapping-select");
  const optionAAfterLoad = Array.from(mappingSelectAfterLoad.options).find((o) => o.textContent.includes("gliederung_a.json"));
  mappingSelectAfterLoad.value = optionAAfterLoad.value;
  fire(mappingSelectAfterLoad, "change");
  await wait(30);
  const rowSecondAfterLoad = mappingRowFor(realSecondChapter);
  check("Nach Sitzung-Laden: manuelle Zuordnung von Gliederung A weiterhin vorhanden", !!rowSecondAfterLoad && rowSecondAfterLoad.querySelector(".outline-mapping-select").value === unrelatedTitle);

  // ===================== Löschen der aktiven Gliederung: sauberer Fallback =====================
  const activeDeleteBtn = doc.querySelector(".outline-compare-delete-btn");
  fire(activeDeleteBtn, "click");
  await confirmViaModal(doc);
  check("Nach Löschen: nur noch 1 hochgeladene Gliederung", doc.getElementById("outline-uploaded-tbody").querySelectorAll("tr").length === 1);
  check("Zuordnungs-Bereich zeigt weiterhin die verbleibende Gliederung (kein Absturz)", doc.getElementById("outline-mapping-wrap").hidden === false);

  fire(doc.querySelector(".outline-compare-delete-btn"), "click");
  await confirmViaModal(doc);
  check("Nach Löschen der letzten Gliederung: Zuordnungs-Bereich wieder versteckt", doc.getElementById("outline-mapping-wrap").hidden === true);
  check("Nach Löschen der letzten Gliederung: Leer-Hinweis wieder sichtbar", doc.getElementById("outline-uploaded-empty").hidden === false);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE GLIEDERUNG-EXPORT-ZUORDNUNG-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
