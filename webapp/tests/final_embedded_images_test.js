// v2.149.0 FINAL-Import: eingebettete Bilder des Handbuchs bleiben an ihrer Stelle (Bildarchiv, "[Bild: Bildtext]" im
// Kapiteltext, im Word/PDF an derselben Position mit genau einer Bildunterschrift); "[Bild]" aus dem Text weiterhin offen.
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
const PNG1 = Buffer.concat([PNG, Buffer.from([1])]), PNG2 = Buffer.concat([PNG, Buffer.from([2])]);
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const IMG = (rid) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rid + '"/></w:drawing></w:r></w:p>';
async function docx(body, withImages) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  if (withImages) {
    z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/></Relationships>');
    z.file("word/media/image1.png", PNG1); z.file("word/media/image2.png", PNG2);
  }
  return z.generateAsync({ type: "nodebuffer" });
}
const BODY = H("1 Verträge anlegen") + P("Öffnen Sie die Vertragsmaske.") + IMG("rId1") + P("Abbildung 1: Vertragsmaske") + P("Füllen Sie die Felder aus.") +
  P("[Bild]") + P("Danach speichern.") + IMG("rId2") + H("2 Kündigung") + P("Kündigungen werden erfasst.");

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  async function upload(buf, name) {
    nav("final"); await wait(20);
    const n = $("final-manuals-tbody").children.length;
    setFiles($("final-manual-file-input"), [new win.File([buf], name)]);
    await waitUntil(() => $("final-manuals-tbody").children.length === n + 1, 5000);
  }
  async function buildAndWord(name) {
    $("final-build-name-input").value = name; fire($("final-build-name-input"), "input");
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
    savedFiles.length = 0;
    $("final-master-download-docx-btn").click();
    await waitUntil(() => savedFiles.length === 1, 8000);
    const z = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
    const xml = await z.file("word/document.xml").async("string");
    const media = Object.keys(z.files).filter((f) => /^word\/media\/bild\d+/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const bytes = await Promise.all(media.map((f) => z.file(f).async("nodebuffer")));
    const paras = xml.split("</w:p>").map((p) => (p.includes("<w:drawing>") ? "#BILD#" : "") + [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")).filter(Boolean);
    return { xml, bytes, paras };
  }

  await upload(await docx(BODY, true), "handbuch_mit_bildern.docx");
  const imgs = () => JSON.parse(JSON.stringify(Array.from(doc.querySelectorAll("#bilder-tbody tr, .bilder-card")).length));
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  let sess = JSON.parse(savedFiles[0].data);
  const arch = sess.uploadedImages.filter((i) => i.sourceFile === "handbuch_mit_bildern.docx");
  check("2 eingebettete Bilder ins Bildarchiv (Quelldatei, Bildtext aus „Abbildung 1: …“ bzw. Kapitel)", arch.length === 2 && arch[0].description === "Abbildung 1: Vertragsmaske" && arch[1].description === "1 Verträge anlegen" && arch[0].finalManualId === sess.final.manuals[0].id);
  const ch = sess.final.manuals[0].chapters.find((c) => c.title === "1 Verträge anlegen");
  check("Kapiteltext mit „[Bild: Bildtext]“ an der Bildstelle, Verweis je Bild", ch.fullText.split("\n")[1] === "[Bild: Abbildung 1: Vertragsmaske]" && ch.embedded.length === 2 && ch.embedded[0].id === arch[0].id && !ch.fullText.includes("#finimg"));
  check("Hinweis/Protokoll nennt übernommene Bilder", sess.log.some((l) => /2 eingebettete\(s\) Bild\(er\) an ihrer Stelle übernommen/.test(l.text || l.message || JSON.stringify(l))));

  const w = await buildAndWord("MitBildern");
  check("Word: beide Bilder in Originalreihenfolge (Bild 1, Bild 2)", w.bytes.length === 2 && w.bytes[0].equals(PNG1) && w.bytes[1].equals(PNG2));
  const i1 = w.paras.indexOf("#BILD#"), i2 = w.paras.lastIndexOf("#BILD#");
  check("Bild 1 direkt nach „Öffnen Sie die Vertragsmaske.“, Bildunterschrift genau einmal", w.paras[i1 - 1] === "Öffnen Sie die Vertragsmaske." && w.paras[i1 + 1] === "Abbildung 1: Vertragsmaske" && w.paras[i1 + 2] === "Füllen Sie die Felder aus." && w.paras.filter((p) => p.includes("Vertragsmaske") && p.startsWith("Abbildung")).length === 1);
  check("Bild 2 nach „Danach speichern.“", w.paras[i2 - 1] === "Danach speichern." && w.paras[i2 + 1] === "Abbildung 2: 1 Verträge anlegen");
  check("„[Bild]“ ohne Screen vor einem eingebetteten Bild bleibt als offener Hinweis (Bilder verrutschen nicht)", w.paras.includes("[Bild: kein Screen zugeordnet]"));
  check("Kein Platzhaltertext im Word", !w.xml.includes("[Bild: Abbildung") && !w.xml.includes("#finimg"));

  // PDF
  savedFiles.length = 0;
  $("final-master-download-pdf-btn").click();
  await waitUntil(() => savedFiles.length === 1, 10000);
  const pdf = Buffer.from(await savedFiles[0].data.arrayBuffer()).toString("latin1");
  const pdfImgs = (pdf.match(/\/Subtype \/Image/g) || []).length - (pdf.match(/\/SMask \d+ 0 R/g) || []).length;
  check("PDF mit beiden Bildern (ohne Transparenzmasken gezählt)", pdfImgs === 2);

  // Sitzung speichern/laden: Stand behaelt die Bilder
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  sess = JSON.parse(savedFiles[0].data);
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(sess)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("final"); await wait(20);
  savedFiles.length = 0;
  $("final-master-download-docx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const z2 = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  check("Nach Sitzung laden: Stand weiterhin mit beiden Bildern", Object.keys(z2.files).filter((f) => /^word\/media\/bild/.test(f)).length === 2);

  // Handbuch ohne Bilder: unveraendert
  await upload(await docx(H("1 Ohne Bilder") + P("Nur Text.") + P("[Bild]"), false), "ohne.docx");
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  sess = JSON.parse(savedFiles[0].data);
  const m2 = sess.final.manuals.find((m) => m.filename === "ohne.docx");
  check("Handbuch ohne Bilder: Text unverändert, „[Bild]“ bleibt Platzhalter", m2.chapters[0].fullText === "Nur Text.\n[Bild]" && !m2.chapters[0].embedded);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
