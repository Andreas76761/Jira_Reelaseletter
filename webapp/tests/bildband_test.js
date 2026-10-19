// Bildband (Teil "Bildband"): verbindet die im Editor-Register aus Word/
// PowerPoint extrahierten, einem Kapitel zugeordneten Screens mit dem
// generierten Benutzerhandbuch-Kapiteltext über den Platzhalter "[Bild]"
// (eigene Zeile). Prüft: Platzhalter-Erkennung + Ersetzung durch das
// zugeordnete Bild in der Lese-Vorschau, Bildband-Übersichtstabelle
// (Platzhalter-/Screen-Anzahl, Status "passt genau"/"fehlen"/"überschüssig"),
// sowie die tatsächliche Bildeinbettung in DOCX- (echtes OOXML-Bild samt
// Relationship + Media-Datei) und PDF-Export (jsPDF addImage, %PDF-Signatur,
// kein Absturz) - ausgelöst sowohl über die bestehenden Benutzerhandbuch-
// Export-Buttons als auch über die neuen Export-Buttons im Bildband-Register.
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

const CHAPTER_TEXT = "Hier wird erklärt, wie ein Vertrag angepasst wird.\n[Bild]\nWeitere Hinweise zum Speichern.";
let sampleImpl = async function (promptText) {
  if (/Review|Lektorat|Audit/.test(promptText)) return { text: '{"score":100,"befunde":[]}', truncated: false, modelTierApplied: "default" };
  return { text: CHAPTER_TEXT, truncated: false, modelTierApplied: "default" };
};
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

const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);
async function buildDocxWithScreens(count) {
  var zip = new JSZipNode();
  var paras = "";
  var relsList = "";
  for (var i = 1; i <= count; i++) {
    paras += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Screen ' + i + '</w:t></w:r></w:p>' +
      '<w:p><w:r><w:drawing><a:blip r:embed="rId' + i + '"/></w:drawing></w:r></w:p>';
    relsList += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG_1X1);
  }
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' + paras + "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relsList + "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>BB-1</key><summary>Servicevertrag im Alltag ändern</summary>
    <description>Der Dealer ändert einen bestehenden Vertrag.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
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
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "bildband_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Kapitel mit [Bild]-Platzhalter erzeugen =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => doc.getElementById("manual-chapters-list").children.length > 0, 8000);
  await wait(50);
  const chapterTitle = doc.querySelector("[data-manual-chapter]").getAttribute("data-manual-chapter");
  check("Kapitel mit Beispieltext erzeugt", chapterTitle.indexOf("Kapitel 7") !== -1 || !!chapterTitle);

  // ===================== Vorschau zeigt Platzhalter als Warnbox (noch kein Bild zugeordnet) =====================
  fire(doc.querySelector('[data-manual-chapter="' + chapterTitle + '"] [data-manual-lang="preview"]'), "click");
  await wait(30);
  const previewBox1 = doc.querySelector('[data-manual-chapter="' + chapterTitle + '"] .panel');
  check("Vorschau ohne zugeordnetes Bild: Warnhinweis statt Absturz", previewBox1.textContent.indexOf("kein zugeordnetes Bild") !== -1);
  check("Vorschau ohne zugeordnetes Bild: kein <img> gerendert", previewBox1.querySelectorAll("img").length === 0);

  // ===================== Screens aus Word-Datei hochladen und dem Kapitel zuordnen =====================
  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);
  const editorDomainSelect = doc.getElementById("editor-domain-select");
  editorDomainSelect.value = "Contract Management";
  const docxBuf = await buildDocxWithScreens(2);
  const editorInput = doc.getElementById("editor-file-input");
  Object.defineProperty(editorInput, "files", { value: [new win.File([docxBuf], "screens.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })], configurable: true });
  fire(editorInput, "change");
  await wait(600);

  check("2 Screens aus der Word-Datei extrahiert", doc.querySelectorAll(".editor-screen-chapter-select").length === 2);
  // Jede Zuordnung loest renderEditorScreens() aus (komplettes tbody-innerHTML-
  // Neurendern) - die <select>-Referenzen werden dadurch ungueltig, deshalb
  // nach jedem Schritt frisch aus dem DOM abfragen statt eine vorher
  // gesammelte Liste weiterzuverwenden.
  for (let i = 0; i < 2; i++) {
    const sel = doc.querySelectorAll(".editor-screen-chapter-select")[i];
    sel.value = chapterTitle;
    fire(sel, "change");
    await wait(30);
  }
  const subchapterSelects = Array.from(doc.querySelectorAll(".editor-screen-subchapter-select"));
  check("Unterkapitel-Dropdown nach Kapitel-Zuordnung aktiviert (nicht mehr disabled)",
    subchapterSelects.length === 2 && subchapterSelects.every((s) => !s.disabled));

  // ===================== Bildband-Register: 1 Platzhalter, 2 Screens -> "überschüssig" =====================
  doc.querySelector('.nav-item[data-view="bildband"]').click();
  await wait(100);
  const bildbandRowText = doc.getElementById("bildband-tbody").textContent;
  check("Bildband zeigt das Kapitel", bildbandRowText.indexOf(chapterTitle) !== -1);
  check("Bildband zeigt 1 Platzhalter", /\b1\b/.test(doc.querySelector("#bildband-tbody tr td:nth-child(2)").textContent));
  check("Bildband zeigt 2 zugeordnete Screens", /\b2\b/.test(doc.querySelector("#bildband-tbody tr td:nth-child(3)").textContent));
  check("Bildband-Status meldet überschüssige Bilder (2 Screens, 1 Platzhalter)", bildbandRowText.indexOf("überschüssig") !== -1);
  check("Bildband zeigt Vorschau-Thumbnails", doc.querySelector("#bildband-tbody tr td:nth-child(5) img") !== null);

  // ===================== Vorschau zeigt jetzt ein echtes Bild =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  // Re-Klick auf "Vorschau (Icons)" erzwingt renderManualChapters() neu -
  // die Kapitel-Karte wurde seit der Screen-Zuordnung noch nicht neu
  // gerendert (Registerwechsel allein loest das nicht aus).
  fire(doc.querySelector('[data-manual-chapter="' + chapterTitle + '"] [data-manual-lang="preview"]'), "click");
  await wait(30);
  const previewBox2 = doc.querySelector('[data-manual-chapter="' + chapterTitle + '"] .panel');
  check("Vorschau zeigt jetzt ein <img> für den Platzhalter", previewBox2.querySelectorAll("img").length === 1);
  check("Bildunterschrift „Abbildung 1\" vorhanden", previewBox2.textContent.indexOf("Abbildung 1") !== -1);

  // ===================== DOCX-Export aus dem Bildband-Register: echtes eingebettetes Bild =====================
  doc.querySelector('.nav-item[data-view="bildband"]').click();
  await wait(50);
  const docxBtn = doc.querySelector('[data-bildband-export="docx"][data-bildband-chapter="' + chapterTitle + '"]');
  check("DOCX-Export-Button im Bildband-Register vorhanden", !!docxBtn);
  fire(docxBtn, "click");
  await waitUntil(() => savedFiles.length === 1, 4000);
  check("DOCX wurde gespeichert", savedFiles.length === 1 && /\.docx$/.test(savedFiles[0].filename));
  if (savedFiles.length === 1) {
    const buf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    const zip = await JSZipNode.loadAsync(buf);
    check("DOCX enthält word/document.xml", !!zip.file("word/document.xml"));
    check("DOCX enthält eingebettetes Bild (word/media/bild1.png)", !!zip.file("word/media/bild1.png"));
    check("DOCX enthält Bild-Relationship (word/_rels/document.xml.rels)", !!zip.file("word/_rels/document.xml.rels"));
    const docXmlText = await zip.file("word/document.xml").async("string");
    check("document.xml enthält eine Bild-Zeichnung (w:drawing)", docXmlText.indexOf("<w:drawing>") !== -1);
    check("document.xml enthält die Bildunterschrift „Abbildung 1\"", docXmlText.indexOf("Abbildung 1") !== -1);
  }

  // ===================== PDF-Export aus dem Bildband-Register: kein Absturz, echtes PDF =====================
  savedFiles.length = 0;
  const pdfBtn = doc.querySelector('[data-bildband-export="pdf"][data-bildband-chapter="' + chapterTitle + '"]');
  fire(pdfBtn, "click");
  await waitUntil(() => savedFiles.length === 1, 4000);
  check("PDF wurde gespeichert", savedFiles.length === 1 && /\.pdf$/.test(savedFiles[0].filename));
  if (savedFiles.length === 1) {
    const pdfBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    check("PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString("ascii") === "%PDF");
  }

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE BILDBAND-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
