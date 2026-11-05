// v2.161.0 Bild löschen (Register Bilder): Bestätigung nennt die Verwendungen (FINAL, Screens-Platzhalter, Dokument-Review);
// beim Löschen werden die Verweise mit entfernt (screenIds, ph, scores), eingebettete Handbuch-Bilder behalten ihren Platz.
// Unbenutzte Bilder: Bestätigung wie bisher.
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

  let s = await session();
  s.uploadedImages = [img(401, "maske.png", 300, 200, null, "#0e7490"), img(402, "liste.png", 300, 200, null, "#7c3aed"), img(403, "frei.png", 300, 200, null, "#b91c1c")];
  s.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {}, reviews: [], notes: [],
    chapters: [{ title: "1 Vertrag", level: 1, text: "Vertrag", markedText: "Vertrag", screenIds: [401, 402] }] }];
  s.final.manuals = [{ id: 7, filename: "hb.docx", addedAt: "x", chapters: [{ level: 1, title: "Vertrag", fullText: "[Bild: #finimg0#]", cleanText: "", markedText: "", embedded: [{ id: 401, ph: "Maske" }] }] }];
  s.screenPh = { filename: "ph.xlsx", at: "x", rows: [{ nr: "1", chapter: "Vertrag", desc: "Maske", status: "offen", screenIds: [401], scores: { 401: 91, 402: 40 }, manual: false, via: "" }] };
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Vertrag", level: 1, text: "[Bild: Maske]" }], ph: { "1 Vertrag|0": [401] }, checks: {}, steps: {}, history: [] }], activeId: null };
  await load(s);
  nav("bilder"); await wait(50);
  const delBtn = (id) => doc.querySelector('#images-tbody .image-delete-btn[data-id="' + id + '"]');
  check("Löschen-Knopf in der Bildtabelle vorhanden", !!delBtn(401) && !!delBtn(403));

  // Unbenutztes Bild
  delBtn(403).click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  check("Unbenutztes Bild: Bestätigung ohne Verwendungshinweis", /„frei\.png“ wirklich löschen\?$/.test($("confirm-modal-message").textContent));
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(50);

  // Verwendetes Bild: Abbrechen
  delBtn(401).click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  const msg = $("confirm-modal-message").textContent;
  check("Verwendetes Bild: Bestätigung nennt 4 Verwendungen mit Registern", /„maske\.png“ wirklich löschen\?/.test(msg) && /Es wird 4× verwendet \(/.test(msg) && /FINAL/.test(msg) && /Screens-Import/.test(msg) && /Dokument-Review/.test(msg) && /Bild-Platzhalter bleiben offen/.test(msg));
  fire($("confirm-modal-cancel-btn"), "click"); await wait(50);
  s = await session();
  check("Abbrechen ändert nichts", ids(s).join() === "401,402" && JSON.stringify(s.final.versions[0].chapters[0].screenIds) === "[401,402]");

  // Loeschen
  delBtn(401).click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(100);
  s = await session();
  check("Bild gelöscht", ids(s).join() === "402");
  check("FINAL-Kapitel: 401 entfernt, 402 bleibt", JSON.stringify(s.final.versions[0].chapters[0].screenIds) === "[402]");
  check("Screens-Platzhalter: Zuordnung und Trefferwert entfernt, anderer Wert bleibt", JSON.stringify(s.screenPh.rows[0].screenIds) === "[]" && s.screenPh.rows[0].scores[401] == null && s.screenPh.rows[0].scores[402] === 40);
  check("Dokument-Review: Platzhalter wieder offen", JSON.stringify(s.vrev.docs[0].ph["1 Vertrag|0"]) === "[]");
  check("Eingebettetes Handbuch-Bild behält seinen Platz", s.final.manuals[0].chapters[0].embedded.length === 1 && s.final.manuals[0].chapters[0].embedded[0].ph === "Maske");
  check("Protokoll nennt entfernte Verweise", s.log.some((l) => /Hochgeladenes Bild „maske\.png“ gelöscht – 3 Verweis\(e\) entfernt \(/.test(l.message || "")) && s.log.some((l) => /Hochgeladenes Bild „frei\.png“ gelöscht\.$/.test(l.message || "")));
  nav("final"); await wait(100);
  check("FINAL lässt sich danach öffnen", !doc.querySelector('[data-view-panel="final"]').hidden);
  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));

  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
