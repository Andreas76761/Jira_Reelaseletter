// v2.146.0 Optik der Word-/PDF-Ausgaben (geprueft mit LibreOffice-Rendering): Inhaltsverzeichnis ohne doppelte
// Nummer und mit eingerueckten Unterkapiteln, Seitenumbruch nur vor Hauptkapiteln, Bildunterschrift nicht doppelt
// ("Abbildung 1: Abbildung 1: …" und Original-Unterschrift darunter), Berichte mit Formatvorlagen und farbigen Status.
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const H = (t, l) => '<w:p><w:pPr><w:pStyle w:val="Heading' + (l || 1) + '"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const IMG = (rid) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rid + '"/></w:drawing></w:r></w:p>';
async function draft() {
  const z = new JSZipNode();
  const body = H("1 Vertragsübersicht") + P("Die Übersicht ist verfügbar.") + IMG("rId1") + P("Abbildung 1: Vertragsübersicht mit Filtern") +
    P("Weitere Schritte folgen.") + H("1.1 Details zur Übersicht", 2) + P("Details für die Zentrale.") +
    H("2 Kartenzahlung") + P("Die Kartenzahlung ist geplant.") + IMG("rId2");
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/></Relationships>');
  z.file("word/media/image1.png", PNG);
  z.file("word/media/image2.png", Buffer.concat([PNG, Buffer.from([7])]));
  return z.generateAsync({ type: "nodebuffer" });
}
async function docText(data) {
  const z = await JSZipNode.loadAsync(Buffer.from(await data.arrayBuffer()));
  const xml = await z.file("word/document.xml").async("string");
  return { xml, styles: z.file("word/styles.xml") ? await z.file("word/styles.xml").async("string") : "", rels: z.file("word/_rels/document.xml.rels") ? await z.file("word/_rels/document.xml.rels").async("string") : "",
    text: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("\n") };
}
const paras = (xml) => xml.split("</w:p>");
const ptext = (p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const rows = () => Array.from(doc.querySelectorAll("#vrev-docs-tbody tr"));
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();

  nav("variante"); await wait(30);
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Optik.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => rows().length === 1, 8000);
  gotoStage(7); await wait(20);
  savedFiles.length = 0;
  $("vrev-stage").querySelector('[data-vrev-act="word-dist"]').click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const w = await docText(savedFiles[0].data);
  const ps = paras(w.xml), texts = ps.map(ptext);
  const tocEnd = texts.indexOf("1 Vertragsübersicht", texts.indexOf("Inhaltsverzeichnis") + 1);
  const toc = texts.slice(texts.indexOf("Inhaltsverzeichnis") + 1, texts.indexOf("2 Kartenzahlung") + 1);
  check("Inhaltsverzeichnis ohne doppelte Nummer („1 Vertragsübersicht“, nicht „1. 1 …“)", toc[0] === "1 Vertragsübersicht" && toc.includes("1.1 Details zur Übersicht") && !texts.some((t) => /^\d+\. \d/.test(t)));
  const tocSub = ps.find((p) => ptext(p) === "1.1 Details zur Übersicht");
  check("Unterkapitel im Inhaltsverzeichnis eingerückt", tocSub && tocSub.includes('<w:ind w:left="400"/>'));
  const iH1 = ps.findIndex((p) => p.includes('w:val="Heading1"') && ptext(p) === "1 Vertragsübersicht");
  const iH11 = ps.findIndex((p) => p.includes('w:val="Heading2"') && ptext(p) === "1.1 Details zur Übersicht");
  const iH2 = ps.findIndex((p) => p.includes('w:val="Heading1"') && ptext(p) === "2 Kartenzahlung");
  const br = (a, b) => ps.slice(a, b).some((p) => p.includes('<w:br w:type="page"/>'));
  check("Kein Seitenumbruch vor dem Unterkapitel 1.1", iH1 > 0 && iH11 > iH1 && !br(iH1, iH11));
  check("Seitenumbruch vor dem Hauptkapitel 2", iH2 > iH11 && br(iH11, iH2));
  const caps = texts.filter((t) => /Vertragsübersicht mit Filtern/.test(t));
  check("Bildunterschrift genau einmal und ohne „Abbildung 1: Abbildung 1:“", caps.length === 1 && caps[0] === "Abbildung 1: Vertragsübersicht mit Filtern" && !w.text.includes("Abbildung 1: Abbildung"));
  check("Text nach dem Bild bleibt erhalten", texts.includes("Weitere Schritte folgen."));

  // PDF: Unterkapitel ohne eigene Seite
  savedFiles.length = 0;
  $("vrev-stage").querySelector('[data-vrev-act="pdf-dist"]').click();
  await waitUntil(() => savedFiles.length === 1, 15000);
  const pdf = Buffer.from(await savedFiles[0].data.arrayBuffer()).toString("latin1");
  const pages = (pdf.match(/\/Type \/Page[^s]/g) || []).length;
  check("PDF: Deckblatt, Inhaltsverzeichnis, Kapitel 1 mit 1.1, Kapitel 2 = 4 Seiten", pages === 4);
  check("PDF: zweites Bild trägt „Abbildung 2“ (vorher je Kapitel wieder 1)", pdf.includes("Abbildung 2:") && (pdf.match(/Abbildung 1:/g) || []).length === 1);

  // Reviewbericht (Markdown -> Word) mit Formatvorlagen und farbigen Status
  savedFiles.length = 0;
  $("vrev-report-docx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const r = await docText(savedFiles[0].data);
  check("Bericht: Formatvorlagen enthalten und verknüpft", r.styles.includes('w:styleId="Heading1"') && r.styles.includes('w:styleId="Title"') && r.rels.includes('Target="styles.xml"'));
  check("Bericht: Status [OK] grün, [Fehler] rot bzw. [offen] grau hervorgehoben", /<w:color w:val="15803D"\/><\/w:rPr><w:t xml:space="preserve">\[OK\] /.test(r.xml) && (/w:val="B91C1C"\/><\/w:rPr><w:t xml:space="preserve">\[(Fehler)\] /.test(r.xml) || /w:val="6B7280"\/><\/w:rPr><w:t xml:space="preserve">\[offen\] /.test(r.xml)));
  check("Bericht: Überschriften als Formatvorlage", /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Dashboard/.test(r.xml));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
