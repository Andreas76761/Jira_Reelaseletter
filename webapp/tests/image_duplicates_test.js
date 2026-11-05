// v2.159.0 Bilder → „Sehr ähnliche Bilder bereinigen“: je OpenCV-Gruppe ein Bild behalten (vorgewählt: meiste
// Verwendungen, dann größte Auflösung), die anderen entfernen und alle Verweise umstellen – FINAL-Kapitel (screenIds),
// eingebettete Handbuch-Bilder (embedded[].id), Screens-Platzhalter (screenIds + scores), Dokument-Review (ph).
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
  s.uploadedImages = [
    img(301, "maske_a.png", 300, 200, 1, "#0e7490"), img(302, "maske_a_gross.png", 600, 400, 1, "#0e7490"), img(303, "maske_a_kopie.png", 300, 200, 1, "#0e7490"),
    img(304, "liste.png", 400, 300, 2, "#7c3aed"), img(305, "liste2.png", 400, 300, 2, "#7c3aed"),
    img(306, "einzeln.png", 300, 200, null, "#b91c1c"),
  ];
  s.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {}, reviews: [], notes: [],
    chapters: [{ title: "1 Vertrag", level: 1, text: "Vertrag anlegen", markedText: "Vertrag anlegen", screenIds: [301, 303] }, { title: "2 Liste", level: 1, text: "Liste", markedText: "Liste", screenIds: [305, 306] }] }];
  s.final.manuals = [{ id: 7, filename: "hb.docx", addedAt: "x", chapters: [{ level: 1, title: "Vertrag", fullText: "[Bild: #finimg0#]", cleanText: "", markedText: "", embedded: [{ id: 303, ph: "Maske" }] }] }];
  s.screenPh = { filename: "ph.xlsx", at: "x", rows: [{ nr: "1", chapter: "Vertrag", desc: "Maske", status: "offen", screenIds: [303], scores: { 303: 91, 301: 80 }, manual: false, via: "" }, { nr: "2", chapter: "Liste", desc: "Liste", status: "offen", screenIds: [304], scores: { 304: 70 }, manual: true, via: "" }] };
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Vertrag", level: 1, text: "[Bild: Maske]" }], ph: { "1 Vertrag|0": [303, 302] }, checks: {}, steps: {}, history: [] }], activeId: null };
  await load(s);
  nav("bilder"); await wait(50);

  check("Abschnitt „Sehr ähnliche Bilder bereinigen“ mit 2 Gruppen", !$("cv-dup-wrap").hidden && $("cv-dup-count").textContent === "2" && doc.querySelectorAll("#cv-dup-list [data-cv-dup-group]").length === 2);
  const t303 = card(303).textContent, t302 = card(302).textContent, t301 = card(301).textContent;
  check("Verwendungen je Bild mit Register (303: 4 in FINAL, Screens-Platzhalter, Dokument-Review)", /4 Verwendung\(en\)/.test(t303) && /FINAL/.test(t303) && /Screens-Import/.test(t303) && /Dokument-Review/.test(t303) && /1 Verwendung\(en\): Dokument-Review/.test(t302) && /1 Verwendung\(en\): FINAL/.test(t301));
  check("Vorgewählt: meiste Verwendungen (303), nicht die größte Auflösung", card(303).querySelector("input").checked && card(303).classList.contains("cv-dup-keep"));
  check("Gruppe 2: gleich viele Verwendungen und gleiche Größe → kleinste ID (304)", card(304).querySelector("input").checked);
  check("Einzelnes Bild ohne Gruppe erscheint nicht", !card(306));

  // Auswahl aendern: groesstes Bild 302 behalten
  const r302 = card(302).querySelector("input"); r302.checked = true; fire(r302, "change"); await wait(30);
  check("Auswahl umstellbar (302 behalten)", card(302).classList.contains("cv-dup-keep") && !card(303).classList.contains("cv-dup-keep"));

  // Abbrechen
  doc.querySelector('[data-cv-dup-merge="1"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  const msg = $("confirm-modal-message").textContent;
  check("Bestätigung: 2 entfernen, „maske_a_gross.png“ bleibt, 5 Verweise mit Registern, Ersparnis, Abweichung", /^2 Bild\(er\) entfernen, „maske_a_gross\.png“ bleibt\./.test(msg) && /5 Verweis\(e\) \(/.test(msg) && /Spart [\d,]+ (KB|B)/.test(msg) && /0,12 %/.test(msg) && $("confirm-modal-ok-label").textContent === "Entfernen");
  fire($("confirm-modal-cancel-btn"), "click"); await wait(50);
  s = await session();
  check("Abbrechen ändert nichts", ids(s).join() === "301,302,303,304,305,306");

  // Ausfuehren
  doc.querySelector('[data-cv-dup-merge="1"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /Gruppe 1:/.test($("cv-status").textContent), 5000);
  check("Status nennt entfernte Bilder, behaltenes Bild und umgestellte Verweise", /^Gruppe 1: 2 Bild\(er\) entfernt, „maske_a_gross\.png“ behalten, 5 Verweis\(e\) umgestellt, [\d,]+ (KB|B) gespart\.$/.test($("cv-status").textContent));
  s = await session();
  const v = s.final.versions[0], row1 = s.screenPh.rows[0];
  check("Bilder 301 und 303 entfernt, 302 bleibt ohne Gruppe", ids(s).join() === "302,304,305,306" && s.uploadedImages.find((i) => i.id === 302).cvDupGroup == null);
  check("FINAL-Kapitel: [301, 303] → [302] (ohne doppelte ID), anderes Kapitel unverändert", JSON.stringify(v.chapters[0].screenIds) === "[302]" && JSON.stringify(v.chapters[1].screenIds) === "[305,306]");
  check("Eingebettetes Handbuch-Bild: 303 → 302, Platzhaltertext bleibt", s.final.manuals[0].chapters[0].embedded[0].id === 302 && s.final.manuals[0].chapters[0].embedded[0].ph === "Maske");
  check("Screens-Platzhalter: screenIds [303] → [302], Score übernommen", JSON.stringify(row1.screenIds) === "[302]" && row1.scores[302] === 91 && row1.scores[303] == null && row1.scores[301] == null);
  check("Dokument-Review: ph [303, 302] → [302]", JSON.stringify(s.vrev.docs[0].ph["1 Vertrag|0"]) === "[302]");
  check("Gruppe 1 verschwindet, Gruppe 2 bleibt", $("cv-dup-count").textContent === "1" && !doc.querySelector('[data-cv-dup-group="1"]') && !!doc.querySelector('[data-cv-dup-group="2"]'));
  check("Protokoll-Eintrag mit Dateinamen", s.log.some((l) => /sehr ähnliche Bilder bereinigt – 2 entfernt \(maske_a\.png, maske_a_kopie\.png\), „maske_a_gross\.png“ behalten, 5 Verweis\(e\) umgestellt/.test(l.message || "")));

  // Gruppe 2 mit Vorauswahl
  doc.querySelector('[data-cv-dup-merge="2"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  check("Gruppe 2: 1 Verweis aus FINAL genannt", /1 Verweis\(e\) \(FINAL\)/.test($("confirm-modal-message").textContent));
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /Gruppe 2:/.test($("cv-status").textContent), 5000);
  s = await session();
  check("Gruppe 2: 305 → 304 in FINAL, Screens-Platzhalter unverändert [304]", ids(s).join() === "302,304,306" && JSON.stringify(s.final.versions[0].chapters[1].screenIds) === "[304,306]" && JSON.stringify(s.screenPh.rows[1].screenIds) === "[304]");
  check("Keine Gruppen mehr → Abschnitt verborgen", $("cv-dup-wrap").hidden);

  // Nach Laden der Sitzung bleiben Verweise gueltig, FINAL zeigt das Bild
  await load(s);
  nav("final"); await wait(100);
  check("Nach erneutem Laden: Sitzung konsistent (keine Verweise auf entfernte Bilder)", (() => { const all = JSON.stringify([s.final, s.screenPh, s.vrev]); return !/\b30[135]\b/.test(all); })());
  check("Navigation: Neu-Label von Bilder nennt die Bereinigung", /sehr ähnliche Bilder bereinigen/.test(doc.querySelector('.nav-item[data-view="bilder"]').getAttribute("aria-description") || ""));
  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));

  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
