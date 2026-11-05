// v2.158.0 Bilder → „Speicher sparen“: übergroße Bilder auf eine maximale Kantenlänge verkleinern, ohne Transparenz
// als JPEG speichern, wenn mindestens 15 % kleiner; aufbewahrte Originale zugeschnittener Bilder verwerfen.
// Bestätigung mit Ersparnis, Abbrechen ändert nichts, IDs bleiben, Einstellungen in der Sitzung, Knopf im Dashboard.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { createCanvas, loadImage } = require("canvas");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];

// Foto-artiges Bild (Rauschen in 3-px-Bloecken): als PNG gross, als JPEG deutlich kleiner
function photo(w, h, seed, alpha) {
  const c = createCanvas(w, h), x = c.getContext("2d");
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let yy = 0; yy < h; yy += 3) for (let xx = 0; xx < w; xx += 3) {
    x.fillStyle = "rgba(" + Math.round(120 + rnd() * 100) + "," + Math.round(90 + rnd() * 80) + "," + Math.round(60 + rnd() * 120) + "," + (alpha && xx < w / 4 ? 0.5 : 1) + ")";
    x.fillRect(xx, yy, 3, 3);
  }
  return c;
}
function ui() {
  const c = createCanvas(300, 200), x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 300, 200);
  x.fillStyle = "#0e7490"; x.fillRect(20, 20, 260, 12);
  for (let i = 0; i < 6; i++) { x.fillStyle = "#1f2937"; x.fillRect(20, 50 + i * 20, 80 + i * 20, 6); }
  return c.toDataURL("image/png");
}
const bytes = (url) => Math.round((url.length - url.indexOf(",") - 1) * 0.75);
const BIG = photo(2400, 1600, 7, false).toDataURL("image/png");
const ALPHA = photo(2600, 1000, 11, true).toDataURL("image/png");
const JPG = photo(2560, 1440, 13, false).toDataURL("image/jpeg", 0.95);
const UI = ui();
const ORIG = photo(600, 400, 17, false).toDataURL("image/png");
const CROPPED = photo(500, 300, 17, false).toDataURL("image/png");

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
    fire(imp, "change"); await wait(80);
    if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
    await wait(600);
  }
  const dashRow = (label) => { const tr = doc.querySelector('#dash-store-tbody tr[data-dash-store-row="' + label + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  const toBytes = (t) => { const m = /([\d,]+)\s*(B|KB|MB|GB)/.exec(t || ""); return m ? parseFloat(m[1].replace(",", ".")) * { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[2]] : NaN; };
  const dims = async (url) => { const im = await loadImage(url); return [im.width, im.height]; };

  let s = await session();
  s.uploadedImages = [
    { id: 201, filename: "foto.png", dataUrl: BIG, description: "gross", mimeType: "image/png", cvAt: "x", cvBorder: { x: 300, y: 200, w: 1800, h: 1200, pct: 44 } },
    { id: 202, filename: "transparent.png", dataUrl: ALPHA, description: "alpha", mimeType: "image/png" },
    { id: 203, filename: "kamera.jpg", dataUrl: JPG, description: "jpeg", mimeType: "image/jpeg" },
    { id: 204, filename: "maske.png", dataUrl: UI, description: "ui", mimeType: "image/png" },
    { id: 205, filename: "zugeschnitten.png", dataUrl: CROPPED, cvUncropped: ORIG, cvCroppedAt: "x", cvAt: "x", description: "crop", mimeType: "image/png" },
  ];
  await load(s);

  // Dashboard vorher
  nav("dashboard"); await wait(30); $("dash-store-refresh-btn").click(); await wait(200);
  const before = toBytes((dashRow("Bilder") || [])[2]);
  const shrinkBtn = doc.querySelector('#dash-store-tbody tr[data-dash-store-row="Bilder"] [data-dash-store-shrink]');
  check("Dashboard: Zeile Bilder hat den Knopf „Speicher sparen“ (andere Zeilen nicht)", !!shrinkBtn && doc.querySelectorAll("[data-dash-store-shrink]").length === 1);
  shrinkBtn.click(); await wait(30);
  check("Knopf öffnet das Register Bilder", !doc.querySelector('[data-view-panel="bilder"]').hidden);

  check("Abschnitt „Speicher sparen“ mit Voreinstellungen 1920 px, JPEG an, Originale verwerfen an",
    !!$("cv-shrink") && $("cv-shrink-edge").value === "1920" && $("cv-shrink-jpeg").checked && $("cv-shrink-drop-orig").checked);

  // 1) Abbrechen
  $("cv-shrink-btn").click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 20000);
  const msg = $("confirm-modal-message").textContent;
  check("Bestätigung nennt Anzahl, Größen vorher → nachher, Originale und Ersparnis", /3 von 5 Bild\(ern\) verkleinern: [\d,]+ MB → [\d,]+ (MB|KB)/.test(msg) && /1 aufbewahrte\(s\) Original/.test(msg) && /Ersparnis gesamt/.test(msg) && $("confirm-modal-ok-label").textContent === "Verkleinern");
  fire($("confirm-modal-cancel-btn"), "click"); await wait(50);
  s = await session();
  const byId = (ss, id) => ss.uploadedImages.find((i) => i.id === id);
  check("Abbrechen ändert nichts", /Abgebrochen – nichts geändert/.test($("cv-shrink-status").textContent) && byId(s, 201).dataUrl === BIG && byId(s, 205).cvUncropped === ORIG);

  // 2) Ausfuehren
  $("cv-shrink-btn").click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 20000);
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /gespart/.test($("cv-shrink-status").textContent), 20000);
  check("Status nennt verkleinerte Bilder, verworfene Originale und Ersparnis", /^3 Bild\(er\) verkleinert, 1 Original\(e\) verworfen – [\d,]+ MB gespart\.$/.test($("cv-shrink-status").textContent));
  s = await session();
  const big = byId(s, 201), al = byId(s, 202), jp = byId(s, 203), u = byId(s, 204), cr = byId(s, 205);
  const [bw, bh] = await dims(big.dataUrl), [aw, ah] = await dims(al.dataUrl), [jw, jh] = await dims(jp.dataUrl);
  check("Großes Bild ohne Transparenz: 2400×1600 → 1920×1280, als JPEG, deutlich kleiner, gleiche ID",
    bw === 1920 && bh === 1280 && /^data:image\/jpeg/.test(big.dataUrl) && big.mimeType === "image/jpeg" && big.sizeBytes < bytes(BIG) * 0.5 && big.id === 201);
  check("Bild mit Transparenz bleibt PNG, nur verkleinert (2600×1000 → 1920×738)", /^data:image\/png/.test(al.dataUrl) && aw === 1920 && ah === 738);
  check("JPEG wird verkleinert (2560×1440 → 1920×1080) und bleibt JPEG", /^data:image\/jpeg/.test(jp.dataUrl) && jw === 1920 && jh === 1080 && bytes(jp.dataUrl) < bytes(JPG));
  check("Kleiner Screen (Flächen, PNG klein) bleibt unverändert", u.dataUrl === UI && !u.cvShrunk);
  check("Original des zugeschnittenen Bildes verworfen, Bild selbst unverändert", !cr.cvUncropped && cr.dataUrl === CROPPED);
  check("Leerer Rand wird mitskaliert (×0,8), Verkleinerung am Bild vermerkt",
    big.cvBorder && big.cvBorder.x === 240 && big.cvBorder.y === 160 && big.cvBorder.w === 1440 && big.cvBorder.h === 960 && big.cvShrunk && big.cvShrunk.kind === "JPEG" && big.cvShrunk.from === "2400 × 1600");
  check("Protokoll-Eintrag", s.log.some((l) => /Speicher sparen – 3 Bild\(er\) verkleinert, 1 Original\(e\) verworfen/.test(l.message || l.text || JSON.stringify(l))));

  // Dashboard nachher
  nav("dashboard"); await wait(30); $("dash-store-refresh-btn").click(); await wait(200);
  const after = toBytes((dashRow("Bilder") || [])[2]);
  check("Dashboard: belegter Speicher der Bilder sinkt deutlich (" + (dashRow("Bilder") || [])[2] + ")", after > 0 && before > 0 && after < before * 0.5);

  // 3) Zweiter Lauf: nichts mehr zu sparen
  nav("bilder"); await wait(30);
  $("cv-shrink-btn").click();
  await waitUntil(() => /Nichts zu sparen|Bild\(er\) verkleinern/.test($("cv-shrink-status").textContent + (!$("confirm-modal-overlay").hidden ? "Bild(er) verkleinern" : "")), 20000);
  check("Zweiter Lauf: „Nichts zu sparen“ ohne Rückfrage", /^Nichts zu sparen: 5 Bild\(er\) geprüft/.test($("cv-shrink-status").textContent) && $("confirm-modal-overlay").hidden);

  // 4) Einstellungen in der Sitzung
  $("cv-shrink-edge").value = "0"; fire($("cv-shrink-edge"), "change");
  $("cv-shrink-drop-orig").checked = false; fire($("cv-shrink-drop-orig"), "change");
  s = await session();
  check("Einstellungen in der Sitzung gespeichert", s.cvSettings.shrinkEdge === 0 && s.cvSettings.shrinkJpeg === true && s.cvSettings.dropOrig === false);
  s.cvSettings.shrinkEdge = 1280; s.cvSettings.shrinkJpeg = false;
  s.uploadedImages.push({ id: 206, filename: "neu.png", dataUrl: photo(900, 600, 19, false).toDataURL("image/png"), mimeType: "image/png" });
  await load(s);
  check("Laden stellt Einstellungen wieder her", $("cv-shrink-edge").value === "1280" && !$("cv-shrink-jpeg").checked && !$("cv-shrink-drop-orig").checked);

  // 5) Nur JPEG ohne Verkleinern (Kantenlaenge "nicht verkleinern")
  $("cv-shrink-edge").value = "0"; fire($("cv-shrink-edge"), "change");
  $("cv-shrink-jpeg").checked = true; fire($("cv-shrink-jpeg"), "change");
  $("cv-shrink-btn").click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 20000);
  check("Ohne Verkleinern: nur das neue PNG-Foto wird JPEG", /^1 von 6 Bild\(ern\) verkleinern/.test($("confirm-modal-message").textContent) && !/Original/.test($("confirm-modal-message").textContent));
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /gespart/.test($("cv-shrink-status").textContent), 20000);
  s = await session();
  const nw = byId(s, 206), [nw1, nh1] = await dims(nw.dataUrl);
  check("Neues Bild als JPEG in Originalgröße 900×600", /^data:image\/jpeg/.test(nw.dataUrl) && nw1 === 900 && nh1 === 600);

  // 6) Ungueltige Kantenlaenge in alter Sitzung → 1920
  s.cvSettings = { ocrPre: true, shrinkEdge: 777 };
  await load(s);
  check("Unbekannte Kantenlänge → 1920, fehlende Schalter → an, OCR-Vorverarbeitung bleibt", $("cv-shrink-edge").value === "1920" && $("cv-shrink-jpeg").checked && $("cv-shrink-drop-orig").checked && $("cv-ocr-pre").checked);

  const navItem = doc.querySelector('.nav-item[data-view="bilder"]');
  check("Navigation: Hinweis auf „Speicher sparen“ im Neu-Label von Bilder", /Speicher sparen/.test(navItem.getAttribute("aria-description") || ""));
  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));

  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
