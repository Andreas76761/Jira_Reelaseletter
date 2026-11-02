// Neues Register "FINAL" (letzter Schritt vor der Ablieferung): mehrere
// Benutzerhandbuch-.docx-Dateien hochladen (Kapitelerkennung per Word-
// Formatvorlage + Erkennung ECHTER Word-Kommentarbereiche als "interne
// Vermerke"), wahlweise interne Vermerke/Jira-Nummern ausblenden, bei
// mehrfach vorkommenden Kapiteln die Quelldatei manuell wählen, eine
// separate Screens-Datei je Rolle/Sparte/Sprache/Markt hochladen und deren
// Screens Kapiteln zuordnen, daraus ein Master-Dokument (Word+PDF, mit
// echten eingebetteten Bildern) zusammenführen und am Ende Quellversion vs.
// neue Zusammenführung vergleichen. Prüft: Upload/Kapitelerkennung,
// Kommentarbereich-Erkennung (mit/ohne interne Vermerke), Jira-Nummern-
// Ausblendung, Mehrfach-Kapitel-Konfliktauswahl, Screens-Upload +
// Zuordnung, Master-Export (echte Medien-Prüfung), Ergebnis-Anzeige, Reset.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");

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
    window.jspdf = { jsPDF: jsPDF };
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
async function blobToBuffer(blob) { return Buffer.from(await blob.arrayBuffer()); }

const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function headingP(text) {
  return '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>";
}
function plainP(text) {
  return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>";
}
function commentedP(text, id) {
  return "<w:p>" +
    '<w:commentRangeStart w:id="' + id + '"/>' +
    "<w:r><w:t>" + esc(text) + "</w:t></w:r>" +
    '<w:commentRangeEnd w:id="' + id + '"/>' +
    '<w:r><w:commentReference w:id="' + id + '"/></w:r>' +
    "</w:p>";
}
async function buildManualDocx(bodyXml) {
  var zip = new JSZipNode();
  zip.file("word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" + bodyXml + "</w:body></w:document>");
  return zip.generateAsync({ type: "nodebuffer" });
}
async function buildScreensDocx() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Maske Vertragsänderung</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' +
    "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/media/image1.png", PNG_1X1);
  return zip.generateAsync({ type: "nodebuffer" });
}

const KAP1 = "Kapitel 1: Verträge";
const KAP2 = "Kapitel 2: Kündigung";
const KAP3 = "Kapitel 3: Verlängerung";
const FASSUNG_B_SATZ = "Fassung B: Der Dealer kann den Vertrag jederzeit online anpassen.";

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

  // Mindestens 1 Ticket importieren - "Alle Daten löschen" bricht sonst mit
  // "Nichts zu löschen" ab (Guard: !app.tickets.length && !app.imports.length).
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);
  const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>FIN-1</key><summary>Dummy-Ticket fuer FINAL-Test</summary><description>Nur damit "Alle Daten löschen" nicht wegen 0 Tickets abbricht.</description><status>Offen</status><type>Task</type></item>
</channel></rss>`;
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "final_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(200);

  // ===================== Manual A hochladen (2 Kapitel, 1 interner Vermerk, 1 Jira-Nummer) =====================
  const manualABuf = await buildManualDocx(
    headingP(KAP1) +
    plainP("Der Dealer ändert den Vertrag online.") +
    commentedP("TODO: Rechtsprüfung noch ausstehend (ABC-123).", 0) +
    plainP("Eine schriftliche Bestätigung ist nicht nötig.") +
    headingP(KAP2) +
    plainP("Kündigungsfristen werden angezeigt (DEF-456).")
  );
  const manualAFile = new win.File([manualABuf], "handbuch_a.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const manualInput = doc.getElementById("final-manual-file-input");
  Object.defineProperty(manualInput, "files", { value: [manualAFile], configurable: true });
  fire(manualInput, "change");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").textContent.includes("handbuch_a.docx"), 2000);
  check("Manual A: 2 Kapitel erkannt", doc.getElementById("final-manuals-tbody").textContent.includes("handbuch_a.docx") &&
    /handbuch_a\.docx[\s\S]*?<td>2<\/td>/.test(doc.getElementById("final-manuals-tbody").innerHTML));
  check("Konflikt-Abschnitt bei nur 1 Datei noch versteckt", doc.getElementById("final-conflicts-section").hidden === true);

  // ===================== Manual B hochladen (Kapitel 1 erneut + Kapitel 3, Konflikt bei Kapitel 1) =====================
  const manualBBuf = await buildManualDocx(
    headingP(KAP1) +
    plainP(FASSUNG_B_SATZ) +
    headingP(KAP3) +
    plainP("Verträge verlängern sich automatisch um 12 Monate.")
  );
  const manualBFile = new win.File([manualBBuf], "handbuch_b.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  Object.defineProperty(manualInput, "files", { value: [manualBFile], configurable: true });
  fire(manualInput, "change");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").textContent.includes("handbuch_b.docx"), 2000);

  check("Konflikt-Abschnitt jetzt sichtbar (Kapitel 1 in beiden Dateien)", doc.getElementById("final-conflicts-section").hidden === false);
  check("Konflikt-Tabelle nennt Kapitel 1", doc.getElementById("final-conflicts-tbody").textContent.includes(KAP1));
  check("Konflikt-Tabelle bietet beide Dateien als Option", doc.getElementById("final-conflicts-tbody").innerHTML.includes("handbuch_a.docx") &&
    doc.getElementById("final-conflicts-tbody").innerHTML.includes("handbuch_b.docx"));

  // Quelle für Kapitel 1 waehlen - renderFinal() baut die Konflikt-Tabelle
  // (und damit dieses <select>) bei jeder Aenderung komplett neu auf, daher
  // IMMER frisch abfragen statt eine Referenz ueber mehrere Aenderungen
  // hinweg wiederzuverwenden (sonst zeigt ein zweiter fire() auf einen
  // bereits aus dem DOM entfernten, verwaisten Knoten).
  function setFinalConflictSource(chapterTitle, filename) {
    var sel = doc.querySelector('[data-final-conflict-chapter="' + chapterTitle + '"]');
    var optionId = Array.from(sel.options).filter((o) => o.textContent === filename)[0].value;
    sel.value = optionId;
    fire(sel, "change");
  }
  setFinalConflictSource(KAP1, "handbuch_b.docx");
  await wait(100);

  // ===================== Vorschau: mit/ohne interne Vermerke, mit/ohne Jira-Nummern =====================
  check("Vorschau-Abschnitt sichtbar", doc.getElementById("final-preview-section").hidden === false);
  const previewSelect = doc.getElementById("final-preview-chapter-select");
  previewSelect.value = KAP2; // nicht von Konflikt betroffen, Jira-Nummer DEF-456 enthalten
  fire(previewSelect, "change");
  await wait(50);
  check("Vorschau Kapitel 2 (mit allem) enthält Jira-Nummer DEF-456", doc.getElementById("final-preview-output").textContent.includes("DEF-456"));

  const hideJiraCb = doc.getElementById("final-hide-jira-cb");
  hideJiraCb.checked = true;
  fire(hideJiraCb, "change");
  await wait(50);
  check("Nach 'Jira-Nummern ausblenden': DEF-456 verschwindet", !doc.getElementById("final-preview-output").textContent.includes("DEF-456"));
  check("Nach 'Jira-Nummern ausblenden': restlicher Text bleibt erhalten", doc.getElementById("final-preview-output").textContent.includes("Kündigungsfristen werden angezeigt"));
  hideJiraCb.checked = false;
  fire(hideJiraCb, "change");
  await wait(50);

  previewSelect.value = KAP1; // jetzt Fassung B (kein interner Vermerk mehr enthalten)
  fire(previewSelect, "change");
  await wait(50);
  check("Vorschau Kapitel 1 zeigt jetzt Fassung B (Konflikt-Auswahl wirkt)", doc.getElementById("final-preview-output").textContent.includes(FASSUNG_B_SATZ));

  const hideInternalCb = doc.getElementById("final-hide-internal-cb");
  // Zurueck auf Fassung A wechseln, um den internen Vermerk zu testen
  setFinalConflictSource(KAP1, "handbuch_a.docx");
  await wait(50);
  fire(previewSelect, "change");
  await wait(50);
  check("Vorschau Kapitel 1 (Fassung A, mit internen Vermerken) enthält TODO-Satz", doc.getElementById("final-preview-output").textContent.includes("Rechtsprüfung noch ausstehend"));
  check("Vorschau Kapitel 1 (mit internen Vermerken) enthält normalen Text davor/danach", doc.getElementById("final-preview-output").textContent.includes("Der Dealer ändert den Vertrag online.") &&
    doc.getElementById("final-preview-output").textContent.includes("Eine schriftliche Bestätigung ist nicht nötig."));

  hideInternalCb.checked = true;
  fire(hideInternalCb, "change");
  await wait(50);
  check("Nach 'Interne Vermerke ausblenden': TODO-Satz verschwindet", !doc.getElementById("final-preview-output").textContent.includes("Rechtsprüfung noch ausstehend"));
  check("Nach 'Interne Vermerke ausblenden': normaler Text bleibt erhalten", doc.getElementById("final-preview-output").textContent.includes("Der Dealer ändert den Vertrag online.") &&
    doc.getElementById("final-preview-output").textContent.includes("Eine schriftliche Bestätigung ist nicht nötig."));

  // Fuer den Master-Bau: Konflikt wieder auf Fassung B stellen (einfacher, unkommentierter Text)
  setFinalConflictSource(KAP1, "handbuch_b.docx");
  await wait(50);
  hideInternalCb.checked = false;
  fire(hideInternalCb, "change");
  await wait(50);

  // ===================== Screens-Datei hochladen (Rolle/Sparte/Sprache/Markt) =====================
  doc.getElementById("final-screens-rolle-select").value = "Retail";
  fire(doc.getElementById("final-screens-rolle-select"), "change");
  doc.getElementById("final-screens-sparte-select").value = "Pkw";
  fire(doc.getElementById("final-screens-sparte-select"), "change");
  doc.getElementById("final-screens-sprache-input").value = "DE";
  fire(doc.getElementById("final-screens-sprache-input"), "input");
  doc.getElementById("final-screens-markt-input").value = "Deutschland";
  fire(doc.getElementById("final-screens-markt-input"), "input");

  const screensBuf = await buildScreensDocx();
  const screensFile = new win.File([screensBuf], "screens_retail_pkw_de.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const screensInput = doc.getElementById("final-screens-file-input");
  Object.defineProperty(screensInput, "files", { value: [screensFile], configurable: true });
  fire(screensInput, "change");
  await waitUntil(() => doc.getElementById("final-screens-count").textContent === "1", 2000);
  check("Screens-Datei-Tabelle nennt Rolle/Sparte/Sprache/Markt", doc.getElementById("final-screens-files-tbody").textContent.includes("Retail") &&
    doc.getElementById("final-screens-files-tbody").textContent.includes("Pkw") && doc.getElementById("final-screens-files-tbody").textContent.includes("DE") &&
    doc.getElementById("final-screens-files-tbody").textContent.includes("Deutschland"));
  check("Screens-Zuordnungstabelle zeigt 1 Screen mit Metadaten", doc.getElementById("final-screens-tbody").textContent.includes("Retail / Pkw / DE / Deutschland"));

  // Screen dem Kapitel 1 zuordnen
  const screenChapterSelect = doc.querySelector("[data-final-screen-chapter]");
  screenChapterSelect.value = KAP1;
  fire(screenChapterSelect, "change");
  await wait(50);

  // ===================== Master zusammenführen (Filter passend zur Rolle) =====================
  doc.getElementById("final-filter-rolle-select").value = "Retail";
  fire(doc.getElementById("final-filter-rolle-select"), "change");
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => doc.getElementById("final-build-master-status-note").textContent.includes("zusammengeführt"), 3000);
  check("Master-Statuszeile nennt 3 Kapitel", doc.getElementById("final-build-master-status-note").textContent.includes("3 Kapitel"));
  check("Master-Statuszeile nennt 1 Screen", doc.getElementById("final-build-master-status-note").textContent.includes("1 Screen"));
  check("Export-Buttons nach Zusammenführung sichtbar", doc.getElementById("final-master-export-section").hidden === false);

  // ===================== Export: echte Medien-Pruefung =====================
  let savedBefore = savedFiles.length;
  fire(doc.getElementById("final-master-download-docx-btn"), "click");
  await wait(150);
  check("Word-Export ausgelöst", savedFiles.length === savedBefore + 1);
  const masterDocx = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer()));
  check("Master-DOCX enthält eingebettetes Bild", !!masterDocx.file("word/media/bild1.png"));
  const masterDocxXml = await masterDocx.file("word/document.xml").async("text");
  check("Master-DOCX enthält Kapitel 1 (Fassung B) und Kapitel 3", masterDocxXml.includes(KAP1) && masterDocxXml.includes(FASSUNG_B_SATZ) && masterDocxXml.includes(KAP3));

  savedBefore = savedFiles.length;
  fire(doc.getElementById("final-master-download-pdf-btn"), "click");
  await wait(150);
  const pdfBuf = await blobToBuffer(savedFiles[savedFiles.length - 1].data);
  check("Master-PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");
  const pdfParsed = await new PDFParse({ data: pdfBuf }).getText();
  check("Master-PDF enthält Kapitel 1 (Fassung B)", pdfParsed.text.includes(FASSUNG_B_SATZ));

  // ===================== Ergebnis: Quellversion vs. neue Zusammenführung =====================
  check("Ergebnis-Abschnitt sichtbar", doc.getElementById("final-result-section").hidden === false);
  const resultSelect = doc.getElementById("final-result-chapter-select");
  resultSelect.value = KAP1;
  fire(resultSelect, "change");
  await wait(50);
  check("Ergebnis Quellversion zeigt Fassung B (vollständig, unbereinigt)", doc.getElementById("final-result-source-output").textContent.includes(FASSUNG_B_SATZ));
  check("Ergebnis Master-Vorschau zeigt lesbaren Bild-Hinweis statt [Bild]", doc.getElementById("final-result-master-output").textContent.includes("[Bild:"));

  // ===================== Reset bei "Alle Daten löschen" =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Benutzerhandbuch-Tabelle wieder leer", doc.getElementById("final-manuals-empty").hidden === false);
  check("Nach 'Alle Daten löschen': Screens-Tabelle wieder leer", doc.getElementById("final-screens-empty").hidden === false);
  check("Nach 'Alle Daten löschen': Ergebnis-Abschnitt wieder versteckt", doc.getElementById("final-result-section").hidden === true);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE FINAL-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
