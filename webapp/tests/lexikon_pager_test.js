// v2.193.0: Blätterfunktion in Glossar, Synonyme, Abkürzungen (Tabellen, „Neu erkannt / zu prüfen“, „Zuletzt automatisch
// ergänzt“): 25/50/100/alle je Seite, erste/vorherige/nächste/letzte Seite, Aktionen wirken auf den richtigen Eintrag,
// neu angelegter Eintrag springt auf die letzte Seite.
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

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
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
  const terms = (tb) => Array.from(doc.querySelectorAll("#" + tb + " tr")).map((r) => { const i = r.querySelector("input[data-field='term']"); return i ? i.value : r.children[0].textContent.replace(/\s*(Fixiert|neu)\s*$/g, ""); });
  const pager = (id) => doc.querySelector("#" + id + " .lex-pager");
  const info = (id) => pager(id) ? pager(id).querySelector("[data-pager-info]").textContent + " · " + pager(id).querySelector("[data-pager-page]").textContent : "";
  const go = (id, g) => fire(pager(id).querySelector('[data-pager-go="' + g + '"]'), "click");
  const pad = (n) => String(n).padStart(3, "0");

  let s = await session();
  s.lexAuto = { enabled: false, autoAccept: false, autoAi: false };
  s.glossaryTranslations = Array.from({ length: 60 }, (_, i) => ({ term: "Begriff " + pad(i + 1), en: "term " + (i + 1), sk: "", hi: "", fr: "", fixed: false }));
  s.synonyms = Array.from({ length: 10 }, (_, i) => ({ term: "Haupt " + (i + 1), synonyms: "Neben " + (i + 1), en: "x", sk: "", hi: "", fr: "", fixed: false }));
  s.abbrevTranslations = Array.from({ length: 30 }, (_, i) => ({ term: "AB" + pad(i + 1), de: "Bedeutung " + (i + 1), en: "", sk: "", hi: "", fr: "", fixed: false, lexRecent: "8.11.2026, 10:" + pad(i).slice(1), lexAiDone: ["en"] }));
  await load(s);

  nav("glossar"); await wait(50);
  check("Glossar: Seite 1 zeigt 25 von 60 Einträgen", terms("glossary-translations-tbody").length === 25 && terms("glossary-translations-tbody")[0] === "Begriff 001" && info("term-pager-glossaryTranslations") === "Einträge 1–25 von 60 · Seite 1 von 3");
  check("Erste/vorherige Seite auf Seite 1 deaktiviert", pager("term-pager-glossaryTranslations").querySelector('[data-pager-go="prev"]').disabled && !pager("term-pager-glossaryTranslations").querySelector('[data-pager-go="next"]').disabled);
  go("term-pager-glossaryTranslations", "next"); await wait(10);
  check("Nächste Seite: Einträge 26–50", terms("glossary-translations-tbody")[0] === "Begriff 026" && info("term-pager-glossaryTranslations") === "Einträge 26–50 von 60 · Seite 2 von 3");
  go("term-pager-glossaryTranslations", "last"); await wait(10);
  check("Letzte Seite: Einträge 51–60", terms("glossary-translations-tbody").length === 10 && terms("glossary-translations-tbody")[9] === "Begriff 060" && pager("term-pager-glossaryTranslations").querySelector('[data-pager-go="next"]').disabled);
  go("term-pager-glossaryTranslations", "prev"); await wait(10);
  // Aktion auf Seite 2 trifft den richtigen Eintrag
  const row30 = Array.from($("glossary-translations-tbody").querySelectorAll("tr")).find((r) => r.querySelector("input[data-field='term']").value === "Begriff 030");
  fire(row30.querySelector('[data-action="delete"]'), "click"); await wait(10);
  s = await session();
  check("Löschen auf Seite 2 entfernt genau den gewählten Eintrag, Seite bleibt", s.glossaryTranslations.length === 59 && !s.glossaryTranslations.some((e) => e.term === "Begriff 030") && info("term-pager-glossaryTranslations") === "Einträge 26–50 von 59 · Seite 2 von 3");
  const in31 = Array.from($("glossary-translations-tbody").querySelectorAll("input[data-field='en']")).find((i) => i.closest("tr").querySelector("input[data-field='term']").value === "Begriff 031");
  in31.value = "geändert 31"; fire(in31, "change"); await wait(10);
  check("Bearbeiten auf Seite 2 ändert den richtigen Eintrag", (await session()).glossaryTranslations.find((e) => e.term === "Begriff 031").en === "geändert 31");
  const sizeSel = pager("term-pager-glossaryTranslations").querySelector("[data-pager-size]");
  sizeSel.value = "50"; fire(sizeSel, "change"); await wait(10);
  check("50 je Seite: erster sichtbarer Eintrag bleibt sichtbar (Seite 1 von 2)", terms("glossary-translations-tbody").length === 50 && info("term-pager-glossaryTranslations") === "Einträge 1–50 von 59 · Seite 1 von 2");
  const sizeSel2 = pager("term-pager-glossaryTranslations").querySelector("[data-pager-size]");
  sizeSel2.value = "0"; fire(sizeSel2, "change"); await wait(10);
  check("„alle“: alle 59 Einträge auf einer Seite", terms("glossary-translations-tbody").length === 59 && info("term-pager-glossaryTranslations") === "Einträge 1–59 von 59 · Seite 1 von 1");
  const sizeSel3 = pager("term-pager-glossaryTranslations").querySelector("[data-pager-size]");
  sizeSel3.value = "25"; fire(sizeSel3, "change"); await wait(10);
  $("glossary-translations-new-term").value = "Zuletzt angelegt"; $("glossary-translations-new-en").value = "last";
  fire($("glossary-translations-add-btn"), "click"); await wait(10);
  check("Neu angelegter Eintrag: Sprung auf die letzte Seite, Eintrag sichtbar", terms("glossary-translations-tbody").includes("Zuletzt angelegt") && /Seite 3 von 3/.test(info("term-pager-glossaryTranslations")));

  nav("synonyme"); await wait(30);
  check("Synonyme mit 10 Einträgen: keine Blätterleiste", terms("synonyms-tbody").length === 10 && !pager("term-pager-synonyms"));

  nav("abkuerzungen"); await wait(30);
  check("Abkürzungen: Tabelle blättert (25 von 30)", terms("abbrev-translations-tbody").length === 25 && /Einträge 1–25 von 30/.test(info("term-pager-abbrevTranslations")));
  const rec = () => Array.from(doc.querySelectorAll("#lex-auto-abbrev [data-lex-recent-idx] td:first-child b")).map((b) => b.textContent);
  check("„Zuletzt automatisch ergänzt“ blättert (neueste zuerst, 25 von 30)", rec().length === 25 && rec()[0] === "AB030" && !!doc.querySelector("#lex-auto-abbrev .lex-pager"));
  fire(doc.querySelector('#lex-auto-abbrev .lex-pager [data-pager-go="next"]'), "click"); await wait(10);
  check("Nächste Seite der Liste: die übrigen 5", rec().length === 5 && rec()[4] === "AB001");
  fire(doc.querySelectorAll("#lex-auto-abbrev [data-lex-recent-remove]")[4], "click"); await wait(10);
  s = await session();
  check("„Entfernen“ auf Seite 2 nimmt den richtigen Eintrag zurück", s.abbrevTranslations.find((e) => e.term === "AB001").en === "" && !s.abbrevTranslations.find((e) => e.term === "AB001").lexRecent && !!s.abbrevTranslations.find((e) => e.term === "AB002").lexRecent);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
