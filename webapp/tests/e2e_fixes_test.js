// v2.142.0 Korrekturen aus dem End-to-End-Test: PDF-Bilder komprimiert (vorher ~3 MB je Screenshot), Uebersetzung im
// Review behaelt Tabellen, KI-Pruefung/Uebersetzung laufen parallel (3), Statusangaben im Word farbig (abschaltbar),
// Meldung bei Bildvorschlaegen, Hinweis ohne Domaenen im Classification Agent.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { createCanvas } = require("canvas");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });
const savedFiles = [];
let active = 0, maxActive = 0;
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  active++; maxActive = Math.max(maxActive, active);
  await new Promise((r) => setTimeout(r, 30));
  active--;
  if (p.includes("ZIELSPRACHE:")) { const t = (p.match(/\nTITEL: (.*)\n/) || [])[1] || ""; return { text: "TITEL: EN " + t + "\n\nEN: " + p.slice(p.indexOf("\nTEXT:\n") + 7) }; }
  return { text: "[]" };
}
sample.json = async () => ({});
sample.limits = async () => ({ images: false });
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : name === "sample" ? sample : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + t + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + "</w:t></w:r></w:p>";
function bigPng(label, color) {
  const cv = createCanvas(1280, 800), g = cv.getContext("2d");
  g.fillStyle = "#f4f6fa"; g.fillRect(0, 0, 1280, 800); g.fillStyle = color; g.fillRect(0, 0, 1280, 70);
  g.fillStyle = "#fff"; g.font = "bold 30px sans-serif"; g.fillText(label, 20, 46);
  g.fillStyle = "#cbd5e1"; for (let i = 0; i < 8; i++) g.fillRect(40, 120 + i * 80, 1200, 50);
  return cv.toBuffer("image/png");
}
async function draft() {
  const z = new JSZipNode();
  let body = "", rels = "";
  for (let i = 1; i <= 8; i++) {
    body += H(i + " Kapitel " + i) + P("Die Funktion " + i + " ist geplant und wird später verfügbar sein.") + P("Text zu Kapitel " + i + " mit genügend Inhalt für die Prüfung.");
    if (i <= 3) { body += '<w:p><w:r><w:drawing><a:blip r:embed="rId' + i + '"/></w:drawing></w:r></w:p>'; rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>'; z.file("word/media/image" + i + ".png", bigPng("Screen " + i, ["#0e7490", "#b45309", "#7c3aed"][i - 1])); }
    if (i === 2) body += '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Wert</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  }
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>");
  return z.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();
  const act = (a) => { const b = $("vrev-stage").querySelector('[data-vrev-act="' + a + '"]'); b.click(); };
  async function save(a) { savedFiles.length = 0; act(a); await waitUntil(() => savedFiles.length === 1, 30000); return savedFiles[0]; }

  nav("variante"); await wait(20);
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Gross.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]").length === 1, 10000);

  // Bildvorschlaege: alles belegt
  gotoStage(3); await wait(10);
  act("ph-suggest"); await wait(10);
  check("Bildvorschläge: Meldung, wenn alle Platzhalter belegt sind", $("vrev-status").textContent === "Alle Platzhalter sind bereits belegt.");

  // PDF-Groesse
  gotoStage(7); await wait(10);
  const pdf = await save("pdf-dist");
  check("PDF mit 3 Screenshots (1280×800) unter 1 MB (vorher ~9 MB unkomprimiert)", pdf.data.size < 1024 * 1024);
  const pdfTxt = Buffer.from(await pdf.data.arrayBuffer()).toString("latin1");
  check("PDF-Bilder mit FlateDecode komprimiert", (pdfTxt.match(/\/Subtype \/Image[\s\S]{0,300}?\/Filter \/FlateDecode/g) || []).length >= 3);

  // Statusangaben farbig im Word
  let w = await save("word-dist");
  let xml = await (await JSZipNode.loadAsync(Buffer.from(await w.data.arrayBuffer()))).file("word/document.xml").async("string");
  check("Word: „geplant“ fett, violett, hinterlegt", /<w:r><w:rPr><w:b\/><w:color w:val="6D28D9"\/><w:shd w:val="clear" w:color="auto" w:fill="EFE7FB"\/><\/w:rPr><w:t xml:space="preserve">geplant<\/w:t><\/w:r>/.test(xml));
  check("Word: „verfügbar“ grün", xml.includes('<w:color w:val="15803D"/><w:shd w:val="clear" w:color="auto" w:fill="E7F6EC"/></w:rPr><w:t xml:space="preserve">verfügbar</w:t>'));
  const cb = $("vrev-stage").querySelector('[data-vrev-act="status-colors"]');
  check("Option „Statusangaben farbig“ standardmäßig an", cb && cb.checked);
  cb.checked = false; fire(cb, "change"); await wait(10);
  w = await save("word-dist");
  xml = await (await JSZipNode.loadAsync(Buffer.from(await w.data.arrayBuffer()))).file("word/document.xml").async("string");
  check("Option aus: keine Statusfarben", !xml.includes("6D28D9") && xml.includes("ist geplant und wird"));

  // KI-Pruefung parallel
  gotoStage(4); await wait(10);
  maxActive = 0;
  act("ai-quality");
  await waitUntil(() => /KI-Prüfung: \d+ Befund/.test($("vrev-status").textContent), 10000);
  check("KI-Prüfung: 3 Kapitel gleichzeitig", maxActive === 3);
  // Uebersetzung parallel + Tabellen
  gotoStage(5); await wait(10);
  maxActive = 0;
  $("vrev-stage").querySelector("[data-vrev-tr-lang]").value = "EN";
  act("translate");
  await waitUntil(() => /Kopie/.test($("vrev-status").textContent), 10000);
  check("Übersetzung: 3 Kapitel gleichzeitig, Reihenfolge erhalten", maxActive === 3 && $("vrev-status").textContent.includes("8 Kapitel übersetzt"));
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sess = JSON.parse(savedFiles[0].data), en = sess.vrev.docs.find((d) => d.source === "Übersetzung");
  check("Übersetzte Kopie behält Kapitelreihenfolge und Tabelle", en && en.chapters.map((c) => c.title).join("|") === Array.from({ length: 8 }, (_, i) => "EN " + (i + 1) + " Kapitel " + (i + 1)).join("|") &&
    en.chapters[1].tables && en.chapters[1].tables[0].rows[0][0] === "Feld");

  // AGENT: Hinweis ohne Domaenen
  nav("agent"); await wait(10);
  doc.querySelector('[data-agent-src="R:1"]').checked = true; fire(doc.querySelector('[data-agent-src="R:1"]'), "change");
  doc.querySelector('[data-agent-run="classification"]').click();
  await waitUntil(() => /^Orchestrator fertig/.test($("agent-status").textContent), 10000);
  check("Classification: Hinweis „keine Domänen in VARIANTE angelegt“", doc.querySelector('[data-agent-row="classification"]').children[5].textContent.includes("(keine Domänen in VARIANTE angelegt)"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
