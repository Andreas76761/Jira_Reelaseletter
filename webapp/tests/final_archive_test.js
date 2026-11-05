// v2.166.0 Dashboard → Aufräumen „FINAL – nicht mehr benötigte Stände“: geschützte Stände bleiben (aktiv, veröffentlicht,
// Basis/Ergebnis von Varianten, im Editor, aus dem Dokument-Review); die übrigen werden erst als Archivdatei gespeichert und
// nur danach entfernt (abgelehnter Download → nichts gelöscht); „FINAL-Stände-Archiv einlesen“ holt sie mit neuen IDs zurück.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { createCanvas } = require("canvas");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];
let declineNext = false;

function shot(w, h, color) {
  const c = createCanvas(w, h), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.fillStyle = color; x.fillRect(w / 10, h / 10, w / 2, h / 6);
  return c.toDataURL("image/png");
}
const img = (id, name, w, h, g, color) => ({ id, filename: name, dataUrl: shot(w, h, color), mimeType: "image/png", width: w, height: h, cvAt: "x", cvSharp: 500, cvContrast: 60, cvDupGroup: g, cvDupDiff: g ? 0.0012 : null });

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { if (declineNext) { declineNext = false; return Promise.reject({ code: "declined" }); } savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
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
    await wait(500);
  }
  const card = (id) => doc.querySelector('#cv-dup-list [data-cv-dup-img="' + id + '"]');
  const ids = (ss) => ss.uploadedImages.map((i) => i.id).sort((a, b) => a - b);

  const stand = (id, name, status) => ({ id, name, createdAt: "1.11.2026, 10:00:00", status, statusChangedAt: "x", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {}, reviews: [], notes: [],
    chapters: [{ title: "1 Kapitel", level: 1, text: name + " " + "Text ".repeat(2000), markedText: "", screenIds: [] }] });
  let s = await session();
  s.final.versions = [stand(1, "Veröffentlicht", "Veröffentlicht"), stand(2, "Aktiv", "Entwurf"), stand(3, "Varianten-Basis", "Entwurf"), stand(4, "Variante Retail", "Entwurf"),
    stand(5, "Aus Review", "Entwurf"), stand(6, "Im Editor", "Entwurf"), stand(7, "Alt A", "Entwurf"), stand(8, "Alt B", "Freigegeben"),
    stand(9, "Editor-Quelle", "Entwurf"), stand(10, "CROSS_X-Auswahl", "Entwurf"), stand(11, "AGENT alt", "Entwurf")];
  s.final.versions[6].teamDocId = 77;
  s.final.versions[6].chapters[0].screenIds = [999];
  s.final.activeVersionId = 2;
  s.variante = { baseVersionId: 3, variants: [{ id: 1, role: "Retail", lang: "DE", name: "Retail DE", standId: 4 }] };
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1", level: 1, text: "x" }], ph: {}, checks: {}, steps: {}, history: [], finalVersionId: 5 }], activeId: null };
  s.editoFinalDocId = 6;
  s.editoBaseDocId = 9;
  s.crossx = Object.assign({}, s.crossx || {}, { standIds: [10] });
  s.agent = Object.assign({}, s.agent || {}, { impA: "F:11" });
  await load(s);
  nav("dashboard"); await wait(30); $("dash-store-refresh-btn").click(); await wait(300);
  const crow = (key) => { const tr = doc.querySelector('#dash-clean-tbody tr[data-dash-clean-row="' + key + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  const r = crow("final-old");
  check("Zeile „FINAL – nicht mehr benötigte Stände“: 2 Stände, Größe, Knopf „Sichern und löschen“", !!r && r[1] === "2" && /KB/.test(r[2]) && r[4] === "Sichern und löschen");
  check("Hinweis nennt Archiv und geschützte Stände", /Archivdatei/.test(r[3]) && /veröffentlichte Stände/.test(r[3]) && /Varianten/.test(r[3]));

  // Download abgelehnt → nichts geloescht
  declineNext = true;
  doc.querySelector('[data-dash-clean="final-old"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  check("Bestätigung: „2 sichern und löschen“, Knopf „Sichern und löschen“", /^FINAL – nicht mehr benötigte Stände: 2 sichern und löschen \(/.test($("confirm-modal-message").textContent) && $("confirm-modal-ok-label").textContent === "Sichern und löschen");
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(300);
  s = await session();
  check("Download abgelehnt: alle 11 Stände bleiben", s.final.versions.length === 11 && /nicht gespeichert/.test($("toast").textContent));

  // Sichern und loeschen
  savedFiles.length = 0;
  doc.querySelector('[data-dash-clean="final-old"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(300);
  const arch = savedFiles.find((f) => /^FINAL-Staende-Archiv_\d{4}-\d{2}-\d{2}_2\.json$/.test(f.filename));
  const ad = arch ? JSON.parse(arch.data) : null;
  check("Archivdatei gespeichert mit den 2 alten Ständen", !!ad && ad.type === "final-versions-archive" && ad.versions.map((v) => v.name).join() === "Alt A,Alt B");
  s = await session();
  check("Nur die alten Stände entfernt, geschützte bleiben (v2.172 auch Editor-Quelle, CROSS_X-Auswahl, AGENT-Revision)", s.final.versions.map((v) => v.id).join() === "1,2,3,4,5,6,9,10,11" && s.final.activeVersionId === 2);
  check("Zeile verschwindet, Protokoll nennt die Archivdatei", !crow("final-old") && s.log.some((l) => /FINAL: 2 Stand\/Stände als „FINAL-Staende-Archiv_.*“ gesichert: Alt A, Alt B/.test(l.message || "")));

  // Archiv einlesen
  const inp = $("dash-archive-input");
  Object.defineProperty(inp, "files", { value: [new win.File([arch.data], arch.filename, { type: "application/json" })], configurable: true });
  fire(inp, "change"); await wait(500);
  s = await session();
  const back = s.final.versions.filter((v) => /^Alt /.test(v.name));
  check("v2.172: Team-Verknüpfung nicht übernommen, Verweis auf fehlendes Bild entfernt und gemeldet", back.find((v) => v.name === "Alt A").teamDocId === null && JSON.stringify(back.find((v) => v.name === "Alt A").chapters[0].screenIds) === "[]" && /1 Bild\(er\) nicht mehr im Bildarchiv/.test(s.log.map((l) => l.message).join("\n")));
  Object.defineProperty(inp, "files", { value: [new win.File([arch.data], arch.filename, { type: "application/json" })], configurable: true });
  fire(inp, "change"); await wait(500);
  const s2 = await session();
  check("v2.172: dasselbe Archiv nochmals eingelesen → keine Doppel", s2.final.versions.filter((v) => /^Alt /.test(v.name)).length === 2 && /2 schon vorhanden/.test($("toast").textContent));
  check("Archiv einlesen: beide Stände zurück, mit neuen IDs und Vermerk in der Historie", back.length === 2 && back.every((v) => v.id > 11) && back.every((v) => v.history.some((h) => /wiederhergestellt aus Stände-Archiv/.test(h.by) && h.when && h.status)) && back[0].chapters[0].text.startsWith("Alt A"));
  Object.defineProperty(inp, "files", { value: [new win.File(['{"x":1}'], "falsch.json", { type: "application/json" })], configurable: true });
  fire(inp, "change"); await wait(300);
  s = await session();
  check("Falsche Datei: Hinweis, nichts geändert", /kein FINAL-Stände-Archiv/.test($("toast").textContent) && s.final.versions.length === 11);
  nav("final"); await wait(100);
  check("FINAL öffnet mit wiederhergestellten Ständen", !doc.querySelector('[data-view-panel="final"]').hidden && /Alt A/.test(doc.querySelector('[data-view-panel="final"]').textContent));
  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));

  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
