// v2.127.0 VARIANTE: Rollen-Markierungen erscheinen in keiner Ausgabe des Basisdokuments (FINAL Word,
// PowerPoint, Schritt 9 Gesamtdokument/PDF/Agenten), Inhalt bleibt vollstaendig; alle Varianten als ZIP
// (je Variante ein Word); Varianten-Uebersicht als Excel (Kapitel x Variante, Status je Variante).
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
  async function session() {
    savedFiles.length = 0;
    fire($("session-export-btn"), "click");
    await waitUntil(() => savedFiles.length > 0, 5000);
    return JSON.parse(savedFiles[0].data);
  }
  async function load(ses) {
    const si = $("session-import-input");
    Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
    fire(si, "change");
    await wait(80);
    if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
    await wait(400);
  }
  async function saved(btn, n) { savedFiles.length = 0; fire(btn, "click"); await waitUntil(() => savedFiles.length >= (n || 1), 10000); return savedFiles[0]; }
  const zipOf = async (f) => JSZipNode.loadAsync(Buffer.from(await f.data.arrayBuffer()));
  const T1 = ["Allgemeiner Text.", "[Rolle: Retail] Nur für Händler.", "[Nicht Rolle: Retail] Für alle außer Händler.", "[Rolle: MO, HQ]", "MO-Block Zeile 1.", "MO-Block Zeile 2.", "[/Rolle]", "Schluss."].join("\n");
  let ses = await session();
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: T1, screenIds: [] }, { title: "Kapitel 2: Kunden", level: 1, text: "Kundentext.", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  await load(ses);

  // ===================== Basisdokument-Ausgaben ohne Markierungen =====================
  nav("final"); await wait(50);
  const wf = await saved($("final-design-docx-btn"));
  const wx = await (await zipOf(wf)).file("word/document.xml").async("string");
  check("FINAL Word: keine Rollen-Markierungen, aber aller Inhalt", !wx.includes("[Rolle") && !wx.includes("[/Rolle]") && !wx.includes("[Nicht Rolle") &&
    ["Nur für Händler.", "Für alle außer Händler.", "MO-Block Zeile 1.", "MO-Block Zeile 2.", "Schluss."].every((t) => wx.includes(t)));
  const pf = await saved($("final-design-pptx-btn"));
  const pz = await zipOf(pf);
  let ptxt = "";
  for (const f of Object.keys(pz.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) ptxt += await pz.file(f).async("string");
  check("FINAL PowerPoint: keine Rollen-Markierungen", ptxt.includes("Nur für Händler.") && !ptxt.includes("[Rolle") && !ptxt.includes("[/Rolle]"));
  fire($("final-review-merge-btn"), "click");
  await waitUntil(() => $("final-review-merge-note").textContent.includes("Seite"), 15000);
  const pv = $("final-review-merge-preview").textContent;
  check("Schritt 9 Gesamtdokument-Vorschau: ohne Markierungen, Inhalt vollständig", pv.includes("Nur für Händler.") && pv.includes("MO-Block Zeile 2.") && !pv.includes("[Rolle") && !pv.includes("[/Rolle]"));
  const pdf = await saved($("final-review-pdf-btn"));
  const pdfTxt = Buffer.from(await pdf.data.arrayBuffer()).toString("latin1");
  check("Schritt 9 PDF: ohne Markierungen", pdfTxt.startsWith("%PDF") && !pdfTxt.includes("[Rolle") && !pdfTxt.includes("[/Rolle]"));
  ses = await session();
  check("Basisdokument selbst behält die Markierungen (zum Bearbeiten)", ses.final.versions[0].chapters[0].text === T1);

  // ===================== Varianten: ZIP + Uebersicht =====================
  nav("variante");
  check("Ohne Varianten: ZIP und Übersicht gesperrt", $("variante-zip-btn").disabled && $("variante-overview-xlsx-btn").disabled);
  setVal("variante-domain-new-input", "Kunden"); fire($("variante-domain-add-btn"), "click");
  const sel = Array.from(doc.querySelectorAll("[data-vr-map]"))[1]; sel.value = "Kunden"; fire(sel, "change");
  const cb = Array.from(doc.querySelectorAll('#variante-matrix-tbody [data-vm-kind="dom"]')).find((c) => c.getAttribute("data-vm-key") === "Kunden" && c.getAttribute("data-vm-role") === "Retail");
  cb.checked = false; fire(cb, "change");
  for (const r of ["Retail", "MO", "HQ"]) { setVal("variante-new-role", r); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click"); }
  check("Varianten angelegt, noch nicht erzeugt: Übersicht möglich, ZIP gesperrt", !$("variante-overview-xlsx-btn").disabled && $("variante-zip-btn").disabled);
  // nur Retail und MO erzeugen
  for (const n of ["Basis – Retail – DE", "Basis – MO – DE"]) {
    const row = Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b").textContent === n);
    $("variante-status").textContent = "";
    fire(row.querySelector("[data-vr-generate]"), "click");
    await waitUntil(() => $("variante-status").textContent.startsWith("1 von 1"), 8000);
  }
  check("ZIP jetzt möglich", !$("variante-zip-btn").disabled);
  const zf = await saved($("variante-zip-btn"));
  const zz = await zipOf(zf);
  const names = Object.keys(zz.files).sort();
  check("ZIP: Dateiname, je erzeugter Variante ein Word (HQ noch nicht erzeugt)", /^Varianten_Basis_.*\.zip$/.test(zf.filename) && names.length === 2 && names.every((n) => /^Variante_Basis_.*(Retail|MO)_DE_.*\.docx$/.test(n)));
  const inner = async (role) => { const n = names.find((x) => x.includes(role)); const d = await JSZipNode.loadAsync(await zz.file(n).async("nodebuffer")); return d.file("word/document.xml").async("string"); };
  const rx = await inner("Retail"), mx = await inner("MO");
  check("ZIP-Word Retail: eigener Inhalt, Verweis auf Kunden, keine Markierungen", rx.includes("Nur für Händler.") && !rx.includes("MO-Block") && rx.includes("Themen in anderen Rollen-Handbüchern") && !rx.includes("[Rolle"));
  check("ZIP-Word MO: MO-Block und Kunden-Kapitel enthalten", mx.includes("MO-Block Zeile 1.") && mx.includes("2 Kunden") && !mx.includes("Nur für Händler."));
  check("Status meldet Download", $("variante-status").textContent.startsWith("2 Variante(n) als „Varianten_Basis_"));

  const of = await saved($("variante-overview-xlsx-btn"));
  const oz = await zipOf(of);
  const s1 = await oz.file("xl/worksheets/sheet1.xml").async("string"), s2 = await oz.file("xl/worksheets/sheet2.xml").async("string"), wb = await oz.file("xl/workbook.xml").async("string");
  check("Übersicht: zwei Blätter, Dateiname", /^Varianten_Uebersicht_Basis_.*\.xlsx$/.test(of.filename) && wb.includes("Kapitel je Variante") && wb.includes("Varianten"));
  check("Blatt 1: Kapitel × Varianten mit neuer Nummer bzw. Verweis-Rollen", ["Kapitel 1: Verträge", "Kapitel 2: Kunden", "Allgemein", "Basis – Retail – DE", "Basis – HQ – DE", "→ Markt, MO, IT, HQ"].every((t) => s1.includes(t)) && s1.includes(">2<"));
  check("Blatt 2: Status je Variante (aktuell / nicht erzeugt)", s2.includes("aktuell") && s2.includes("nicht erzeugt") && s2.includes("Basis – MO – DE"));
  // veraltet -> Hinweis in ZIP-Status und Uebersicht
  cb.checked = true;
  const cb2 = Array.from(doc.querySelectorAll('#variante-matrix-tbody [data-vm-kind="dom"]')).find((c) => c.getAttribute("data-vm-key") === "Kunden" && c.getAttribute("data-vm-role") === "Retail");
  cb2.checked = true; fire(cb2, "change");
  await saved($("variante-zip-btn"));
  check("ZIP mit veralteter Variante: Warnhinweis", $("variante-status").textContent.includes("Achtung: 1 davon veraltet"));
  const of2 = await saved($("variante-overview-xlsx-btn"));
  const s2b = await (await zipOf(of2)).file("xl/worksheets/sheet2.xml").async("string");
  check("Übersicht: veraltete Variante gekennzeichnet", s2b.includes("veraltet: Matrix/Optionen geändert"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VARIANTE-EXPORT-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
