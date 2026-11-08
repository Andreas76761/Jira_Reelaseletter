// v2.188.0: KI-Vorschläge (Claude) für Glossar, Synonyme, Abkürzungen: leere Felder (Bedeutung, EN/SK/HI/FR) ergänzen –
// nie Vorhandenes oder Fixiertes überschreiben; echte Synonym-Gruppen nur aus Wörtern der Inhalte (erfundene werden
// verworfen); alles als „KI-Vorschlag“ zu prüfen (übernehmen / verwerfen). Glossar mit Spalte „Bedeutung (Deutsch)“.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];
const prompts = [];
let broken = false;

function fakeClaude(input) {
  const p = String(input);
  prompts.push(p);
  if (broken) return { text: "Das kann ich leider nicht.", truncated: false };
  if (p.includes("WÖRTER:")) {
    return { text: JSON.stringify({ gruppen: [
      { haupt: "Kündigung", synonyme: ["Beendigung"], grund: "beide meinen das Vertragsende" },
      { haupt: "Kunde", synonyme: ["Erfinder"], grund: "erfunden" },
      { haupt: "Vertrag", synonyme: ["Kontrakt"], grund: "Wort nicht in den Inhalten" } ] }), truncated: false };
  }
  const out = {};
  const block = p.split("BEGRIFFE:\n")[1] || "";
  block.split("\n").forEach((l) => {
    const m = l.match(/^- ([^|(]+?)\s*(?:\(|\|)/);
    if (!m) return;
    const t = m[1].trim();
    if (t === "XYZ") { out[t] = {}; return; }
    out[t] = { de: "Erklärung " + t, en: t === "Kundenstamm" ? "OVERRIDE" : "EN " + t, sk: "SK " + t, hi: "HI " + t, fr: "FR " + t };
  });
  return { text: "Hier das Ergebnis:\n" + JSON.stringify(out), truncated: false };
}

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.claude = {
        use: (name) => {
          if (name === "sample") return Promise.resolve((input) => Promise.resolve(fakeClaude(input)));
          if (name === "downloads") return Promise.resolve({ save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
          return Promise.resolve(null);
        },
      };
    },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 8000); return JSON.parse(savedFiles[0].data); }
  async function load(s) {
    const imp = $("session-import-input");
    Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
    fire(imp, "change");
    if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 15000)) fire($("confirm-modal-ok-btn"), "click");
    await waitUntil(() => $("confirm-modal-overlay").hidden, 5000);
    await wait(400);
  }
  const rows = (k) => Array.from(doc.querySelectorAll("#lex-auto-" + k + " [data-lex-idx]"));
  const rowOf = (k, term) => rows(k).find((r) => r.querySelector("b").textContent === term);
  const runAi = async (k) => { fire($("lex-auto-" + k).querySelector("[data-lex-ai]"), "click"); await waitUntil(() => !$("lex-auto-" + k).querySelector("[data-lex-ai]").disabled && /KI-Vorschläge \(|fehlgeschlagen/.test($("lex-auto-" + k).querySelector("[data-lex-ai-note]").textContent), 5000); await wait(20); };
  const note = (k) => $("lex-auto-" + k).querySelector("[data-lex-ai-note]").textContent;

  let s = await session();
  const ch = (title, text) => ({ title, level: 1, fullText: text, cleanText: text, markedText: text });
  s.final.manuals = [{ id: 1, filename: "Handbuch.docx", addedAt: "8.11.2026", pageCount: 2, design: null, chapters: [
    ch("1 Ende", "Die Kündigung beendet den Vertrag. Die Beendigung wird dem Kunde bestätigt."),
    ch("2 Ablauf", "Nach der Kündigung folgt die Beendigung. Der Kunde erhält den Vertrag zurück.") ] }];
  s.lexAuto = { enabled: false, ignored: { gloss: [], syn: [], abbrev: [] } };
  s.glossaryTranslations = [
    { term: "Vertragsübersicht", en: "", sk: "", hi: "", fr: "", fixed: false, auto: true, isNew: true, foundAt: "8.11.2026", lexExample: "Die Vertragsübersicht zeigt alle Verträge." },
    { term: "Kundenstamm", en: "customer master", sk: "", hi: "", fr: "", fixed: false },
    { term: "Fixbegriff", en: "", sk: "", hi: "", fr: "", fixed: true } ];
  s.abbrevTranslations = [
    { term: "MO", de: "", en: "", sk: "", hi: "", fr: "", fixed: false, auto: true, isNew: true, lexExample: "Die MO prüft den Vertrag." },
    { term: "XYZ", de: "", en: "", sk: "", hi: "", fr: "", fixed: false, auto: true, isNew: true } ];
  s.synonyms = [];
  await load(s);

  // ===================== Glossar =====================
  nav("glossar"); await wait(50);
  check("Glossar-Tabelle mit Spalte „Bedeutung (Deutsch)“", Array.from(doc.querySelectorAll("#glossary-translations-table thead th")).map((t) => t.textContent).join("|") === "Begriff (DE)|Bedeutung (Deutsch)|Englisch|Slowakisch|Hindi|Französisch|Aktion");
  check("Knopf „KI-Vorschläge (Claude)“ in Glossar, Synonyme, Abkürzungen", ["gloss", "syn", "abbrev"].every((k) => /KI-Vorschläge \(Claude\)/.test($("lex-auto-" + k).querySelector("[data-lex-ai]").textContent)));
  await runAi("gloss");
  const gp = prompts.find((p) => p.includes("Vertragsübersicht"));
  check("Prompt nennt je Begriff nur die leeren Felder + Beispielsatz, keine fixierten Begriffe", !!gp && /- Kundenstamm \| leer: de, sk, hi, fr/.test(gp) && /- Vertragsübersicht \| leer: de, en, sk, hi, fr \| Beispiel: Die Vertragsübersicht/.test(gp) && !gp.includes("Fixbegriff"));
  s = await session();
  const vu = s.glossaryTranslations.find((e) => e.term === "Vertragsübersicht"), ks = s.glossaryTranslations.find((e) => e.term === "Kundenstamm"), fx = s.glossaryTranslations.find((e) => e.term === "Fixbegriff");
  check("Leere Felder ergänzt (Bedeutung + 4 Sprachen) und als KI-Vorschlag markiert", vu.de === "Erklärung Vertragsübersicht" && vu.fr === "FR Vertragsübersicht" && vu.lexAiFields.join() === "de,en,sk,hi,fr" && vu.isNew);
  check("Vorhandene Übersetzung nicht überschrieben (EN bleibt „customer master“)", ks.en === "customer master" && ks.sk === "SK Kundenstamm" && ks.lexAiFields.join() === "de,sk,hi,fr" && ks.isNew === true);
  check("Fixierter Begriff unberührt", fx.de === undefined && fx.en === "" && !fx.isNew);
  check("Liste „Neu erkannt / zu prüfen“ zeigt Erklärung und „KI-Vorschlag“", !!rowOf("gloss", "Kundenstamm") && rowOf("gloss", "Kundenstamm").textContent.includes("KI-Vorschlag: Bedeutung, SK, HI, FR") && rowOf("gloss", "Vertragsübersicht").textContent.includes("Erklärung Vertragsübersicht") && $("lex-auto-gloss").textContent.includes("Neu erkannt / zu prüfen"));
  check("Glossar-Tabelle zeigt die Bedeutung", Array.from(doc.querySelectorAll("#glossary-translations-tbody input[data-field='de']")).some((i) => i.value === "Erklärung Vertragsübersicht"));
  check("Hinweis nennt Anzahl ergänzter Felder", /9 Feld\(er\) in 2 Eintrag/.test(note("gloss")));
  fire(rowOf("gloss", "Kundenstamm").querySelector("[data-lex-reject]"), "click"); await wait(20);
  fire(rowOf("gloss", "Vertragsübersicht").querySelector("[data-lex-accept]"), "click"); await wait(20);
  s = await session();
  const ks2 = s.glossaryTranslations.find((e) => e.term === "Kundenstamm"), vu2 = s.glossaryTranslations.find((e) => e.term === "Vertragsübersicht");
  check("Verwerfen bei eigenem Eintrag: nur die KI-Felder geleert, Eintrag und EN bleiben", !!ks2 && ks2.en === "customer master" && ks2.sk === "" && ks2.de === "" && !ks2.isNew && !ks2.lexAiFields);
  check("Übernehmen: Werte bleiben, KI-Markierung weg", vu2.de === "Erklärung Vertragsübersicht" && !vu2.isNew && !vu2.lexAiFields && rows("gloss").length === 0);

  // ===================== Abkürzungen =====================
  nav("abkuerzungen"); await wait(30);
  await runAi("abbrev");
  s = await session();
  const mo = s.abbrevTranslations.find((e) => e.term === "MO"), xyz = s.abbrevTranslations.find((e) => e.term === "XYZ");
  check("Abkürzung MO: Bedeutung + Übersetzungen ergänzt", mo.de === "Erklärung MO" && mo.en === "EN MO" && mo.lexAiFields.length === 5);
  check("Unsichere Abkürzung (Claude lässt leer) bleibt offen", xyz.de === "" && !xyz.lexAiFields && /Bedeutung offen/.test(rowOf("abbrev", "XYZ").textContent));
  broken = true;
  await runAi("abbrev");
  check("Unlesbare Antwort: Hinweis statt Fehler, nichts verändert", /1 Antwort\(en\) nicht lesbar/.test(note("abbrev")) && (await session()).abbrevTranslations.find((e) => e.term === "XYZ").de === "");
  broken = false;

  // ===================== Synonyme =====================
  nav("synonyme"); await wait(30);
  await runAi("syn");
  const sp = prompts.find((p) => p.includes("WÖRTER:"));
  check("Synonym-Prompt enthält nur Wörter aus den Inhalten", !!sp && /Kündigung/.test(sp) && /Beendigung/.test(sp) && !/Erfinder|Kontrakt/.test(sp.split("WÖRTER:")[1]));
  s = await session();
  const kd = s.synonyms.find((e) => e.term === "Kündigung");
  check("Echte Synonym-Gruppe Kündigung = Beendigung angelegt (KI-Vorschlag, zu prüfen)", !!kd && kd.synonyms === "Beendigung" && kd.isNew && kd.lexAi && /beide meinen das Vertragsende/.test(kd.lexNote));
  check("Vorschläge mit Wörtern, die nicht in den Inhalten stehen, verworfen", !s.synonyms.some((e) => /Erfinder|Kontrakt/.test(e.term + e.synonyms)) && /2 Vorschlag\/Vorschläge verworfen/.test(note("syn")));
  check("Liste zeigt die Gruppe mit Begründung", rowOf("syn", "Kündigung") && rowOf("syn", "Kündigung").textContent.includes("Kündigung = Beendigung") && rowOf("syn", "Kündigung").textContent.includes("KI-Vorschlag"));
  await runAi("syn");
  s = await session();
  check("Zweiter Lauf: Gruppe nicht doppelt, Übersetzungen der Gruppe ergänzt", s.synonyms.filter((e) => e.term === "Kündigung").length === 1 && s.synonyms.find((e) => e.term === "Kündigung").en === "EN Kündigung");
  fire(rowOf("syn", "Kündigung").querySelector("[data-lex-reject]"), "click"); await wait(20);
  await runAi("syn");
  s = await session();
  check("Verworfene KI-Gruppe kommt nicht wieder", !s.synonyms.some((e) => e.term === "Kündigung") && s.lexAuto.ignored.syn.includes("kündigung"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
