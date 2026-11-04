// v2.138.0 VARIANTE Dokument-Review: eingebettete Bilder eines Entwurfs ins Bildarchiv uebernehmen und als belegte
// Platzhalter einfuegen (bleiben in der Word-Ausgabe erhalten), Kapitel "Statusangaben" (Legende) im Word,
// Ablage als Excel (alle Pruefergebnisse, Befunde, Verlauf).
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
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const IMG = (rid) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rid + '"/></w:drawing></w:r></w:p>';
async function draft() {
  const z = new JSZipNode();
  const body = H("1 Vertragsübersicht") + P("Die Übersicht ist verfügbar.") + IMG("rId1") + P("Abbildung 1: Vertragsübersicht mit Filtern") +
    P("[Bild: Detailansicht]") + P("Weitere Schritte folgen.") +
    H("2 Kartenzahlung") + P("Die Kartenzahlung ist geplant.") + IMG("rId2") + IMG("rId1");
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
  return { text: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("\n"), media: Object.keys(z.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/")).length };
}
async function sheetRows(zip, n) {
  const xml = await zip.file("xl/worksheets/sheet" + n + ".xml").async("string");
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((m) => [...m[1].matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map((x) => x[1]));
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const rows = () => Array.from(doc.querySelectorAll("#vrev-docs-tbody tr"));
  const act = (a) => { const b = $("vrev-step").querySelector('[data-vrev-act="' + a + '"]'); if (b) b.click(); return !!b; };
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();

  nav("variante"); await wait(30);
  check("Ablage-Excel ohne Dokumente gesperrt", $("vrev-xlsx-btn").disabled);
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Mit_Bildern.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => rows().length === 1, 8000);
  check("Hinweis: 3 eingebettete Bilder übernommen", $("vrev-import-note").textContent.includes("3 eingebettete(s) Bild(er) ins Bildarchiv übernommen"));

  gotoStage(3); await wait(20);
  const ph = Array.from(doc.querySelectorAll(".vrev-ph-table tbody tr"));
  const thumbs = (r) => Array.from(r.querySelectorAll(".screenph-thumb")).length;
  check("4 Platzhalter: 3 aus Bildern (belegt) + 1 Text-Platzhalter (leer)", ph.length === 4 && ph.filter((r) => thumbs(r) === 1).length === 3 && thumbs(ph[1]) === 0 && ph[1].textContent.includes("[Bild: Detailansicht]"));
  check("Bildunterschrift aus der folgenden Zeile „Abbildung 1: …“ übernommen", ph[0].children[1].textContent.includes("[Bild: Abbildung 1: Vertragsübersicht mit Filtern]"));
  check("Ohne eigenen Text: Kapitelüberschrift als Bildtext", ph[2].children[1].textContent.includes("[Bild: 2 Kartenzahlung]"));
  check("B1: 3 von 4 belegt (Hinweis)", doc.querySelector('[data-vrev-check="B1"]').textContent.includes("3 von 4 Platzhalter(n)"));
  nav("editor"); await wait(30);
  check("Bilder im Bildarchiv (Screens-Import) mit Quelldatei", Array.from(doc.querySelectorAll("#editor-screens-tbody tr")).filter((r) => r.textContent.includes("Mit_Bildern.docx")).length === 3);
  nav("variante"); await wait(30);

  // Word mit Bildern + Legende
  gotoStage(7); await wait(20);
  savedFiles.length = 0;
  $("vrev-stage").querySelector('[data-vrev-act="word-dist"]').click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  let w = await docText(savedFiles[0].data);
  check("Word Verteilung: alle 3 eingebetteten Bilder bleiben erhalten, kein Platzhaltertext", w.media === 3 && !w.text.includes("#vrevimg") && !w.text.includes("[Bild"));
  check("Ohne Legende: kein Kapitel „Statusangaben“", !w.text.includes("Statusangaben"));
  const leg = $("vrev-stage").querySelector('[data-vrev-act="legend"]');
  leg.checked = true; fire(leg, "change"); await wait(20);
  savedFiles.length = 0;
  $("vrev-stage").querySelector('[data-vrev-act="word-dist"]').click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  w = await docText(savedFiles[0].data);
  check("Mit Legende: Kapitel „Statusangaben“ mit den im Text vorkommenden Status", w.text.includes("Statusangaben") && w.text.includes("verfügbar: Die Funktion ist bereits im Einsatz.") &&
    w.text.includes("geplant: Die Funktion ist vorgesehen, aber noch nicht umgesetzt.") && !w.text.includes("in Abnahme:"));
  check("Legende im Inhaltsverzeichnis vor Kapitel 1", w.text.indexOf("Statusangaben") < w.text.indexOf("1 Vertragsübersicht"));

  // Ablage als Excel
  rows()[0].querySelector('[data-vrev-act="new-version"]').click(); await wait(30);
  savedFiles.length = 0;
  $("vrev-xlsx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  check("Ablage als Excel heruntergeladen", /^Review_Ablage_\d{4}-\d{2}-\d{2}\.xlsx$/.test(savedFiles[0].filename));
  const zip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const wb = await zip.file("xl/workbook.xml").async("string");
  check("Blätter Ablage, Befunde, Verlauf", /name="Ablage".*name="Befunde".*name="Verlauf"/.test(wb));
  const s1 = await sheetRows(zip, 1), s2 = await sheetRows(zip, 2), s3 = await sheetRows(zip, 3);
  check("Ablage: 2 Dokumente (v1.0, v1.1) mit 14 Kennzahlen + 20 Prüfungen", s1.length === 3 && s1[0].length === 34 && s1[1][1] === "1.0" && s1[2][1] === "1.1" && s1[0][14] === "D1 Schriftarten einheitlich" && s1[0][33] === "F1 Bereit für die Verteilung");
  check("Befunde: 20 je Dokument mit Stufe", s2.length === 41 && s2[1][2] === "Stufe 1 – Design" && s2.some((r) => r[3] === "B1 Bild-Platzhalter belegt" && r[5].includes("3 von 4")));
  check("Verlauf: Bildübernahme und Legende protokolliert", s3.some((r) => r[4].includes("3 eingebettete(s) Bild(er)")) && s3.some((r) => r[4] === "Status-Legende eingefügt"));

  // Sitzung
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sess = JSON.parse(savedFiles[0].data);
  check("Sitzung: Legende-Option und Bild-Zuordnung gespeichert", sess.vrev.docs[0].legend === true && Object.keys(sess.vrev.docs[0].ph).length === 3 && sess.uploadedImages.filter((i) => i.sourceFile === "Mit_Bildern.docx").length === 3);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
