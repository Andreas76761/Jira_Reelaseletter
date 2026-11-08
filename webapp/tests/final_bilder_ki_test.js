// v2.190.0: FINAL Schritt 5 – Bilder aus dem Register „Bilder“ mit Claude zuordnen (Claude bekommt die Bilder; Rückfall auf
// Text, wenn Bilder nicht gesendet werden können). Reihenfolge der Vorschläge: Kapitel im Register „Bilder“ > Claude >
// Begriffe. Prozessbilder (Register Prozessbild) lassen sich als Bild übernehmen.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv|blob:|Could not load img/i)) errors.push(e.message); });
const savedFiles = [];
const calls = [];
let rejectImages = false;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      const sample = (input) => Promise.resolve({ text: "{}", truncated: false });
      sample.limits = () => Promise.resolve({ images: { maxCount: 5 } });
      sample.json = (prompt, opts) => {
        calls.push({ prompt: String(prompt), images: opts && opts.images ? opts.images.length : 0 });
        if (rejectImages && opts && opts.images) return Promise.reject({ code: "images_unavailable", message: "Bilder nicht verfügbar" });
        const n = (String(prompt).split("\n").filter((l) => /^\[\d+\] Datei:/.test(l))).length;
        const rows = [];
        for (let i = 1; i <= n; i++) {
          const line = String(prompt).split("\n").find((l) => l.startsWith("[" + i + "] Datei:"));
          if (/liste\.png/.test(line)) rows.push({ nr: i, kapitel: "2 Kundenliste", sicher: 85, grund: "Liste mit Filterleiste" });
          else if (/maske\.png/.test(line)) rows.push({ nr: i, kapitel: "1 vertrag anlegen", sicher: 0, grund: "Eingabemaske" });
          else if (/register\.png/.test(line)) rows.push({ nr: i, kapitel: "1 Vertrag anlegen", sicher: 90, grund: "x" });
          else rows.push({ nr: i, kapitel: "Gibt es nicht", sicher: 50, grund: "?" });
        }
        return Promise.resolve(rows);
      };
      window.claude = {
        use: (name) => {
          if (name === "sample") return Promise.resolve(sample);
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
  const row = (id) => doc.querySelector('#final-bilder-tbody [data-final-bilder-row="' + id + '"]');
  const runAi = async () => { fire($("final-bilder-ai-btn"), "click"); await waitUntil(() => !$("final-bilder-ai-btn").disabled && /angesehen|fehlgeschlagen/.test($("final-bilder-ai-note").textContent), 5000); await wait(20); };

  let s = await session();
  const ch = (title, text) => ({ title, level: 1, fullText: text, cleanText: text, markedText: text });
  s.final.manuals = [{ id: 1, filename: "Handbuch.docx", addedAt: "8.11.2026", pageCount: 2, design: null, chapters: [ch("1 Vertrag anlegen", "Vertrag anlegen und speichern."), ch("2 Kundenliste", "Die Kundenliste zeigt alle Kunden.")] }];
  s.final.versions = []; s.final.activeVersionId = null;
  s.lexAuto = { enabled: false, autoAccept: false, autoAi: false };
  s.uploadedImages = [
    { id: 501, filename: "liste.png", dataUrl: PNG, description: "", chapter: "" },
    { id: 502, filename: "maske.png", dataUrl: PNG, description: "", chapter: "" },
    { id: 503, filename: "foto.png", dataUrl: PNG, description: "", chapter: "" },
    { id: 504, filename: "register.png", dataUrl: PNG, description: "", chapter: "Kundenliste" } ];
  s.generatedImages = [
    { id: 900, title: "Ablauf Vertrag (3 Tickets)", when: "8.11.2026", kind: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect x="10" y="10" width="80" height="40" fill="#0e7490"/></svg>', description: "" },
    { id: 901, title: "Mermaid-Ablauf", when: "8.11.2026", kind: "mermaid", source: "graph TD; A-->B", description: "" } ];
  await load(s);
  nav("final"); await wait(100);

  check("Knopf „Mit Claude zuordnen“ in Schritt 5", /Mit Claude zuordnen/.test($("final-bilder-ai-btn").textContent));
  check("Vor dem Lauf: liste.png ohne Vorschlag, register.png über das Register-Kapitel", /kein Vorschlag/.test(row(501).children[2].textContent) && row(504).children[2].textContent.includes("2 Kundenliste") && row(504).children[3].textContent === "100 %");
  await runAi();
  check("Claude bekommt die Bilder (offene Bilder, je Aufruf höchstens 5) und die Kapitel-Liste", calls.length === 1 && calls[0].images === 4 && calls[0].prompt.includes("KAPITEL-LISTE:\n1. 1 Vertrag anlegen\n2. 2 Kundenliste") && calls[0].prompt.includes("(in derselben Reihenfolge beigefügt)") && calls[0].prompt.includes("Kapitel im Bildarchiv: Kundenliste"));
  check("Vorschlag von Claude mit Sicherheit und Begründung", row(501).children[2].textContent.includes("2 Kundenliste") && row(501).children[2].textContent.includes("Claude (Bild angesehen): Liste mit Filterleiste") && row(501).children[3].textContent === "85 %");
  check("Kapitel-Antwort wird auf den exakten Titel abgebildet (Groß-/Kleinschreibung), fehlende Sicherheit = 70 %", row(502).children[2].textContent.includes("1 Vertrag anlegen") && row(502).children[3].textContent === "70 %");
  check("Unbekanntes Kapitel von Claude wird nicht übernommen", /kein Vorschlag/.test(row(503).children[2].textContent));
  check("Kapitel aus dem Register „Bilder“ hat Vorrang vor Claude", row(504).children[2].textContent.includes("2 Kundenliste") && row(504).children[3].textContent === "100 %");
  check("Hinweis nennt das Ergebnis", /4 Bild\(er\) angesehen und für 3 ein Kapitel vorgeschlagen/.test($("final-bilder-ai-note").textContent));
  fire($("final-bilder-apply-btn"), "click"); await wait(20);
  s = await session();
  const u = (id) => s.uploadedImages.find((i) => i.id === id);
  check("„Vorschläge übernehmen“ nutzt Claudes Vorschläge", u(501).finalUseChapter === "2 Kundenliste" && u(502).finalUseChapter === "1 Vertrag anlegen" && u(504).finalUseChapter === "2 Kundenliste" && !u(503).finalUseChapter);
  check("Claudes Vorschlag wird in der Sitzung gespeichert", u(501).finalAiSuggest && u(501).finalAiSuggest.withImage === true && u(501).finalAiSuggest.score === 85);
  calls.length = 0;
  await runAi();
  check("Zweiter Lauf: nur noch offene Bilder", calls.length === 1 && calls[0].images === 1 && calls[0].prompt.includes("foto.png") && !calls[0].prompt.includes("liste.png"));

  // Rückfall auf Text
  const sel = row(501).querySelector("select"); sel.value = ""; fire(sel, "change"); await wait(10); // abgelehnt -> nicht mehr offen
  s = await session(); s.uploadedImages.forEach((i) => { delete i.finalUseChapter; delete i.finalUseDeclined; delete i.finalAiSuggest; }); await load(s); nav("final"); await wait(80);
  rejectImages = true; calls.length = 0;
  await runAi();
  check("Bilder abgelehnt -> erneut nur mit Text, Hinweis", calls.length === 2 && calls[0].images === 4 && calls[1].images === 0 && calls[1].prompt.includes("keine Bilder beigefügt") && /konnten nicht an Claude gesendet werden/.test($("final-bilder-ai-note").textContent));
  check("Vorschlag als „Claude (ohne Bild)“ gekennzeichnet", row(501).children[2].textContent.includes("Claude (ohne Bild)"));
  rejectImages = false;

  // Prozessbilder
  check("Prozessbilder aufgelistet: SVG mit „Als Bild übernehmen“, Mermaid mit Hinweis", !$("final-diagrams-wrap").hidden && $("final-diagrams-count").textContent === "2" &&
    !!$("final-diagrams-tbody").querySelector('[data-final-diagram-take="900"]') && /Mermaid-Diagramm/.test($("final-diagrams-tbody").textContent));
  fire($("final-diagrams-tbody").querySelector('[data-final-diagram-take="900"]'), "click");
  const settled = await waitUntil(() => /Übernahme fehlgeschlagen|Übernommen/.test($("toast").textContent), 4000);
  check("Übernehmen ohne Canvas (Testumgebung): verständliche Meldung statt Absturz", settled && !!$("final-diagrams-tbody").querySelector('[data-final-diagram-take="900"]') === /fehlgeschlagen/.test($("toast").textContent));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
