// v2.154.0 Navigation: Gruppen Input/Operation/Output (einklappbar, Burger-Menue), Register nach den 9 Stufen
// QUELLEN → EXTRAKTION → NORMALISIERUNG → TRACEABILITY → VALIDIERUNG → GENERIERUNG → E2E-QA → TESTING → DOCUMENTATION,
// Anzahl Eintraege je Register, Label "Neu", Workflow-Leiste mit Stand oben in jedem Register.
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode; window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const STAGES = [
  ["Quellen", ["import", "dateiverwaltung", "rovoknowledge", "editor", "bilder", "tabellen"]],
  ["Extraktion", ["verarbeitung", "rovosummary", "massenverarbeitung", "listenauswahl"]],
  ["Normalisierung", ["gliederung", "glossar", "synonyme", "abkuerzungen"]],
  ["Traceability", ["ticketgraph", "trend", "mitteilungen"]],
  ["Validierung", ["crossx", "agent"]],
  ["Generierung", ["releaseletter", "benutzerhandbuch", "prozessbild", "clickanweisung", "edito", "unterkapitel", "bildband"]],
  ["E2E-QA", ["final", "variante"]],
  ["Testing", ["dataquality", "ergebnisse"]],
  ["Documentation", ["output-md", "output-pdf", "infobox"]]];

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const count = (v) => { const c = doc.querySelector('[data-nav-count="' + v + '"]'); return c ? c.getAttribute("data-n") : null; };
  const visStrip = () => doc.querySelector(".view-panel[data-view-panel]:not([hidden]) > .flow-strip");

  const groups = Array.from(doc.querySelectorAll("[data-nav-group-btn]")).map((b) => b.getAttribute("data-nav-group-btn"));
  check("Gruppen in der Reihenfolge Input, Operation, Output", JSON.stringify(groups) === '["Input","Operation","Output"]');
  const stages = Array.from(doc.querySelectorAll(".nav-stage")).map((s) => s.textContent.replace(/[\d/\s]+$/, "").trim());
  check("9 Stufen nummeriert in der vorgegebenen Reihenfolge", JSON.stringify(stages) === JSON.stringify(STAGES.map((s, i) => (i + 1) + s[0])));
  const order = Array.from(doc.querySelectorAll("#nav-list .nav-item")).map((b) => b.getAttribute("data-view"));
  const expected = ["dashboard"].concat(...STAGES.map((s) => s[1]), ["einstellungen"]);
  check("Register nach Stufen geordnet (Dashboard oben, Einstellungen unten), keines verloren", JSON.stringify(order) === JSON.stringify(expected));
  check("Bisherige Zähler bleiben (Änderungen, Listen, fällige Mitteilungen)", !!$("nav-badge-changes") && !!$("nav-badge-lists") && !!$("nav-badge-notes"));
  const news = Array.from(doc.querySelectorAll(".nav-new")).map((n) => n.closest(".nav-item").getAttribute("data-view"));
  check("Eintragstext bleibt der reine Registername (Zahl und „Neu“ nur per CSS)", doc.querySelector('.nav-item[data-view="bilder"]').textContent.trim() === "Bilder" && doc.querySelector('.nav-item[data-view="edito"]').textContent.trim() === "Editor");
  check("Label „Neu“ mit Hinweis an neuen Funktionen (Bilder/OpenCV, VARIANTE, FINAL, Dashboard, CROSS_X, AGENT)", ["bilder", "variante", "final", "dashboard", "crossx", "agent"].every((v) => news.includes(v)) && doc.querySelector('.nav-item[data-view="bilder"] .nav-new').title.includes("OpenCV"));

  // Sitzung mit Daten
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const s = JSON.parse(savedFiles[0].data);
  s.rovoEntries = [1, 2].map((id) => ({ id, when: "", chatText: "F", answerText: "A", chapter: "", subchapter: "", labels: [], jiraKeys: [], jiraVisible: false }));
  s.uploadedImages = [5, 6, 7].map((id) => ({ id, filename: id + ".png", dataUrl: PNG, description: "B" }));
  s.rovoTables = [{ id: 1, sourceFile: "a.docx", tableNumber: 1, chapter: "", rows: [["a", "b"]] }];
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("rovoknowledge"); await wait(50);
  check("Anzahl je Register: Rovo Knowledge 2, Bilder 3, Tabelle 1, Import 0", count("rovoknowledge") === "2" && count("bilder") === "3" && count("tabellen") === "1" && count("import") === "0");
  const qStand = doc.querySelector('[data-nav-stage-stand="quellen"]');
  const qc = STAGES[0][1].map((v) => Number(count(v))), qFilled = qc.filter((n) => n > 0).length, qItems = qc.reduce((a, b) => a + b, 0);
  check("Stand je Stufe: Quellen „Register mit Inhalt / Register“ und Einträge (teilweise gefüllt)", qFilled >= 3 && qStand.textContent.trim() === qFilled + "/6" && qStand.querySelector(".flow-dot.part") && qStand.title.includes(qItems + " Einträge"));
  check("Stand je Gruppe in der Gruppenzeile", /^\d+\/\d+$/.test(doc.querySelector('[data-nav-group-stand="Input"]').textContent));

  // Workflow-Leiste
  check("Workflow-Leiste oben in jedem Register", Array.from(doc.querySelectorAll(".view-panel[data-view-panel]")).every((p) => p.firstElementChild && p.firstElementChild.classList.contains("flow-strip")));
  const chips = Array.from(visStrip().querySelectorAll("[data-flow-stage]"));
  check("Leiste: 9 Stufen, Gruppen Input · Operation · Output, aktuelle Stufe (Quellen) markiert", chips.length === 9 && Array.from(visStrip().querySelectorAll(".flow-group")).map((g) => g.textContent).join(",") === "Input,Operation,Output" &&
    chips[0].classList.contains("current") && chips[0].getAttribute("aria-current") === "step" && chips[0].textContent.includes("1 Quellen") && chips[0].textContent.includes(qFilled + "/6"));
  visStrip().querySelector('[data-flow-stage="validierung"]').click(); await wait(30);
  check("Klick auf eine Stufe öffnet ihr erstes Register (Validierung → CROSS_X), dort markiert", !doc.querySelector('[data-view-panel="crossx"]').hidden && visStrip().querySelector(".current").getAttribute("data-flow-stage") === "validierung");

  // Einklappen
  doc.querySelector('[data-nav-group-btn="Operation"]').click(); await wait(20);
  const opItems = Array.from(doc.querySelectorAll('#nav-list li[data-nav-group="Operation"]'));
  check("Gruppe einklappen: Einträge verborgen, das offene Register (CROSS_X) bleibt sichtbar", doc.querySelector('[data-nav-group-btn="Operation"]').getAttribute("aria-expanded") === "false" &&
    opItems.filter((li) => !li.classList.contains("nav-folded")).map((li) => (li.querySelector(".nav-item") || {}).getAttribute && li.querySelector(".nav-item").getAttribute("data-view")).join() === "crossx");
  $("nav-fold-all-btn").click(); await wait(20);
  check("Alle einklappen", ["Input", "Operation", "Output"].every((g) => doc.querySelector('[data-nav-group-btn="' + g + '"]').getAttribute("aria-expanded") === "false"));
  $("nav-fold-all-btn").click(); await wait(20);
  check("Alle wieder ausklappen", doc.querySelectorAll("#nav-list li.nav-folded").length === 0);
  check("Burger-Menü klappt die Navigation ein und wieder auf", (fire($("sidebar-toggle"), "click"), $("sidebar").classList.contains("collapsed")) && (fire($("sidebar-open-btn"), "click"), !$("sidebar").classList.contains("collapsed")));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
