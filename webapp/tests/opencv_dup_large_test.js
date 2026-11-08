// v2.173.0 Sehr ähnliche Bilder bei großen Screenshots: Masken mit gleichem Layout, aber anderem Inhalt (nur andere
// Werte in den Feldern) dürfen nicht als Dubletten gelten – im Lasttest landeten 500 verschiedene 1280×800-Masken in
// EINER Gruppe. Kopien (neu kodiert, verkleinert, auch stark verkleinert) und eine kleine Markierung bleiben „sehr ähnlich“.
// Läuft mit dem echten OpenCV.js (npm @techstark/opencv-js) und echten Pixeln (canvas).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { createCanvas, Image } = require("canvas");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];

// Maske „oneSCM“ 1280×800: Kopfzeile, 14 Felder mit Werten, Eingabefelder unterschiedlicher Breite
function mask(i, marker) {
  const w = 1280, h = 800, c = createCanvas(w, h), x = c.getContext("2d");
  x.fillStyle = "#f3f4f6"; x.fillRect(0, 0, w, h); x.fillStyle = "#0e7490"; x.fillRect(0, 0, w, 56);
  x.fillStyle = "#fff"; x.font = "bold 24px sans-serif"; x.fillText("oneSCM – Vertragsmaske", 24, 36);
  x.fillStyle = "#fff"; x.fillRect(40, 90, w - 80, h - 140); x.fillStyle = "#111827"; x.font = "18px sans-serif";
  for (let r = 0; r < 14; r++) { x.fillText("Feld " + (r + 1) + ": Wert " + ((i * 7 + r * 13) % 997), 70, 140 + r * 40); x.strokeStyle = "#d1d5db"; x.strokeRect(420, 120 + r * 40, 300 + ((i + r) % 5) * 60, 28); }
  if (marker) { x.fillStyle = "#b91c1c"; x.fillRect(1100, 700, 6, 6); }
  return c;
}
function copy(c, f, q) { const d = createCanvas(Math.round(c.width * f), Math.round(c.height * f)); d.getContext("2d").drawImage(c, 0, 0, d.width, d.height); return d.toDataURL("image/jpeg", q); }

(async () => {
  let cv = require("@techstark/opencv-js");
  if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.cv = cv;
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
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 5000); return JSON.parse(savedFiles[0].data); }
  const grp = (id) => { const tr = doc.querySelector('#cv-tbody tr[data-cv-row="' + id + '"]'); const t = tr ? tr.children[5].textContent.trim() : null; const m = t && /^Gruppe (\d+)/.exec(t); return m ? +m[1] : t; };

  const M1 = mask(1), M2 = mask(2);
  const imgs = [
    [201, "maske_1.png", M1.toDataURL("image/png")],
    [202, "maske_1_kopie_50.jpg", copy(M1, 0.5, 0.8)],
    [203, "maske_1_kopie_33_q50.jpg", copy(M1, 0.33, 0.5)],
    [204, "maske_1_markiert.png", mask(1, true).toDataURL("image/png")],
    [205, "maske_2.png", M2.toDataURL("image/png")],
    [206, "maske_2_vorschau.jpg", copy(M2, 0.2, 0.8)],
  ];
  // weitere Masken mit gleichem Layout, nur andere Werte (auch gleiche Feldbreiten: 6, 11, 16 wie Maske 1; 26/36/46
  // unterscheiden sich je Feld nur in ein bis zwei Ziffern, z. B. „Wert 182“ / „Wert 252“)
  [3, 6, 11, 16, 37, 451, 26, 36, 46].forEach((i, k) => imgs.push([207 + k, "maske_" + i + ".png", mask(i).toDataURL("image/png")]));
  let s = await session();
  s.uploadedImages = imgs.map(([id, fn, url]) => ({ id, filename: fn, dataUrl: url, description: fn, mimeType: fn.endsWith(".jpg") ? "image/jpeg" : "image/png", sourceFile: "screens.docx" }));
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000)) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("bilder"); await wait(30);
  $("cv-analyze-btn").click();
  await waitUntil(() => /analysiert|fehlgeschlagen/.test($("cv-status").textContent), 120000);
  const st = $("cv-status").textContent;
  console.log("   " + st);
  check("Analyse aller 15 Bilder ohne Fehler, genau 2 Gruppen", st.startsWith("15 Bild(er) analysiert") && st.includes("2 Gruppe(n) sehr ähnlicher Bilder"));
  const g1 = grp(201);
  check("Maske 1 mit ihren Kopien (50 %, 33 % in schlechter JPEG-Qualität) und der markierten Fassung in einer Gruppe", typeof g1 === "number" && [202, 203, 204].every((id) => grp(id) === g1));
  const g2 = grp(205);
  check("Kleine Vorschau (20 %, 256×160) von Maske 2 wird erkannt – grober Vergleich, wenn ein Bild zu klein für den feinen ist", typeof g2 === "number" && g2 !== g1 && grp(206) === g2);
  check("Masken mit gleichem Layout, aber anderen Werten (auch nur einzelne Ziffern anders): keine Gruppe", [207, 208, 209, 210, 211, 212, 213, 214, 215].every((id) => grp(id) === "–"));
  s = await session();
  const byId = (id) => s.uploadedImages.find((x) => x.id === id);
  check("Gruppen in der Sitzung gespeichert", byId(201).cvDupGroup && String(byId(203).cvDupGroup) === String(byId(201).cvDupGroup) && !byId(209).cvDupGroup);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
