// v2.128.0 VARIANTE: Glossar fuer Uebersetzungen (manuell, Excel breit/lang, Export), nur passende Begriffe
// im Prompt, Pruefung der Einhaltung mit Abweichungsliste, Glossar beeinflusst "veraltet" nur fuer die Sprache;
// Volltext-Vorschau je Variante (Rollen-Bedingungen angewendet, Screens als Platzhalter).
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
    if (p.includes("TITEL: Verträge")) text = "TITEL: Agreements\n\nThe agreement is checked.\n[Bild]";
    else text = "TITEL: Customers\n\nMaintain customer master data.";
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
  async function xlsxFile(rows, name) {
    const xesc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const colL = (i) => String.fromCharCode(65 + i);
    const z = new JSZipNode();
    z.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="G" sheetId="1" r:id="rId1"/></sheets></workbook>');
    z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    z.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => v === "" ? "" : '<c r="' + colL(c) + (r + 1) + '" t="inlineStr"><is><t>' + xesc(v) + "</t></is></c>").join("") + "</row>").join("") + "</sheetData></worksheet>");
    return new win.File([await z.generateAsync({ type: "nodebuffer" })], name);
  }
  async function importGloss(rows, name) {
    const inp = $("variante-gloss-import-input");
    Object.defineProperty(inp, "files", { value: [await xlsxFile(rows, name)], configurable: true });
    fire(inp, "change");
    await waitUntil(() => $("variante-gloss-note").textContent.includes(name), 5000);
  }
  const vRow = (name) => Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b").textContent === name);
  const stale = (name) => { const b = vRow(name).querySelector(".variante-stale"); return b ? b.textContent : ""; };
  const glossRows = () => Array.from(doc.querySelectorAll("#variante-glossary-tbody tr")).map((r) => Array.from(r.children).slice(0, 3).map((c) => c.textContent).join("|"));
  function addTerm(src, lang, target) { setVal("variante-gloss-src", src); setVal("variante-gloss-lang", lang); setVal("variante-gloss-target", target); fire($("variante-gloss-add-btn"), "click"); }

  let ses = await session();
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: "Der Vertrag wird geprüft.\n[Rolle: MO] Nur MO.\n[Bild]", screenIds: [] }, { title: "Kapitel 2: Kunden", level: 1, text: "Kundenstamm pflegen.", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  await load(ses);
  nav("variante");

  // ===================== Glossar =====================
  check("Glossar zunächst leer (0)", $("variante-glossary-count").textContent === "0");
  addTerm("Vertrag", "EN", "contract"); addTerm("Kunde", "EN", "customer"); addTerm("Vertrag", "FR", "contrat");
  check("3 Begriffe manuell angelegt", $("variante-glossary-count").textContent === "3" && glossRows().includes("Vertrag|EN|contract") && glossRows().includes("Vertrag|FR|contrat"));
  addTerm("vertrag", "EN", "agreement");
  check("Gleicher Begriff/Sprache: Übersetzung aktualisiert statt doppelt", $("variante-glossary-count").textContent === "3" && glossRows().includes("Vertrag|EN|agreement") && $("variante-gloss-note").textContent.includes("aktualisiert"));
  addTerm("Vertrag", "EN", "contract");
  addTerm("Leer", "EN", "");
  check("Unvollständiger Begriff abgewiesen", $("toast").textContent.includes("Begriff und Übersetzung"));
  await importGloss([["Begriff", "EN", "FR"], ["Kundenstamm", "customer master data", ""], ["Fahrzeug", "vehicle", "véhicule"]], "glossar_breit.xlsx");
  check("Excel breit (Begriff | EN | FR): 3 neu", $("variante-gloss-note").textContent === "Glossar aus „glossar_breit.xlsx“: 3 neu, 0 aktualisiert." && $("variante-glossary-count").textContent === "6");
  await importGloss([["Begriff", "Sprache", "Übersetzung"], ["Vertrag", "EN", "contract"], ["Rechnung", "en", "invoice"]], "glossar_lang.xlsx");
  check("Excel lang (Begriff | Sprache | Übersetzung): 1 neu, 1 unverändert", $("variante-gloss-note").textContent === "Glossar aus „glossar_lang.xlsx“: 1 neu, 0 aktualisiert, 1 unverändert." && glossRows().includes("Rechnung|EN|invoice"));
  savedFiles.length = 0;
  fire($("variante-gloss-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const gs = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("xl/worksheets/sheet1.xml").async("string");
  check("Glossar-Export breit: Begriff | EN | FR mit Einträgen", /^Variante_Glossar_.*\.xlsx$/.test(savedFiles[0].filename) && ["Begriff", "EN", "FR", "Kundenstamm", "customer master data", "contrat", "véhicule"].every((t) => gs.includes(t)));
  const rechIdx = Array.from(doc.querySelectorAll("#variante-glossary-tbody tr")).findIndex((r) => r.textContent.includes("Rechnung"));
  fire(doc.querySelectorAll("#variante-glossary-tbody [data-vr-gloss-del]")[rechIdx], "click");
  check("Begriff entfernt", $("variante-glossary-count").textContent === "6" && !glossRows().some((r) => r.startsWith("Rechnung")));

  // ===================== Uebersetzung mit Glossar =====================
  for (const [r, l] of [["Retail", "EN"], ["Retail", "DE"], ["Retail", "FR"]]) { setVal("variante-new-role", r); setVal("variante-new-lang", l); fire($("variante-add-btn"), "click"); }
  prompts.length = 0;
  fire($("variante-generate-all-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.includes("Variante(n) erzeugt"), 10000);
  const p1 = prompts.find((p) => p.includes("TITEL: Verträge") && p.includes("(EN)")) || "", p2 = prompts.find((p) => p.includes("TITEL: Kunden") && p.includes("(EN)")) || "";
  check("Prompt Kapitel 1 (EN): nur passende Begriffe (Vertrag), keine FR-Begriffe", p1.includes("GLOSSAR (verbindlich") && p1.includes("- Vertrag → contract") && !p1.includes("Kunde →") && !p1.includes("contrat"));
  check("Prompt Kapitel 2 (EN): Kunde und Kundenstamm, nicht Vertrag", p2.includes("- Kunde → customer") && p2.includes("- Kundenstamm → customer master data") && !p2.includes("Vertrag →"));
  const pf = prompts.find((p) => p.includes("TITEL: Verträge") && p.includes("(FR)")) || "";
  check("Prompt Kapitel 1 (FR): französischer Begriff", pf.includes("- Vertrag → contrat") && !pf.includes("contract"));
  const en = vRow("Basis – Retail – EN");
  check("EN: 1 Glossar-Abweichung gemeldet (Vertrag → contract nicht verwendet)", en.textContent.includes("1 Glossar-Abweichung(en)") && en.querySelector(".variante-gloss li").textContent === "1 Agreements: „Vertrag“ → „contract“ nicht verwendet");
  check("FR: Abweichung 'contrat' gemeldet; DE ohne Glossar-Prüfung", vRow("Basis – Retail – FR").textContent.includes("Glossar-Abweichung") && !vRow("Basis – Retail – DE").textContent.includes("Glossar"));
  check("Deutsche Variante ohne Übersetzungsaufruf", !prompts.some((p) => p.includes("(DE)")));

  // ===================== Glossar und "veraltet" =====================
  check("Nach dem Erzeugen nichts veraltet", !stale("Basis – Retail – EN") && !stale("Basis – Retail – FR") && !stale("Basis – Retail – DE"));
  addTerm("Fahrzeug", "EN", "car");
  check("EN-Begriff geändert: nur EN-Variante veraltet", stale("Basis – Retail – EN").includes("Matrix/Optionen") && !stale("Basis – Retail – FR") && !stale("Basis – Retail – DE"));

  // ===================== Volltext-Vorschau =====================
  fire(vRow("Basis – Retail – DE").querySelector("[data-vr-preview]"), "click");
  check("Volltext zunächst ausgeblendet", $("variante-preview-full").hidden && $("variante-preview-fulltext-btn").textContent === "Volltext anzeigen");
  fire($("variante-preview-fulltext-btn"), "click");
  const ft = $("variante-preview-full").textContent;
  check("Volltext Retail DE: Rollen-Bedingung angewendet, Screen-Platzhalter, keine Markierung", ft.includes("1 Verträge") && ft.includes("Der Vertrag wird geprüft.") && !ft.includes("Nur MO.") && !ft.includes("[Rolle") && ft.includes("▣ Screen") && ft.includes("2 Kunden"));
  fire(vRow("Basis – Retail – EN").querySelector("[data-vr-preview]"), "click");
  check("Volltext EN: Hinweis 'vor der Übersetzung'", $("variante-preview-full").textContent.startsWith("Vorschau vor der Übersetzung nach Englisch") && $("variante-preview-fulltext-btn").textContent === "Volltext ausblenden");
  fire($("variante-preview-fulltext-btn"), "click");
  check("Volltext wieder ausblendbar", $("variante-preview-full").hidden);

  ses = await session();
  check("Sitzung speichert Glossar und Abweichungen", ses.variante.glossary.length === 6 && ses.variante.variants.find((v) => v.lang === "EN").stats.glossaryMisses.length === 1);
  ses.variante.glossary = [];
  await load(Object.assign(ses, { variante: Object.assign(ses.variante, { glossary: ses.variante.glossary.concat([{ src: "X", lang: "EN", target: "" }, { src: "Auto", lang: "EN", target: "car" }]) }) }));
  nav("variante");
  check("Sitzung laden: unvollständige Einträge verworfen", $("variante-glossary-count").textContent === "1");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VARIANTE-GLOSSAR-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
