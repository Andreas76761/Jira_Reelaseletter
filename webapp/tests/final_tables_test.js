// v2.150.0 FINAL: Tabellen aus dem Handbuch erscheinen im Word/PDF wieder als echte Tabelle (vorher tab-getrennte
// Textzeilen "Feld Bedeutung / LaufzeitMonate"), Kopfzeile fett, Reihenfolge im Kapitel bleibt erhalten.
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const TBL = (rows) => "<w:tbl>" + rows.map((r) => "<w:tr>" + r.map((c) => "<w:tc><w:p><w:r><w:t>" + esc(c) + "</w:t></w:r></w:p></w:tc>").join("") + "</w:tr>").join("") + "</w:tbl>";
async function docx(body) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  return z.generateAsync({ type: "nodebuffer" });
}
const BODY = H("1 Verträge anlegen") + P("1. Daten erfassen") + P("2. Speichern") + P("• Hinweis zur Laufzeit") + P("Die wichtigsten Felder:") + TBL([["Feld", "Bedeutung"], ["Laufzeit", "Monate"], ["Laufleistung", "km pro Jahr"]]) + P("Danach speichern.") +
  H("2 Preise") + TBL([["Paket", "Preis", "Hinweis"], ["Basis", "10 €", ""]]) + P("Ende.");

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  nav("final"); await wait(20);
  Object.defineProperty($("final-manual-file-input"), "files", { value: [new win.File([await docx(BODY)], "tabellen.docx")], configurable: true });
  fire($("final-manual-file-input"), "change");
  await waitUntil(() => $("final-manuals-tbody").children.length === 1, 5000);
  $("final-build-name-input").value = "Tabellen"; fire($("final-build-name-input"), "input");
  fire($("final-build-master-btn"), "click");
  await waitUntil(() => $("final-build-master-status-note").textContent.includes("„Tabellen“"), 10000);
  savedFiles.length = 0;
  $("final-master-download-docx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const z = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const xml = await z.file("word/document.xml").async("string");
  const tbls = xml.split("<w:tbl>").slice(1).map((t) => t.split("</w:tbl>")[0]);
  const cells = (t) => t.split("</w:tr>").filter((r) => r.includes("<w:tc>")).map((r) => [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]));
  check("2 echte Tabellen im Word", tbls.length === 2);
  check("Tabelle 1: 3 Zeilen × 2 Spalten mit Inhalt", JSON.stringify(cells(tbls[0])) === JSON.stringify([["Feld", "Bedeutung"], ["Laufzeit", "Monate"], ["Laufleistung", "km pro Jahr"]]));
  check("Kopfzeile fett, übrige Zeilen normal", /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Feld</.test(tbls[0]) && !/<w:b\/><\/w:rPr><w:t xml:space="preserve">Laufzeit</.test(tbls[0]));
  check("Tabelle 2: leere Zelle bleibt erhalten (3 Spalten)", cells(tbls[1])[1].length === 3 && cells(tbls[1])[1][1] === "10 €");
  const before = xml.indexOf("Die wichtigsten Felder:"), t1 = xml.indexOf("<w:tbl>"), after = xml.indexOf("Danach speichern.");
  check("Reihenfolge: Text – Tabelle – Text", before > 0 && before < t1 && t1 < after);
  check("Keine Tabulator-Textzeilen mehr", !/Laufzeit\tMonate|<w:t[^>]*>[^<]*\t/.test(xml));

  savedFiles.length = 0;
  $("final-master-download-pdf-btn").click();
  await waitUntil(() => savedFiles.length === 1, 10000);
  const pdf = Buffer.from(await savedFiles[0].data.arrayBuffer()).toString("latin1");
  check("PDF: Zellen einzeln gesetzt (Tabelle statt Tabulatorzeile)", pdf.includes("(Laufzeit)") && pdf.includes("(Monate)") && !pdf.includes("Laufzeit\tMonate") && !pdf.includes("Laufzeit\\tMonate"));

  // PowerPoint
  savedFiles.length = 0;
  $("final-design-pptx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 10000);
  const pz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const slides = await Promise.all(Object.keys(pz.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => pz.file(f).async("string")));
  const tblSlides = slides.filter((x) => x.includes("<a:tbl>"));
  check("PowerPoint: Tabellen als echte Tabelle auf eigener Folie (Kopfzeile fett)", tblSlides.length === 2 && /b="1" dirty="0"\/><a:t>Feld<\/a:t>/.test(tblSlides[0]) && tblSlides[0].includes("<a:t>Laufleistung</a:t>") && !slides.some((x) => /Laufzeit\tMonate/.test(x)));
  const all = slides.join("");
  check("PowerPoint: „1. Daten erfassen“ ohne zusätzlichen Aufzählungspunkt", /<a:pPr marL="571500" indent="-228600"><a:buNone\/><\/a:pPr><a:r><a:rPr lang="de-DE" dirty="0"\/><a:t>1\. Daten erfassen<\/a:t>/.test(all));
  check("PowerPoint: „• Hinweis“ nutzt den Folien-Aufzählungspunkt (kein „•“ im Text)", all.includes("<a:t>Hinweis zur Laufzeit</a:t>") && !all.includes("<a:t>• Hinweis"));
  check("PowerPoint: Text vor und nach der Tabelle bleibt erhalten", all.includes("<a:t>Die wichtigsten Felder:</a:t>") && all.includes("<a:t>Danach speichern.</a:t>"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
