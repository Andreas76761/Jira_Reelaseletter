// v2.134.0 Register CROSS_X: Wissensbasis aus Dokumenten und internen Informationen, Cross-Reference-Regeln
// ueber Kapitel und Rollen (Kapitelverweise, ausgeblendete Ziele, Nummernaenderung, Rollen-Verweise ohne Handbuch,
// Thema in keiner Rolle, unbekannte Rolle, Ticket-Rolle, faellige Mitteilung), Wissensagent mit Quellen,
// KI-Cross-Check, Intern-Schalter, interner Pruefbericht, Sitzung.
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
let aiMode = "ok";
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  const ids = [...p.matchAll(/\[#(\d+)\] \(([^)]*)\) (.*)/g)].map((m) => ({ id: m[1], src: m[2], label: m[3] }));
  const ch = ids.find((x) => x.label.includes("Kapitel 1: Verträge")) || ids[0] || { id: "1" };
  const note = ids.find((x) => x.label.startsWith("Mitteilung")) || ch;
  return { text: "Die Freigabe ist in Kapitel 1 beschrieben [#" + ch.id + "]; intern ist ein Umbau geplant [#" + note.id + "] (intern). Unbekannt [#9999]." };
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

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length > 0, 5000); return JSON.parse(savedFiles[0].data); }
  async function load(ses) {
    const si = $("session-import-input");
    Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
    fire(si, "change"); await wait(80);
    if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
    await wait(400);
  }
  // Tickets
  nav("import");
  const input = $("file-input");
  Object.defineProperty(input, "files", { value: [new win.File(['<?xml version="1.0"?><rss><channel><item><key>ONESCM-2</key><summary>Freigabe zentral</summary><status>Fertig</status><labels><label>HQ</label></labels></item></channel></rss>'], "t.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("stat-tickets").textContent === "1", 5000);
  let ses = await session();
  const T1 = "Verträge anlegen. Siehe Kapitel 3 für Finanzen.\nVgl. Kapitel 9.\n[Rolle: Händler] Nur Händler.\nGemäß ONESCM-2 freigeben.";
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL",
    improvements: { "Kapitel 2: Kunden": ["Feld Kundennummer erklären"] }, improvementStatus: {},
    reviews: [{ text: "Prüfbericht: Kapitel 3 unvollständig.", at: "1.11.2026, 11:00:00", by: "Rita" }],
    notes: [{ id: 1, category: "Ideenspeicher", title: "Neue Finanzmaske", text: "Finanzmaske wird 2027 neu gebaut.", intervalDays: 7, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", history: [] }],
    chapters: [
      { title: "Kapitel 1: Verträge", level: 1, text: T1, markedText: T1 + "\n\u0001Interner Vermerk: Freigabe-Prozess wird umgebaut\u0002", screenIds: [] },
      { title: "Kapitel 2: Kunden", level: 1, text: "Kunden pflegen. Siehe Kapitel 1 und siehe Kapitel 5.", screenIds: [] },
      { title: "Kapitel 3: Finanzen", level: 1, text: "Abrechnung prüfen, siehe ONESCM-77.", screenIds: [] },
      { title: "Kapitel 4: Archiv", level: 1, text: "Alte Daten.", screenIds: [] },
      { title: "Kapitel 5: Hilfe", level: 1, text: "[Rolle: MO] Nur MO-Hilfe.", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  ses.variante = { baseVersionId: 1, baseLang: "DE", domains: [{ name: "Verträge", subs: [] }, { name: "Finanzen", subs: [] }],
    chapterMap: { "Kapitel 1: Verträge": { dom: "Verträge" }, "Kapitel 3: Finanzen": { dom: "Finanzen" } },
    roles: ["Markt", "MO", "Retail", "IT", "HQ"], domOff: { "Verträge": { Markt: true, IT: true, HQ: true }, Finanzen: { Retail: true } }, subOff: {},
    chOverride: { "Kapitel 4: Archiv": { Markt: false, MO: false, Retail: false, IT: false, HQ: false } },
    variants: [{ id: 1, name: "Basis – Retail – DE", role: "Retail", lang: "DE", baseVersionId: 1, standId: null }], opts: { renumber: true, refInline: true, refChapter: true } };
  await load(ses);

  const navs = Array.from(doc.querySelectorAll(".nav-item")).map((b) => b.getAttribute("data-view"));
  check("Nav: CROSS_X nach Mitteilungen", navs.indexOf("crossx") === navs.indexOf("mitteilungen") + 1);
  nav("crossx");
  const cnt = (k) => doc.querySelector('[data-cx-src-count="' + k + '"]').textContent;
  check("Wissensbasis: Quellen mit Anzahl (Kapitel 5, Matrix 5, Variante 1, Mitteilung 1, ROVO 1, Prüfbericht 1, Jira 1)",
    cnt("stands") === "5" && cnt("matrix") === "5" && cnt("variants") === "1" && cnt("notes") === "1" && cnt("improvements") === "1" && cnt("reviews") === "1" && cnt("tickets") === "1" && Number(cnt("rolenav")) > 0 && cnt("glossary") === "0");
  check("Zusammenfassung mit internen Einträgen und Basis (v2.145: + Protokoll, intern)", /^Wissensbasis: \d+ Einträge \(5 intern\), ca\. \d+ Tsd\. Zeichen · Basis „Basis“$/.test($("crossx-kb-summary").textContent));
  fire($("crossx-kb-btn"), "click");
  const kbTxt = $("crossx-kb-list").textContent;
  check("Wissensbasis-Liste: interner Vermerk sichtbar, Matrix mit Rollen, Variante mit Inhaltsverzeichnis", kbTxt.includes("⟦INTERN: Interner Vermerk: Freigabe-Prozess wird umgebaut⟧") && kbTxt.includes("Aktiv in Rollen: MO, Retail") && kbTxt.includes("(ausgelassen: Finanzen → Verweis auf Markt, MO, IT, HQ)") && kbTxt.includes("INTERN"));

  // ===================== Regeln =====================
  fire($("crossx-check-btn"), "click");
  const rows = () => Array.from(doc.querySelectorAll("#crossx-findings-tbody tr")).map((r) => Array.from(r.children).map((c) => c.textContent).join(" | "));
  const has = (re) => rows().some((r) => re.test(r));
  check("Zusammenfassung: 2 Fehler, 7 Warnungen, 4 Hinweise", $("crossx-check-summary").textContent === "2 Fehler, 7 Warnung(en), 4 Hinweis(e).");
  check("Fehler: Verweis ins Leere (Kapitel 9)", has(/^Fehler \| Kapitelverweis ins Leere \| Kapitel 1: Verträge \| – \| „Vgl\. Kapitel 9“ – im Basisdokument gibt es kein Kapitel 9\.$/));
  check("Fehler: unbekannte Rolle 'Händler'", has(/^Fehler \| Unbekannte Rolle in Bedingung \| Kapitel 1: Verträge \| Händler \|/));
  check("Warnung: Verweis auf für Retail ausgeblendetes Kapitel 3", has(/Verweis auf ausgeblendetes Kapitel \| Kapitel 1: Verträge \| Retail \| In der Variante für Retail verweist das Kapitel auf Kapitel 3 \(„Kapitel 3: Finanzen“\)/));
  check("Warnung: Thema in keiner Rolle (Archiv)", has(/Thema in keiner Rolle \| Kapitel 4: Archiv/));
  check("Warnung (intern): Ticket-Rolle HQ passt nicht zu Kapitel 1 (MO, Retail)", has(/Ticket-Rolle passt nicht INTERN \| Kapitel 1: Verträge \| HQ \| ONESCM-2 betrifft HQ, das Kapitel ist aber nur in MO, Retail aktiv\./));
  check("Warnungen: Rollen-Verweise ohne Handbuch (Markt, MO, IT, HQ)", ["Markt", "MO", "IT", "HQ"].every((q) => has(new RegExp("Rollen-Verweis ohne Handbuch \\| Finanzen \\| Retail \\| .*auf " + q + " – es gibt aber keine " + q + "-Variante in DE"))));
  check("Hinweis: Kapitelnummer ändert sich (5 → 3 in Retail)", has(/Kapitelnummer ändert sich \| Kapitel 2: Kunden \| Retail \| In der Variante für Retail wird Kapitel 5 zu 3/));
  check("Hinweis: Kapitel ohne Inhalt für Retail (nur MO-Absatz)", has(/Kapitel ohne Inhalt für Rolle \| Kapitel 5: Hilfe \| Retail/));
  check("Hinweise (intern): Ticket nicht geladen, fällige Mitteilung", has(/Ticket nicht geladen INTERN \| Kapitel 3: Finanzen \| – \| ONESCM-77/) && has(/Fällige interne Mitteilung INTERN .*„Neue Finanzmaske“ am Basisdokument „Basis“/));
  check("Gültiger Verweis (Kapitel 1 aus Kapitel 2) ohne Befund", !has(/Kapitel 2: Kunden .* Kapitel 1 /));
  $("crossx-sev-filter").value = "Fehler"; fire($("crossx-sev-filter"), "change");
  check("Filter: nur Fehler", rows().length === 2 && $("crossx-check-summary").textContent.includes("2 angezeigt"));
  $("crossx-sev-filter").value = ""; fire($("crossx-sev-filter"), "change");

  // ===================== Wissensagent =====================
  $("crossx-question").value = "Welche internen Pläne gibt es zur Finanzmaske?";
  fire($("crossx-ask-btn"), "click");
  await waitUntil(() => $("crossx-agent-status").textContent.startsWith("Fertig"), 5000);
  const p0 = prompts[0];
  check("Chat-Prompt (v2.145): nur Wissensbasis, Belegpflicht, Wissensbasis mit [#n]/INTERN, Frage", p0.includes("Chat-Assistent") && p0.includes("AUSSCHLIESSLICH Informationen aus der WISSENSBASIS") && p0.includes("WISSENSBASIS (") && /\[#\d+\] \(Mitteilung, INTERN\) Mitteilung › Stand „Basis“ › Ideenspeicher: Neue Finanzmaske/.test(p0) && p0.endsWith("FRAGE: Welche internen Pläne gibt es zur Finanzmaske?"));
  const ans = doc.querySelector("[data-cx-answer]");
  check("Antwort mit zitierten Quellen (ungültige ignoriert), interne Quelle markiert", ans.querySelector(".crossx-answer-q").textContent === "Welche internen Pläne gibt es zur Finanzmaske?" && ans.querySelectorAll(".crossx-sources details").length === 2 &&
    ans.querySelector(".crossx-sources").textContent.includes("INTERN") && $("crossx-agent-status").textContent.endsWith("2 Quelle(n) zitiert.") && $("crossx-question").value === "");
  fire($("crossx-ai-check-btn"), "click");
  await waitUntil(() => prompts.length === 2 && $("crossx-agent-status").textContent.startsWith("Fertig"), 5000);
  check("KI-Cross-Check: Regel-Befunde und Wissensbasis im Prompt", prompts[1].includes("Cross-Reference-Check") && prompts[1].includes("REGEL-BEFUNDE (automatisch, 13)") && prompts[1].includes("[Fehler] Kapitelverweis ins Leere") && prompts[1].includes("Matrix ›"));
  check("Chat-Verlauf: älteste zuerst (KI-Cross-Check unten)", doc.querySelectorAll("[data-cx-answer]").length === 2 && doc.querySelectorAll("[data-cx-answer] .crossx-answer-q")[1].textContent === "KI-Cross-Check über Kapitel & Rollen");

  // ===================== Ohne interne Informationen =====================
  $("crossx-include-intern").checked = false; fire($("crossx-include-intern"), "change");
  check("Ohne Intern: keine internen Quellen, Vermerke entfernt", cnt("notes") === "0" && cnt("tickets") === "0" && cnt("reviews") === "0" && !$("crossx-kb-list").textContent.includes("⟦INTERN") && !$("crossx-kb-list").textContent.includes("Interner Vermerk"));
  check("Ohne Intern: interne Regel-Befunde ausgeblendet (2 / 6 / 2)", $("crossx-check-summary").textContent === "2 Fehler, 6 Warnung(en), 2 Hinweis(e).");
  $("crossx-question").value = "Was gilt für Verträge?";
  fire($("crossx-ask-btn"), "click");
  await waitUntil(() => prompts.length === 3 && doc.querySelectorAll("[data-cx-answer]").length === 3, 5000);
  check("Ohne Intern: Prompt ohne interne Einträge", !prompts[2].includes("INTERN)") && !prompts[2].includes("Interner Vermerk") && !prompts[2].includes("Mitteilung ›"));
  $("crossx-include-intern").checked = true; fire($("crossx-include-intern"), "change");

  // ===================== Bericht + Sitzung =====================
  savedFiles.length = 0;
  fire($("crossx-report-md-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = savedFiles[0] ? savedFiles[0].data : "";
  check("Interner Prüfbericht (Markdown): Kennzeichnung, Befunde, Verlauf", /^CROSS_X_Pruefbericht_INTERN_.*\.md$/.test(savedFiles[0].filename) && md.startsWith("# CROSS_X – Interner Prüfbericht") && md.includes("> INTERN – enthält interne Informationen") &&
    md.includes("## Regel-Befunde (13)") && md.includes("| Fehler | Kapitelverweis ins Leere |") && md.includes("## Wissensagent (3)") && md.includes("### Welche internen Pläne gibt es zur Finanzmaske?"));
  fire($("crossx-report-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 2, 5000);
  const dx = savedFiles[1] ? await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[1].data.arrayBuffer()))).file("word/document.xml").async("string") : "";
  check("Interner Prüfbericht (Word)", savedFiles[1].filename.endsWith(".docx") && dx.includes("INTERN") && dx.includes("Kapitelverweis ins Leere"));
  doc.querySelector('[data-cx-src="tickets"]').checked = false; fire(doc.querySelector('[data-cx-src="tickets"]'), "change");
  doc.querySelector('[data-cx-stand="1"]').checked = false; fire(doc.querySelector('[data-cx-stand="1"]'), "change");
  check("Quelle/Stand abwählen wirkt", cnt("tickets") === "0" && cnt("stands") === "0");
  ses = await session();
  check("Sitzung: Verlauf, Quellen, Stände", ses.crossx.history.length === 3 && ses.crossx.sources.tickets === false && JSON.stringify(ses.crossx.standIds) === "[]");
  await load(ses);
  nav("crossx");
  check("Nach Laden: Verlauf und Auswahl wiederhergestellt", doc.querySelectorAll("[data-cx-answer]").length === 3 && !doc.querySelector('[data-cx-src="tickets"]').checked && !doc.querySelector('[data-cx-stand="1"]').checked);
  fire($("crossx-clear-btn"), "click"); await wait(40); fire($("confirm-modal-ok-btn"), "click"); await wait(200);
  check("Verlauf leeren", doc.querySelectorAll("[data-cx-answer]").length === 0);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE CROSS_X-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
