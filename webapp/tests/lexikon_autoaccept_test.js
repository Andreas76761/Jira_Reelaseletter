// v2.189.0: Neue Abkürzungen, Glossar-Begriffe und Synonyme werden direkt übernommen; Bedeutung und Übersetzungen ergänzt
// Claude automatisch (nur für neu erkannte Einträge, je Eintrag einmal). Neuerungen bleiben sichtbar: „Zuletzt automatisch
// ergänzt“ mit „Entfernen“, „neu“ in der Tabelle, „+n“ in der Navigation bis das Register geöffnet wurde.
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

function fakeClaude(input) {
  const p = String(input);
  prompts.push(p);
  const out = {};
  (p.split("BEGRIFFE:\n")[1] || "").split("\n").forEach((l) => {
    const m = l.match(/^- ([^|(]+?)\s*(?:\(|\|)/);
    if (!m) return;
    const t = m[1].trim();
    out[t] = t === "XYZ" ? {} : { de: "Bedeutung " + t, en: "EN " + t, sk: "SK " + t, hi: "HI " + t, fr: "FR " + t };
  });
  return { text: JSON.stringify(out), truncated: false };
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
  const lexBadge = (v) => { const sp = doc.querySelector('.nav-item[data-view="' + v + '"] .nav-lexnew'); return sp ? sp.getAttribute("data-n") : ""; };
  const recentRows = (k) => Array.from(doc.querySelectorAll("#lex-auto-" + k + " [data-lex-recent-idx]"));
  const recentRow = (k, term) => recentRows(k).find((r) => r.querySelector("b").textContent === term);

  let s = await session();
  const ch = (title, text) => ({ title, level: 1, fullText: text, cleanText: text, markedText: text });
  s.final.manuals = [{ id: 1, filename: "Handbuch.docx", addedAt: "8.11.2026", pageCount: 2, design: null, chapters: [
    ch("1 Vertrag", "In der Vertragsübersicht prüft die Market Operation (MO) den Servicevertrag. Die XYZ-Nummer steht oben."),
    ch("2 Liste", "Die Vertragsübersicht zeigt den Service-Vertrag. Die MO gibt frei. Kennung XYZ beachten."),
    ch("3 Ende", "Über die Vertragsübersicht wird der Servicevertrag beendet.") ] }];
  s.glossaryTranslations = [{ term: "Altbegriff", en: "", sk: "", hi: "", fr: "", fixed: false }, { term: "Fixbegriff", en: "", sk: "", hi: "", fr: "", fixed: true }];
  s.abbrevTranslations = [{ term: "OLD", de: "", en: "", sk: "", hi: "", fr: "", fixed: false, auto: true, isNew: true, foundAt: "1.11.2026" }]; // offener Eintrag aus älterer Sitzung
  s.synonyms = [];
  delete s.lexAuto; // Standard-Einstellungen
  await load(s);
  await waitUntil(() => !!lexBadge("abkuerzungen") && !!lexBadge("glossar"), 6000);
  await wait(600);

  s = await session();
  const mo = s.abbrevTranslations.find((e) => e.term === "MO"), xyz = s.abbrevTranslations.find((e) => e.term === "XYZ"), old = s.abbrevTranslations.find((e) => e.term === "OLD");
  const vu = s.glossaryTranslations.find((e) => e.term === "Vertragsübersicht"), sv = s.synonyms.find((e) => /^service-?vertrag$/i.test(e.term));
  check("Standard: automatisch übernehmen + Claude ergänzt", s.lexAuto.autoAccept === true && s.lexAuto.autoAi === true);
  check("Abkürzung MO direkt übernommen (nicht mehr „zu prüfen“)", !!mo && !mo.isNew && mo.lexRecent && mo.de === "Market Operation");
  check("Claude hat Übersetzungen ergänzt, Bedeutung aus dem Text bleibt", mo.en === "EN MO" && mo.fr === "FR MO" && mo.lexAiDone.join() === "en,sk,hi,fr");
  check("Glossar-Begriff übernommen mit Bedeutung und Übersetzungen", !!vu && !vu.isNew && vu.de === "Bedeutung Vertragsübersicht" && vu.sk === "SK Vertragsübersicht" && vu.lexAiDone.length === 5);
  check("Synonym-Gruppe übernommen und übersetzt", !!sv && !sv.isNew && sv.en.startsWith("EN "));
  check("Unsicheres Kürzel trotzdem übernommen, Bedeutung bleibt offen", !!xyz && !xyz.isNew && xyz.de === "" && !!xyz.lexAiTried);
  check("Offener Eintrag aus älterer Sitzung ebenfalls übernommen", !!old && !old.isNew && old.en === "EN OLD");
  const allPrompts = prompts.join("\n");
  const alt = s.glossaryTranslations.find((e) => e.term === "Altbegriff"), fix = s.glossaryTranslations.find((e) => e.term === "Fixbegriff");
  check("v2.193: auch bestehende, noch offene Einträge übersetzt (als „von Claude“ vermerkt)", allPrompts.includes("- Altbegriff") && alt.de === "Bedeutung Altbegriff" && alt.en === "EN Altbegriff" && alt.lexAiDone.length === 5 && !!alt.lexRecent);
  check("Fixierte Einträge werden nicht übersetzt", !allPrompts.includes("Fixbegriff") && fix.en === "" && fix.de === undefined);
  check("Automatischer Lauf schlägt keine KI-Synonym-Gruppen vor (nur Füllen)", !allPrompts.includes("WÖRTER:"));
  check("Navigation zeigt die Neuerungen (+n)", /^\+\d+$/.test(lexBadge("abkuerzungen")) && /^\+\d+$/.test(lexBadge("glossar")) && /^\+\d+$/.test(lexBadge("synonyme")));

  nav("abkuerzungen"); await wait(30);
  check("Register: keine Prüfliste, Hinweis „direkt übernommen“", !$("lex-auto-abbrev").querySelector("[data-lex-idx]") && /direkt übernommen/.test($("lex-auto-abbrev").textContent));
  check("Liste „Zuletzt automatisch ergänzt“ mit MO, „neu“ und „von Claude“", !!recentRow("abbrev", "MO") && recentRow("abbrev", "MO").textContent.includes("neu") && recentRow("abbrev", "MO").textContent.includes("von Claude: EN, SK, HI, FR") && $("lex-auto-abbrev").textContent.includes("Zuletzt automatisch ergänzt"));
  check("Tabelle markiert die ergänzten Einträge mit „neu“", Array.from(doc.querySelectorAll("#abbrev-translations-tbody tr.lex-row-new")).some((r) => r.querySelector("input").value === "MO"));
  await wait(500);
  check("Nach dem Öffnen: „+n“ bei Abkürzungen weg, Glossar weiter markiert", lexBadge("abkuerzungen") === "" && /^\+\d+$/.test(lexBadge("glossar")));

  // Zurücknehmen
  const nPrompts = prompts.length;
  fire(recentRow("abbrev", "XYZ").querySelector("[data-lex-recent-remove]"), "click"); await wait(30);
  fire($("lex-auto-abbrev").querySelector("[data-lex-run]"), "click"); await wait(300);
  s = await session();
  check("„Entfernen“: automatisch ergänztes Kürzel entfernt und nicht erneut aufgenommen", !s.abbrevTranslations.some((e) => e.term === "XYZ") && s.lexAuto.ignored.abbrev.includes("xyz"));
  check("Erneute Prüfung fragt Claude nicht erneut nach schon gefragten Einträgen", prompts.length === nPrompts);
  fire($("lex-auto-abbrev").querySelector("[data-lex-recent-clear]"), "click"); await wait(20);
  check("„Liste leeren“: Einträge bleiben, Liste weg", !recentRows("abbrev").length && (await session()).abbrevTranslations.some((e) => e.term === "MO"));

  // Prüfmodus wieder einschalten
  const acc = $("lex-auto-abbrev").querySelector("[data-lex-autoaccept]"); acc.checked = false; fire(acc, "change"); await wait(20);
  s = await session();
  s.final.manuals[0].chapters.push(ch("4 Neu", "Das Zahlungsziel (ZZ) gilt. ZZ beachten."), ch("5 Neu", "Das ZZ ist fix."));
  await load(s); await wait(2200);
  s = await session();
  const zz = s.abbrevTranslations.find((e) => e.term === "ZZ");
  check("Direkt übernehmen aus: neue Abkürzung bleibt „zu prüfen“ (mit Claude-Übersetzungen)", s.lexAuto.autoAccept === false && !!zz && zz.isNew === true && zz.en === "EN ZZ" && zz.lexAiFields.join() === "en,sk,hi,fr");

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
