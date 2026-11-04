// v2.130.0 FINAL Schritt 7: Rollen-Markierungen als Badges, "Ansicht als Rolle" (ausgeblendete Absaetze
// abgeschwaecht oder weggelassen, Screen-Zuordnung bleibt korrekt), Steuerung nur bei Dokumenten mit Markierungen.
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
  const T1 = ["Allgemeiner Text.", "[Rolle: Retail] Nur für Händler.", "[Nicht Rolle: Retail] Für alle außer Händler.", "[Rolle: MO, HQ]", "MO-Block Zeile 1.", "[Bild]", "MO-Block Zeile 2.", "[/Rolle]", "[Bild]", "Schluss."].join("\n");
  const mkStand = (t1) => ({ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: t1, screenIds: [11, 12] }, { title: "Kapitel 2: Kunden", level: 1, text: "Kundentext.", screenIds: [] }] });
  let ses = await session();
  ses.uploadedImages = (ses.uploadedImages || []).concat([
    { id: 11, name: "s1.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", description: "Screen MO", finalScreensFileId: null },
    { id: 12, name: "s2.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", description: "Screen Schluss", finalScreensFileId: null }]);
  ses.final.versions = [mkStand(T1)];
  ses.final.activeVersionId = 1;
  await load(ses);
  nav("final"); await wait(50);
  setVal("final-result-chapter-select", "Kapitel 1: Verträge");
  const out = () => $("final-result-master-output");
  check("Steuerung 'Ansicht als Rolle' sichtbar (Dokument hat Markierungen)", !$("final-result-role-wrap").hidden && Array.from($("final-result-role-select").options).map((o) => o.value).join(",") === ",Markt,MO,Retail,IT,HQ" && $("final-result-role-hide").disabled);
  const badges = () => Array.from(out().querySelectorAll(".final-role-badge")).map((b) => b.textContent);
  check("Markierungen als Badges, kein Rohtext", JSON.stringify(badges()) === JSON.stringify(["Nur: Retail", "Nicht: Retail", "Nur: MO, HQ", "Ende Rollen-Block"]) && !out().textContent.includes("[Rolle") && !out().textContent.includes("[/Rolle]"));
  check("Alle Rollen: nichts abgeschwächt, Screens in Reihenfolge", out().querySelectorAll(".final-role-hidden").length === 0 && out().textContent.indexOf("MO-Block Zeile 1.") < out().textContent.indexOf("[Bild:") && /\[Bild: [^\]]+\][\s\S]*\[Bild: [^\]]+\]/.test(out().textContent));
  const caps = () => (out().textContent.match(/\[Bild: ([^\]]+)\]/g) || []);
  const capsAll = caps();
  setVal("final-result-role-select", "Retail");
  const hiddenTxt = Array.from(out().querySelectorAll(".final-role-hidden")).map((s) => s.textContent);
  check("Ansicht Retail: 'Nicht Retail' und MO-Block abgeschwächt, Händler-Absatz normal", hiddenTxt.length === 4 && hiddenTxt.some((t) => t.includes("Für alle außer Händler.")) && hiddenTxt.some((t) => t.includes("MO-Block Zeile 2.")) && !hiddenTxt.some((t) => t.includes("Nur für Händler.")));
  check("Hinweis: 4 Absätze ausgeblendet (durchgestrichen)", $("final-result-role-note").textContent === "4 Absatz/Absätze für „Retail“ ausgeblendet (durchgestrichen).");
  check("Screen des ausgeblendeten Blocks abgeschwächt, zweiter Screen sichtbar mit eigener Beschriftung", hiddenTxt.some((t) => t === capsAll[0]) && caps()[1] === capsAll[1] && !hiddenTxt.includes(capsAll[1]));
  $("final-result-role-hide").checked = true; fire($("final-result-role-hide"), "change");
  check("Weglassen: ausgeblendete Absätze und Badges entfallen", !out().textContent.includes("Für alle außer Händler.") && !out().textContent.includes("MO-Block") && badges().join() === "Nur: Retail" && caps().length === 1 && caps()[0] === capsAll[1] && $("final-result-role-note").textContent.includes("weggelassen"));
  setVal("final-result-role-select", "MO");
  check("Ansicht MO (weglassen): MO-Block und 'Nicht Retail' sichtbar, Händler-Absatz weg", out().textContent.includes("MO-Block Zeile 1.") && out().textContent.includes("Für alle außer Händler.") && !out().textContent.includes("Nur für Händler.") && caps().length === 2);
  setVal("final-result-role-select", "");
  check("Zurück zu 'alle Rollen': alles sichtbar, Weglassen deaktiviert", out().textContent.includes("Nur für Händler.") && out().textContent.includes("MO-Block Zeile 1.") && $("final-result-role-hide").disabled && $("final-result-role-note").textContent === "");
  setVal("final-result-chapter-select", "Kapitel 2: Kunden");
  check("Kapitel ohne Markierungen: unverändert dargestellt", out().textContent.startsWith("Kundentext.") && !out().querySelector(".final-role-badge"));
  check("Quellversion bleibt unberührt", !$("final-result-source-output").querySelector(".final-role-badge"));

  // Gesamtdokument + Vollbild
  setVal("final-result-role-select", "Retail");
  check("Weglassen-Einstellung bleibt erhalten", $("final-result-role-hide").checked && !out().textContent.includes("MO-Block"));
  $("final-result-role-hide").checked = false; fire($("final-result-role-hide"), "change");
  const allOpt = Array.from($("final-result-chapter-select").options).find((o) => o.textContent.includes("Gesamtes Dokument"));
  setVal("final-result-chapter-select", allOpt.value);
  check("Gesamtes Dokument in Rollen-Ansicht", out().querySelectorAll(".final-role-hidden").length > 0 && out().textContent.includes("Kundentext."));
  fire(doc.querySelector('[data-final-result-fullscreen="master"]'), "click");
  await wait(100);
  check("Vollbild zeigt dieselbe Rollen-Ansicht", !$("final-viewer").hidden && $("final-viewer").querySelectorAll(".final-role-hidden").length > 0 && $("final-viewer").querySelectorAll(".final-role-badge").length > 0);

  // Dokument ohne Markierungen
  ses = await session();
  ses.final.versions = [mkStand("Nur normaler Text.\n[Bild]")];
  await load(ses);
  nav("final"); await wait(50);
  check("Dokument ohne Markierungen: Steuerung ausgeblendet", $("final-result-role-wrap").hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ROLLEN-ANSICHT-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
