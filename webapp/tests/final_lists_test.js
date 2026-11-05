// v2.148.0 FINAL-Import: nummerierte Listen und Aufzaehlungen aus Word behalten ihre Nummern bzw. Aufzaehlungszeichen
// (vorher gingen sie verloren: "Daten erfassen / Pruefen / Speichern" ohne 1. 2. 3.); Neubeginn je Liste, Unterebenen.
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
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const L = (t, numId, lvl) => '<w:p><w:pPr><w:numPr><w:ilvl w:val="' + (lvl || 0) + '"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const NUMBERING = '<?xml version="1.0" encoding="UTF-8"?><w:numbering ' + NS + '>' +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
async function docx(body, withNumbering) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  if (withNumbering) z.file("word/numbering.xml", NUMBERING);
  return z.generateAsync({ type: "nodebuffer" });
}
const BODY = H("1 Verträge anlegen") + P("So legen Sie einen Vertrag an:") + L("Daten erfassen", 1) + L("Prüfen", 1) + L("Pflichtfelder", 1, 1) + L("Anhänge", 1, 1) + L("Speichern", 1) +
  P("Hinweise:") + L("Entwürfe werden 30 Tage aufbewahrt.", 2) + L("Nur für Händler", 2, 1) +
  H("2 Kündigung") + L("Vertrag öffnen", 3) + L("Kündigen wählen", 3);

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  let lastXml = "";
  async function build(file, name) {
    nav("final"); await wait(20);
    const n = $("final-manuals-tbody").children.length;
    setFiles($("final-manual-file-input"), [new win.File([file], name + ".docx")]);
    await waitUntil(() => $("final-manuals-tbody").children.length === n + 1, 5000);
    const sel = $("final-build-source-select") || null;
    $("final-build-name-input").value = name; fire($("final-build-name-input"), "input");
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
    savedFiles.length = 0;
    $("final-master-download-docx-btn").click();
    await waitUntil(() => savedFiles.length === 1, 8000);
    const z = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
    const xml = await z.file("word/document.xml").async("string");
    if (!lastXml) lastXml = xml;
    return xml.split("</w:p>").map((p) => [...p.replace(/<w:tab\/>/g, "<w:t> </w:t>").matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")).filter(Boolean);
  }

  nav("final"); await wait(20);
  const t = await build(await docx(BODY, true), "Listen");
  const i = t.indexOf("So legen Sie einen Vertrag an:");
  check("Nummerierte Liste mit Nummern übernommen (1. 2. … 3.)", i > 0 && t[i + 1] === "1. Daten erfassen" && t[i + 2] === "2. Prüfen" && t[i + 5] === "3. Speichern");
  check("Unterebene neu gezählt (1. 2.) und Hauptebene läuft weiter", t[i + 3] === "1. Pflichtfelder" && t[i + 4] === "2. Anhänge");
  check("Aufzählung mit • und Unterebene mit ◦", t.includes("• Entwürfe werden 30 Tage aufbewahrt.") && t.includes("◦ Nur für Händler"));
  check("Neue Liste im nächsten Kapitel beginnt wieder bei 1.", t.includes("1. Vertrag öffnen") && t.includes("2. Kündigen wählen"));
  check("Überschriften und normale Absätze ohne Präfix", t.includes("1 Verträge anlegen") && t.includes("Hinweise:") && !t.some((x) => /^(\d+\. |• )(1 Verträge|Hinweise|So legen)/.test(x)));

  // Ohne numbering.xml (z. B. aus anderen Programmen): Listen als Aufzählung
  const t2 = await build(await docx(H("1 Ohne Formate") + L("Erster Punkt", 1) + L("Zweiter Punkt", 1), false), "OhneFormate");
  check("Ohne Nummerierungsdefinition: Listen als Aufzählung (•)", t2.includes("• Erster Punkt") && t2.includes("• Zweiter Punkt"));

  check("Listen im Word mit hängendem Einzug, Unterebene tiefer", /<w:ind w:left="720" w:hanging="360"\/><\/w:pPr><w:r><w:t xml:space="preserve">1\.<\/w:t><\/w:r><w:r><w:tab\/><w:t xml:space="preserve">Daten erfassen/.test(lastXml) && /<w:ind w:left="1080" w:hanging="360"\/><\/w:pPr><w:r><w:t xml:space="preserve">◦/.test(lastXml));
  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
