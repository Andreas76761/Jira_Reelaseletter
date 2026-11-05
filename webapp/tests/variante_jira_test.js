// v2.156.0 VARIANTE: Option "Jira-Nummern entfernen" (standardmaessig an) – Varianten gehen an Kunden; abschaltbar,
// in der Sitzung gespeichert.
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
const prompts = [];
let slow = false;
async function sample(input, opts) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (slow) {
    await new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      if (sig) sig.addEventListener("abort", () => reject(Object.assign(new Error("abgebrochen"), { code: "cancelled" })));
      setTimeout(resolve, 5000);
    });
  }
  let text = "SONSTIGES";
  if (p.includes("ZIELSPRACHE:")) {
    const title = (p.match(/\nTITEL: (.*)\n/) || [])[1] || "";
    const body = p.slice(p.indexOf("\nTEXT:\n") + 7);
    text = title.includes("Verträge anlegen") ? "TITEL: Create contracts\n\nContracts are created online." : "TITEL: EN-" + title + "\n\n" + "EN: " + body;
  }
  return { text, truncated: false };
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
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function buildDocx(body) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type: "nodebuffer" });
}
const heading = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const para = (t) => "<w:p><w:r><w:t>" + esc(t) + "</w:t></w:r></w:p>";
const SECRET = "INTERNE-NOTIZ-5150";
async function blobBuf(d) { return Buffer.from(await d.arrayBuffer()); }

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length > 0, 5000); return JSON.parse(savedFiles[0].data); }
  async function load(ses) {
    const si = $("session-import-input");
    Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
    fire(si, "change"); await wait(80);
    if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
    await wait(400);
  }
  async function saved(btn) { savedFiles.length = 0; fire(btn, "click"); await waitUntil(() => savedFiles.length >= 1, 10000); return savedFiles[0]; }
  async function variantWord() {
    const row = Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b") && r.querySelector("b").textContent === "Basis – Retail – DE");
    $("variante-status").textContent = "";
    fire(row.querySelector("[data-vr-generate]"), "click");
    await waitUntil(() => $("variante-status").textContent.startsWith("1 von 1"), 8000);
    const zf = await saved($("variante-zip-btn"));
    const zz = await JSZipNode.loadAsync(Buffer.from(await zf.data.arrayBuffer()));
    const n = Object.keys(zz.files).find((x) => /\.docx$/.test(x));
    const d = await JSZipNode.loadAsync(await zz.file(n).async("nodebuffer"));
    return [...(await d.file("word/document.xml").async("string")).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
  }
  let ses = await session();
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: "Verträge werden online angelegt (ONESCM-12).\nDie Laufleistung wird in km pro Jahr erfasst (ONESCM-73, ONESCM-74).\nExport als UTF-8 nach ISO-9001, Abgasnorm EURO-6.\nRemarque : texte ; fin !", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  await load(ses);
  nav("variante"); await wait(50);
  check("Option „Jira-Nummern entfernen“ vorhanden und standardmäßig an", $("variante-opt-strip-jira") && $("variante-opt-strip-jira").checked);
  setVal("variante-new-role", "Retail"); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click");
  let t = await variantWord();
  check("Variante ohne Jira-Nummern, Text vollständig und sauber (keine leeren Klammern)", !/ONESCM-\d+/.test(t) && t.includes("Verträge werden online angelegt.") && t.includes("km pro Jahr erfasst.") && !t.includes("()"));
  ses = await session();
  check("v2.172: Normbezeichnungen bleiben (UTF-8, ISO-9001, EURO-6), Text ohne Jira-Nummer unverändert (franz. „Remarque : …“)", t.includes("Export als UTF-8 nach ISO-9001, Abgasnorm EURO-6.") && t.includes("Remarque : texte ; fin !"));
  check("Einstellung in der Sitzung gespeichert", ses.variante.opts.stripJira === true);
  const cb = $("variante-opt-strip-jira"); cb.checked = false; fire(cb, "change"); await wait(20);
  t = await variantWord();
  check("Abgeschaltet: Jira-Nummern bleiben erhalten", t.includes("ONESCM-12") && t.includes("ONESCM-73"));
  ses = await session();
  check("Abschaltung in der Sitzung gespeichert", ses.variante.opts.stripJira === false);
  ses.final.versions[0].chapters[0].text += " ";
  check("Basisdokument (FINAL-Stand) behält die Jira-Nummern", ses.final.versions[0].chapters[0].text.includes("ONESCM-12"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
