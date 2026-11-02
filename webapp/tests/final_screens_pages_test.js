// v2.114.0 FINAL Screens: Reihenfolge nach Seitennummerierung der
// Originalquelle, Seitenanzahl je Datei (Screens-Datei und Handbuch inkl.
// Vorschau), Ueberschriften der Quellseite in der Uebersicht (inkl. Bezug auf
// die Vorseite, wenn die Seite keine eigene Ueberschrift hat) und
// Seiten-Kontext im KI-Prompt fuer "Bilder zuordnen".
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
    const sample = function (input, opts) { sampleCalls.push({ input, opts }); return Promise.resolve({ text: "", truncated: false }); };
    sample.json = function (input, opts) { sampleCalls.push({ input, opts }); return Promise.resolve([]); };
    sample.limits = function () { return Promise.resolve({ maxPromptBytes: 262144 }); };
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

const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
// Lokalisierte Style-IDs: deutsch "berschrift1", franzoesisch "Titre2".
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style></w:styles>';
const RPB = "<w:r><w:lastRenderedPageBreak/></w:r>";
function heading(text, styleId, prefix) { return '<w:p><w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' + (prefix || "") + "<w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function para(text, prefix) { return "<w:p>" + (prefix || "") + "<w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function img(rId, prefix) { return "<w:p>" + (prefix || "") + '<w:r><w:drawing><a:blip r:embed="' + rId + '"/></w:drawing></w:r></w:p>'; }
async function buildDocx(bodyXml, opts) {
  opts = opts || {};
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "<w:sectPr/></w:body></w:document>");
  zip.file("word/styles.xml", STYLES);
  if (opts.pages) zip.file("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>' + opts.pages + "</Pages></Properties>");
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= (opts.images || 0); i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG);
  }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  async function upload(inputId, buf, name) {
    const input = doc.getElementById(inputId);
    Object.defineProperty(input, "files", { value: [new win.File([buf], name, { type: "application/octet-stream" })], configurable: true });
    fire(input, "change");
  }
  const rows = () => Array.from(doc.querySelectorAll("#final-screens-tbody tr"));
  const navOf = (r) => r.querySelector(".final-col-nav").textContent;
  const pageOf = (r) => r.querySelector(".final-col-page").textContent;
  const headsOf = (r) => r.querySelector(".final-col-headings").textContent;

  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);

  // ===================== Handbuch: Seitenanzahl in Tabelle und Vorschau =====================
  const manual = await buildDocx(heading("Kapitel A", "berschrift1") + para("Text A.") + heading("Kapitel B", "berschrift1", RPB) + para("Text B."), { pages: 7 });
  await upload("final-manual-file-input", manual, "handbuch.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  const manualPagesCell = doc.querySelector("#final-manuals-tbody .final-col-pages");
  check("Handbuch: Spalte 'Seiten' zeigt 7 (aus docProps/app.xml)", !!manualPagesCell && manualPagesCell.textContent === "7");
  check("Handbuch-Tabelle hat Spaltenkopf 'Seiten'", Array.from(doc.querySelectorAll("#final-manuals-table th")).some((th) => th.textContent === "Seiten"));
  const previewSel = doc.getElementById("final-preview-chapter-select");
  previewSel.value = "Kapitel A";
  fire(previewSel, "change");
  await wait(50);
  const srcNote = doc.getElementById("final-preview-source-note").textContent;
  check("Vorschau zeigt Quelle und Seitenanzahl ('handbuch.docx · 7 Seiten')", srcNote.includes("handbuch.docx") && srcNote.includes("7 Seiten"));

  // ===================== Screens-Datei 1: gerenderte Seitenumbrueche (Word) =====================
  // S.1: Kapitel A + Bild 1 | S.2: (keine Ueberschrift) Bild 2 | S.3: Unterkapitel A.1 + Kapitel B + Bild 3 (Tabelle) | S.4: Bild 4
  const body1 =
    heading("Kapitel A", "berschrift1") + img("rId1") + para("A > Eins") +
    para("Fortsetzung", RPB) + img("rId2") + para("A > Zwei") +
    heading("Unterkapitel A.1", "Titre2", RPB) + heading("Kapitel B", "berschrift1") +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:drawing><a:blip r:embed="rId3"/></w:drawing></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B &gt; Drei</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    img("rId4", RPB) + para("B > Vier");
  await upload("final-screens-file-input", await buildDocx(body1, { pages: 5, images: 4 }), "screens_word.docx");
  await waitUntil(() => rows().length === 4, 5000);
  check("4 Screens aus Datei 1 extrahiert", rows().length === 4);
  check("Reihenfolge entspricht der Seitenfolge der Quelle (Eins, Zwei, Drei, Vier)",
    rows().map(navOf).join("|") === "A > Eins|A > Zwei|B > Drei|B > Vier");
  check("Seiten-Spalte: S. 1/2/3/4 von 5", rows().map(pageOf).join("|") === "S. 1 von 5|S. 2 von 5|S. 3 von 5|S. 4 von 5");
  const filesPages = doc.querySelector("#final-screens-files-tbody .final-col-pages");
  check("Screens-Datei-Tabelle: Seitenanzahl 5", !!filesPages && filesPages.textContent === "5");
  check("S. 1: Überschrift 'Kapitel A'", headsOf(rows()[0]).includes("Kapitel A") && !headsOf(rows()[0]).includes("Vorseite"));
  check("S. 2 ohne eigene Überschrift: 'Vorseite' + 'Kapitel A'", headsOf(rows()[1]).includes("Vorseite") && headsOf(rows()[1]).includes("Kapitel A"));
  check("S. 3: beide Überschriften der Seite (lokalisierte Style-IDs 'Titre2'/'berschrift1')",
    headsOf(rows()[2]).includes("Unterkapitel A.1") && headsOf(rows()[2]).includes("Kapitel B"));
  check("S. 4 ohne eigene Überschrift: Bezug auf letzte Überschrift 'Kapitel B'", headsOf(rows()[3]).includes("Vorseite") && headsOf(rows()[3]).includes("Kapitel B"));
  check("Übersicht hat Spaltenköpfe 'Seite (Quelle)' und 'Überschriften der Seite (Quelle)'",
    ["Seite (Quelle)", "Überschriften der Seite (Quelle)"].every((t) => Array.from(doc.querySelectorAll("#final-screens-table th")).some((th) => th.textContent === t)));

  // ===================== Screens-Datei 2: ohne gerenderte Umbrueche, ohne app.xml =====================
  // Manueller Seitenumbruch, "Seitenumbruch oberhalb", Abschnittswechsel (naechste Seite).
  const body2 =
    heading("Kapitel C", "berschrift1") + img("rId1") + para("C > Eins") +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + img("rId2") + para("C > Zwei") +
    '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Neue Seite</w:t></w:r></w:p>' + img("rId3") + para("C > Drei") +
    '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>' + img("rId4") + para("C > Vier");
  await upload("final-screens-file-input", await buildDocx(body2, { images: 4 }), "screens_ohne_app.docx");
  await waitUntil(() => rows().length === 8, 5000);
  const second = rows().slice(4);
  check("Datei 2 folgt in Upload-Reihenfolge nach Datei 1", rows().slice(0, 4).every((r) => navOf(r).startsWith("A") || navOf(r).startsWith("B")) && second.every((r) => navOf(r).startsWith("C")));
  check("Datei 2: Seiten aus manuellem Umbruch/Umbruch oberhalb/Abschnittswechsel (1–4 von 4)",
    second.map(pageOf).join("|") === "S. 1 von 4|S. 2 von 4|S. 3 von 4|S. 4 von 4");
  const filesPageCells = Array.from(doc.querySelectorAll("#final-screens-files-tbody .final-col-pages")).map((c) => c.textContent);
  check("Screens-Datei-Tabelle: gezählte Seitenanzahl 4 (ohne docProps/app.xml)", filesPageCells.join("|") === "5|4");

  // ===================== KI-Prompt enthaelt Seiten-Kontext =====================
  sampleCalls.length = 0;
  fire(doc.getElementById("final-assign-images-btn"), "click");
  await waitUntil(() => sampleCalls.length > 0, 5000);
  const prompt = sampleCalls.map((c) => String(c.input)).join("\n");
  check("Prompt nennt die Seite in der Quelle", prompt.includes("Seite in der Quelle: 2"));
  check("Prompt kennzeichnet Bezug auf die Vorseite", prompt.includes("von der Vorseite") && prompt.includes("Überschriften der Vorseite: Kapitel A"));
  check("Prompt-Reihenfolge = Seitenfolge (A > Eins vor A > Zwei vor B > Drei)",
    prompt.indexOf("A > Eins") < prompt.indexOf("A > Zwei") && prompt.indexOf("A > Zwei") < prompt.indexOf("B > Drei"));
  await waitUntil(() => !doc.getElementById("final-assign-images-btn").disabled, 5000);

  // ===================== Sitzung speichern/laden behaelt Seiten =====================
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  const sessScreens = (session.uploadedImages || []).filter((i) => i.finalScreensFileId);
  check("Sitzung enthält Seite und Seitenüberschriften je Screen", sessScreens.length === 8 && sessScreens.every((i) => i.finalPage >= 1 && Array.isArray(i.finalPageHeadings)));
  check("Sitzung enthält Seitenanzahl je Screens-Datei", (session.final.screensFiles || []).map((f) => f.pageCount).join("|") === "5|4");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-SEITEN-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
