// v2.145.0 CROSS_X als Chat mit Zugriff auf alle Register: Wissensbasis aus Review, AGENT, Rovo, Texten, RAG, Bildern,
// Tabellen, Begriffen, Gliederung, Protokoll; Antworten nur belegt (Chat-Prompt), Quellen nach jeder Antwort mit
// Sprung ins Register, ungueltige Belege entfernt, unbelegte Aussagen markiert, Folgefragen mit Verlauf, Enter sendet.
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
let mode = "answer";
const idOf = (p, re) => { const m = p.match(new RegExp("\\[#(\\d+)\\] \\([^)]*\\) " + re)); return m ? m[1] : "0"; };
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (mode === "noinfo") return { text: "Dazu finde ich in den Registern keine Information." };
  if (mode === "nocite") return { text: "Storno kostet immer 50 Euro und dauert drei Tage bis zur Bestätigung." };
  const r = idOf(p, "Review „Handbuch“ v1\\.0 › 1 Storno"), b = idOf(p, "Bild › screen\\.png"), ro = idOf(p, "Rovo › Storno");
  return { text: "Verträge werden über die Funktion Storno beendet [#" + r + "]. Die Stornomaske zeigt die Bestätigung [#" + b + "].\n- Laut Rovo geht es über das Menü Verträge › Storno [#" + ro + "] (intern).\n- Zusätzlich gibt es eine Gebühr von fünfzig Euro für jede Stornierung im System. Siehe auch [#999]." };
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
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const cnt = (k) => doc.querySelector('[data-cx-src-count="' + k + '"]').textContent;
  const answers = () => Array.from(doc.querySelectorAll("[data-cx-answer]"));
  async function ask(q, viaEnter) {
    const n = answers().length;
    $("crossx-question").value = q;
    if (viaEnter) $("crossx-question").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else fire($("crossx-ask-btn"), "click");
    await waitUntil(() => answers().length === n + 1, 5000);
    return answers()[n];
  }

  // Sitzung mit Daten in vielen Registern
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const s = JSON.parse(savedFiles[0].data);
  s.rovoEntries = [{ id: 1, when: "", chatText: "Wie storniere ich?", answerText: "Stornierung über das Menü Verträge › Storno.", chapter: "Storno", subchapter: "", labels: ["ROVO"], jiraKeys: [], jiraVisible: false }];
  s.uploadedImages = [{ id: 5, filename: "screen.png", dataUrl: PNG, description: "Stornomaske", chapter: "Storno", ocrText: "Storno bestätigen", sourceFile: "screens.docx", imageNumber: 2 }];
  s.rovoTables = [{ sourceFile: "preise.docx", tableNumber: 1, chapter: "Preise", rows: [["Paket", "Preis"], ["Basis", "10 €"]] }];
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Freigegeben", source: "Upload", lang: "DE", chapters: [{ title: "1 Storno", level: 1, text: "Verträge werden über die Funktion Storno beendet. \u0001Intern: Rückfrage beim Fachbereich\u0002" }], ph: {}, checks: {}, steps: {}, history: [] }], activeId: 1 };
  s.agent = { knowledge: { at: "x", items: [{ id: 1, title: "Storno", type: "Anleitung", summary: "Storno beendet Verträge.", domain: "Verträge", role: "Retail", market: "", lang: "DE", sources: ["Handbuch › 1 Storno"], blockIds: [] }] }, status: {} };
  s.manualChapters = { Storno: { de: "Benutzerhandbuch-Text: Storno im Kundenportal." } };
  s.ragLibrary = [{ title: "Storno-Regeln", text: "Storno nur innerhalb von 14 Tagen." }];
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("crossx"); await wait(30);

  check("Quellen aller Register in der Auswahl (19)", doc.querySelectorAll("[data-cx-src]").length === 19);
  check("Wissensbasis: Review, AGENT, Rovo, Texte, RAG, Bilder, Tabellen gefüllt", ["review", "agent", "rovo", "texts", "rag", "images", "tables"].every((k) => Number(cnt(k)) > 0) && Number(cnt("review")) === 2);
  check("Chat-Bereich mit Hinweis auf Belegpflicht", doc.querySelector("#crossx-answers").classList.contains("crossx-chat") && $("crossx-ask-btn").textContent.trim() === "Senden");

  // Frage
  const a1 = await ask("Wie storniere ich einen Vertrag?");
  const p1 = prompts[prompts.length - 1];
  check("Chat-Prompt: Regeln (nur Wissensbasis, Belege, keine Information), Frage am Ende", p1.includes("AUSSCHLIESSLICH Informationen aus der WISSENSBASIS") && p1.includes("Dazu finde ich in den Registern keine Information.") && p1.endsWith("FRAGE: Wie storniere ich einen Vertrag?"));
  check("Wissensbasis im Prompt aus mehreren Registern", ["(Review) Review „Handbuch“ v1.0 › 1 Storno", "(Bild) Bild › screen.png", "(Rovo, INTERN) Rovo › Storno", "(AGENT) AGENT Wissensobjekt › Storno", "(RAG) RAG › Storno-Regeln", "(Text) Benutzerhandbuch-Kapitel › Storno"].every((x) => p1.includes(x)));
  const srcs = Array.from(a1.querySelectorAll(".crossx-sources details"));
  check("Quellen nach der Antwort: Review, Bild, Rovo (intern) – je mit Sprung ins Register", srcs.length === 3 && a1.querySelector(".crossx-sources b").textContent === "Quellen (3):" &&
    srcs.map((d) => d.querySelector("[data-cx-open]").textContent).join("|") === "→ VARIANTE|→ Bilder|→ Rovo Knowledge" && srcs[2].textContent.includes("INTERN"));
  check("Ungültige Quellennummer entfernt und gemeldet", a1.querySelector(".crossx-answer-body").textContent.includes("[#?]") && !a1.textContent.includes("[#999]") && a1.querySelector(".crossx-warn").textContent.includes("1 ungültige Quellenangabe(n) entfernt"));
  check("Unbelegte Aussage markiert und gezählt", !!a1.querySelector(".crossx-unsourced") && a1.querySelector(".crossx-unsourced").textContent.startsWith("Zusätzlich gibt es eine Gebühr") && a1.querySelector(".crossx-warn").textContent.includes("1 Aussage(n) ohne Quellenbeleg"));
  srcs[0].querySelector("[data-cx-open]").click(); await wait(20);
  check("„→ VARIANTE“ öffnet das Register", !doc.querySelector('[data-view-panel="variante"]').hidden);
  nav("crossx"); await wait(20);

  // Folgefrage per Enter
  const a2 = await ask("Und wer ist dafür zuständig?", true);
  const p2 = prompts[prompts.length - 1];
  check("Folgefrage per Enter, Verlauf im Prompt (ohne Belegnummern)", p2.includes("BISHERIGER VERLAUF:\nFrage: Wie storniere ich einen Vertrag?\nAntwort: Verträge werden über die Funktion Storno beendet .") && p2.endsWith("FRAGE: Und wer ist dafür zuständig?") && $("crossx-question").value === "");
  check("Chat-Reihenfolge: älteste Frage oben", answers()[0].querySelector(".crossx-answer-q").textContent === "Wie storniere ich einen Vertrag?" && a2 === answers()[1]);

  mode = "noinfo";
  const a3 = await ask("Wie hoch ist der Umsatz 2030?");
  check("Keine Information: ehrliche Antwort ohne Warnung", a3.querySelector(".crossx-answer-body").textContent.includes("keine Information") && !a3.querySelector(".crossx-warn"));
  mode = "nocite";
  const a4 = await ask("Was kostet Storno?");
  check("Antwort ganz ohne Beleg: deutliche Warnung", a4.querySelector(".crossx-warn").textContent.includes("Antwort ohne Quellenbeleg – nicht verwenden."));

  // Ohne Intern
  $("crossx-include-intern").checked = false; fire($("crossx-include-intern"), "change");
  mode = "answer";
  await ask("Wie storniere ich?");
  const p5 = prompts[prompts.length - 1];
  check("Ohne Intern: keine Rovo-/Protokoll-Einträge, interner Vermerk im Review entfernt", !p5.includes("(Rovo, INTERN)") && !p5.includes("Protokoll") && !p5.includes("Rückfrage beim Fachbereich") && p5.includes("Review „Handbuch“ v1.0 › 1 Storno"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
