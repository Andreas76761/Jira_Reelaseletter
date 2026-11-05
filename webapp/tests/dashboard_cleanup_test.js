// v2.163.0/v2.164.0 Dashboard → „Aufräumen – entbehrliche Kopien“ (v2.164: plus verwaiste Verweise auf gelöschte Bilder): ältere Zwischenversionen (Benutzerhandbuch, Massenverarbeitung;
// die neueste bleibt), Bild-Originale vor dem Verpixeln und vor dem Zuschneiden – je Zeile Anzahl, Größe, Hinweis, Löschen
// mit Bestätigung; der aktuelle Stand bleibt unverändert; Belegt im Dashboard sinkt.
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
    await wait(500);
  }
  const card = (id) => doc.querySelector('#cv-dup-list [data-cv-dup-img="' + id + '"]');
  const ids = (ss) => ss.uploadedImages.map((i) => i.id).sort((a, b) => a - b);

  const big = (n) => "x".repeat(n);
  let s = await session();
  s.uploadedImages = [img(501, "a.png", 300, 200, null, "#0e7490"), img(502, "b.png", 300, 200, null, "#7c3aed"), img(503, "c.png", 300, 200, null, "#b91c1c")];
  s.uploadedImages[0].originalDataUrl = shot(300, 200, "#111111");
  s.uploadedImages[1].cvUncropped = shot(320, 220, "#222222");
  s.manualChapters = { "1 Vertrag": { text: "aktuell" } };
  s.manualCheckpoints = [1, 2, 3].map((k) => ({ id: "mcp-" + k, at: "x", afterCount: k * 20, chapterCount: 1, snapshot: { "1 Vertrag": { text: big(40000) + k } } }));
  s.massCheckpoints = [1, 2].map((k) => ({ id: "mascp-" + k, at: "x", afterCount: k * 50, entryCount: 1, snapshot: [{ id: 1, text: big(30000) + k }] }));
  await load(s);
  nav("dashboard"); await wait(30);
  $("dash-store-refresh-btn").click(); await wait(300);
  const crow = (key) => { const tr = doc.querySelector('#dash-clean-tbody tr[data-dash-clean-row="' + key + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  const kb = (t) => { const m = /([\d,]+) (B|KB|MB)/.exec(t || ""); return m ? parseFloat(m[1].replace(",", ".")) * { B: 1 / 1024, KB: 1, MB: 1024 }[m[2]] : NaN; };
  const dashRow = (label) => { const tr = doc.querySelector('#dash-store-tbody tr[data-dash-store-row="' + label + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };

  check("Abschnitt „Aufräumen“ mit 4 Zeilen", !$("dash-clean").hidden && doc.querySelectorAll("#dash-clean-tbody tr").length === 4);
  check("Benutzerhandbuch: 2 ältere Zwischenversionen, ca. 80 KB", crow("manual-cp")[1] === "2" && kb(crow("manual-cp")[2]) > 75 && kb(crow("manual-cp")[2]) < 85 && /die neueste bleibt/.test(crow("manual-cp")[3]));
  check("Massenverarbeitung: 1 ältere Zwischenversion, ca. 30 KB", crow("mass-cp")[1] === "1" && kb(crow("mass-cp")[2]) > 28 && kb(crow("mass-cp")[2]) < 32);
  check("Bild-Original vor dem Verpixeln mit Datenschutz-Hinweis", crow("img-blur")[1] === "1" && /unverpixelten Stellen/.test(crow("img-blur")[3]));
  check("Bild-Original vor dem Zuschneiden", crow("img-crop")[1] === "1");
  const before = kb(dashRow("Benutzerhandbuch")[2]);

  // Abbrechen
  doc.querySelector('[data-dash-clean="manual-cp"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  check("Bestätigung nennt Anzahl und Größe", /^Benutzerhandbuch – Zwischenversionen: 2 löschen \([\d,]+ KB\)\./.test($("confirm-modal-message").textContent) && $("confirm-modal-ok-label").textContent === "Löschen");
  fire($("confirm-modal-cancel-btn"), "click"); await wait(50);
  s = await session();
  check("Abbrechen ändert nichts", s.manualCheckpoints.length === 3);

  // Loeschen: Benutzerhandbuch
  doc.querySelector('[data-dash-clean="manual-cp"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(300);
  s = await session();
  check("Nur die neueste Zwischenversion bleibt, aktueller Stand unverändert", s.manualCheckpoints.length === 1 && s.manualCheckpoints[0].id === "mcp-3" && s.manualChapters["1 Vertrag"].text === "aktuell");
  check("Zeile verschwindet, Belegt im Dashboard sinkt", !crow("manual-cp") && kb(dashRow("Benutzerhandbuch")[2]) < before - 70);
  check("Protokoll-Eintrag", s.log.some((l) => /Aufräumen: Benutzerhandbuch – Zwischenversionen – 2 gelöscht/.test(l.message || "")));

  // Massenverarbeitung + Bild-Originale
  for (const key of ["mass-cp", "img-blur", "img-crop"]) {
    doc.querySelector('[data-dash-clean="' + key + '"]').click();
    await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
    fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(300);
  }
  s = await session();
  const a = s.uploadedImages.find((i) => i.id === 501), b = s.uploadedImages.find((i) => i.id === 502);
  check("Massenverarbeitung: neueste Zwischenversion bleibt", s.massCheckpoints.length === 1 && s.massCheckpoints[0].id === "mascp-2");
  check("Bild-Originale gelöscht, Bilder selbst unverändert", !a.originalDataUrl && !b.cvUncropped && a.dataUrl && b.dataUrl && s.uploadedImages.length === 3);
  check("Nichts mehr aufzuräumen → Abschnitt verborgen", $("dash-clean").hidden);
  nav("bilder"); await wait(50);
  check("Register Bilder öffnet ohne Fehler", !doc.querySelector('[data-view-panel="bilder"]').hidden);
  // v2.164: verwaiste Verweise (Bilder 777/778 gibt es nicht)
  s = await session();
  s.final.versions = [{ id: 1, name: "Basis", createdAt: "x", status: "Entwurf", statusChangedAt: "x", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {}, reviews: [], notes: [],
    chapters: [{ title: "1 Vertrag", level: 1, text: "Vertrag", markedText: "Vertrag", screenIds: [501, 777] }] }];
  s.screenPh = { filename: "ph.xlsx", at: "x", rows: [{ nr: "1", chapter: "Vertrag", desc: "Maske", status: "offen", screenIds: [778], scores: { 778: 90, 501: 50 }, manual: false, via: "" }] };
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Vertrag", level: 1, text: "[Bild: Maske]" }], ph: { "1 Vertrag|0": [777, 502] }, checks: {}, steps: {}, history: [] }], activeId: null };
  await load(s);
  nav("dashboard"); await wait(30); $("dash-store-refresh-btn").click(); await wait(300);
  const orow = crow("orphan-refs");
  check("Verwaiste Verweise: 3 gezählt, Register genannt, ohne Größe", !!orow && orow[1] === "3" && orow[2] === "–" && /FINAL/.test(orow[3]) && /Screens-Import/.test(orow[3]) && /Dokument-Review/.test(orow[3]));
  doc.querySelector('[data-dash-clean="orphan-refs"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  check("Bestätigung ohne Größenangabe", /^Verweise auf gelöschte Bilder: 3 löschen\.\n/.test($("confirm-modal-message").textContent));
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(300);
  s = await session();
  check("Verwaiste Verweise entfernt, gültige bleiben (FINAL [501], Platzhalter [] ohne Score 778, Review [502])",
    JSON.stringify(s.final.versions[0].chapters[0].screenIds) === "[501]" && JSON.stringify(s.screenPh.rows[0].screenIds) === "[]" && s.screenPh.rows[0].scores[778] == null && s.screenPh.rows[0].scores[501] === 50 && JSON.stringify(s.vrev.docs[0].ph["1 Vertrag|0"]) === "[502]");
  check("Danach nichts mehr aufzuräumen", $("dash-clean").hidden && s.log.some((l) => /Verweise auf gelöschte Bilder – 3 gelöscht\./.test(l.message || "")));
  nav("final"); await wait(100);
  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));

  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
