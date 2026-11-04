// v2.129.0 VARIANTE: Uebersetzungsspeicher – unveraenderte Kapitel ohne KI-Aufruf wiederverwenden, nur
// geaenderte neu uebersetzen, manuelle Korrekturen im Stand merken (Neu-Erzeugen behaelt sie), Glossar-
// Aenderung erzwingt Neuuebersetzung, Speicher leeren, Sitzung.
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
    text = "TITEL: EN " + title + "\n\nEN " + body;
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
    nav("variante");
  }
  const vRow = (name) => Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b").textContent === name);
  async function gen(name) {
    $("variante-status").textContent = "";
    fire(vRow(name).querySelector("[data-vr-generate]"), "click");
    await waitUntil(() => $("variante-status").textContent.startsWith("1 von 1"), 8000);
  }
  const note = (name) => vRow(name).children[5].textContent;
  const EN = "Basis – Retail – EN";
  const standOf = (ses, name) => ses.final.versions.find((v) => v.name === name);

  let ses = await session();
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: "Der Vertrag wird geprüft.", screenIds: [] }, { title: "Kapitel 2: Kunden", level: 1, text: "Kunden pflegen.", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  await load(ses);
  check("Speicher zunächst leer", $("variante-tm-info").textContent === "Übersetzungsspeicher: leer" && $("variante-tm-clear-btn").disabled);
  for (const [r, l] of [["Retail", "EN"], ["Retail", "DE"]]) { setVal("variante-new-role", r); setVal("variante-new-lang", l); fire($("variante-add-btn"), "click"); }

  prompts.length = 0;
  await gen(EN);
  check("Erstes Erzeugen: 2 KI-Übersetzungen, Speicher 2 Kapitel (EN 2)", prompts.length === 2 && note(EN).includes("2 übersetzt") && !note(EN).includes("Übersetzungsspeicher") && $("variante-tm-info").textContent === "Übersetzungsspeicher: 2 Kapitel (EN 2)");
  prompts.length = 0;
  await gen(EN);
  check("Neu erzeugen ohne Änderung: keine KI-Aufrufe, 2 aus Speicher", prompts.length === 0 && note(EN).includes("0 übersetzt, 2 aus Übersetzungsspeicher"));
  ses = await session();
  check("Ergebnis aus Speicher identisch", standOf(ses, EN).chapters[0].title === "1 EN Verträge" && standOf(ses, EN).chapters[0].text === "EN Der Vertrag wird geprüft.");
  check("Deutsche Variante: kein 'Korrekturen merken'", !vRow("Basis – Retail – DE").querySelector("[data-vr-tm-learn]") && !!vRow(EN).querySelector("[data-vr-tm-learn]"));

  // Basis aendern -> nur geaendertes Kapitel neu
  ses.final.versions[0].chapters[1].text = "Kundendaten pflegen.";
  await load(ses);
  prompts.length = 0;
  fire($("variante-update-stale-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.includes("Variante(n) erzeugt"), 8000);
  check("Basis geändert: nur Kapitel 2 neu übersetzt, Kapitel 1 aus Speicher", prompts.length === 1 && prompts[0].includes("TITEL: Kunden") && note(EN).includes("1 übersetzt, 1 aus Übersetzungsspeicher") && $("variante-tm-info").textContent === "Übersetzungsspeicher: 3 Kapitel (EN 3)");

  // Manuelle Korrektur im Stand merken
  ses = await session();
  standOf(ses, EN).chapters[0].title = "1 Contract check";
  standOf(ses, EN).chapters[0].text = "The contract is checked (corrected).";
  await load(ses);
  fire(vRow(EN).querySelector("[data-vr-tm-learn]"), "click");
  check("Korrektur gemerkt: 1 Kapitel", $("variante-status").textContent.startsWith("1 korrigierte(s) Kapitel von „Basis – Retail – EN“ in den Übersetzungsspeicher übernommen"));
  fire(vRow(EN).querySelector("[data-vr-tm-learn]"), "click");
  check("Erneut merken: keine weiteren Korrekturen", $("variante-status").textContent === "Keine Korrekturen in „Basis – Retail – EN“ gefunden.");
  prompts.length = 0;
  await gen(EN);
  ses = await session();
  check("Neu erzeugen behält die Korrektur (Titel mit neuer Nummer, Text) ohne KI-Aufruf", prompts.length === 0 && standOf(ses, EN).chapters[0].title === "1 Contract check" && standOf(ses, EN).chapters[0].text === "The contract is checked (corrected).");

  // Struktur veraendert -> nicht uebernehmen
  standOf(ses, EN).chapters.pop();
  await load(ses);
  fire(vRow(EN).querySelector("[data-vr-tm-learn]"), "click");
  check("Veränderte Kapitelstruktur: Übernahme abgelehnt", $("variante-status").textContent === "Korrekturen nicht übernommen: Kapitelstruktur des Stands wurde verändert.");

  // Glossar betrifft Kapitel 1 -> neu uebersetzen
  setVal("variante-gloss-src", "Vertrag"); setVal("variante-gloss-lang", "EN"); setVal("variante-gloss-target", "contract"); fire($("variante-gloss-add-btn"), "click");
  prompts.length = 0;
  await gen(EN);
  check("Glossar-Begriff im Kapitel: Kapitel 1 neu übersetzt (mit Glossar), Kapitel 2 aus Speicher", prompts.length === 1 && prompts[0].includes("- Vertrag → contract") && note(EN).includes("1 übersetzt, 1 aus Übersetzungsspeicher"));

  // Sitzung
  ses = await session();
  check("Sitzung enthält Speicher mit Herkunft (KI/Korrektur)", Object.keys(ses.variante.tm.EN).length === 4 && Object.values(ses.variante.tm.EN).some((e) => e.source === "Korrektur") && Object.values(ses.variante.tm.EN).some((e) => e.source === "KI"));
  await load(ses);
  check("Nach Laden: Speicher-Anzeige erhalten", $("variante-tm-info").textContent === "Übersetzungsspeicher: 4 Kapitel (EN 4)");

  // Leeren
  fire($("variante-tm-clear-btn"), "click"); await wait(40);
  check("Leeren fragt nach", !$("confirm-modal-overlay").hidden);
  fire($("confirm-modal-ok-btn"), "click"); await wait(200);
  prompts.length = 0;
  await gen(EN);
  check("Nach dem Leeren: alles neu übersetzt", prompts.length === 2 && $("variante-tm-info").textContent === "Übersetzungsspeicher: 2 Kapitel (EN 2)");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE UEBERSETZUNGSSPEICHER-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
