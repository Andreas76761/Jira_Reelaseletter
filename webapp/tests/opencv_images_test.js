// v2.153.0 Bildverarbeitung mit OpenCV (Register Bilder): Schaerfe, Kontrast, leerer Rand, Dubletten; Zuschneiden und
// Original wiederherstellen; OCR mit OpenCV-Vorverarbeitung (Graustufen, Vergroessern, Binarisierung). Laeuft mit dem
// echten OpenCV.js (npm @techstark/opencv-js) und echten Pixeln (canvas).
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
const ocrInputs = [];

function screen(opts) {
  const c = createCanvas(300, 200), x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 300, 200);
  const fg = opts.fg || "#1f2937";
  const L = opts.layout || 0;
  for (let r = 0; r < 6; r++) { x.fillStyle = fg; x.fillRect(70 + L * 25 * (r % 2), 55 + r * 15, 60 + ((r * 37 + L * 53) % 90), 6); x.fillRect(150 - L * 30, 55 + r * 15 + L * 4, 40 + L * 20, 6); }
  x.fillStyle = opts.bar || "#0e7490"; x.fillRect(60, 40, 180, 8);
  if (opts.extra) { x.fillStyle = "#b91c1c"; x.fillRect(225, 140, 4, 4); }
  if (!opts.blur) return c.toDataURL("image/png");
  const s = createCanvas(30, 20); s.getContext("2d").drawImage(c, 0, 0, 30, 20);
  const b = createCanvas(300, 200), bx = b.getContext("2d"); bx.imageSmoothingEnabled = true; bx.drawImage(s, 0, 0, 300, 200);
  return b.toDataURL("image/png");
}
function textImage() {
  const c = createCanvas(160, 40), x = c.getContext("2d");
  x.fillStyle = "#e5e7eb"; x.fillRect(0, 0, 160, 40); x.fillStyle = "#6b7280"; x.font = "16px sans-serif"; x.fillText("Vertrag speichern", 8, 25);
  return c.toDataURL("image/png");
}
function jpegCopy(url, f) { const im = new (require("canvas").Image)(); im.src = url; const c = createCanvas(Math.round(300 * f), Math.round(200 * f)); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.8); }
const SHARP = screen({});
const IMAGES = { sharp: SHARP, dup: jpegCopy(SHARP, 0.75), blurry: screen({ blur: true, bar: "#7c3aed", layout: 1 }), flat: screen({ fg: "#d1d5db", bar: "#d1d5db", layout: 2 }), text: textImage() };

(async () => {
  let cv = require("@techstark/opencv-js");
  if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.cv = cv;
      window.Tesseract = { createWorker: async () => ({ recognize: async (input) => { ocrInputs.push(input); return { data: { text: "Vertrag speichern" } }; } }) };
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
  const row = (id) => { const tr = doc.querySelector('#cv-tbody tr[data-cv-row="' + id + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  const dims = async (url) => { const im = await loadImage(url); return [im.width, im.height]; };

  // Sitzung mit 5 Bildern
  let s = await session();
  s.uploadedImages = Object.keys(IMAGES).map((k, i) => ({ id: 101 + i, filename: k + ".png", dataUrl: IMAGES[k], description: k, mimeType: "image/png", sourceFile: "test.docx" }));
  s.uploadedImages.push({ id: 106, filename: "marker.png", dataUrl: screen({ extra: true }), description: "marker", mimeType: "image/png", sourceFile: "test.docx" });
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("bilder"); await wait(30);
  check("Abschnitt OpenCV im Register Bilder, Tabelle vor der Analyse verborgen, Zuschneiden gesperrt", !!$("cv-section") && $("cv-table-wrap").hidden && $("cv-crop-all-btn").disabled);

  $("cv-analyze-btn").click();
  await waitUntil(() => /analysiert|fehlgeschlagen/.test($("cv-status").textContent), 20000);
  const st = $("cv-status").textContent;
  console.log("   " + st);
  check("Analyse aller 6 Bilder ohne Fehler", st.startsWith("6 Bild(er) analysiert") && st.includes("1 Gruppe(n) sehr ähnlicher Bilder"));
  check("Unscharfes Bild erkannt (Schärfe = Varianz des Laplace-Operators)", row(103)[2].startsWith("unscharf") && row(101)[2].startsWith("scharf") && st.includes("1 unscharf"));
  check("Kontrastarmes Bild erkannt", row(104)[3].startsWith("kontrastarm") && !row(101)[3].startsWith("kontrastarm"));
  check("Leerer Rand erkannt (breiter weißer Rand um den Inhalt)", /\d+ % Rand/.test(row(101)[4]) && !$("cv-crop-all-btn").disabled && /zuschneiden \(\d+\)/.test($("cv-crop-all-btn").textContent));
  check("Sehr ähnliche Bilder: verkleinerte JPEG-Kopie (dup.png) mit dem Original in einer Gruppe, mit Abweichung in %; Screens mit anderem Inhalt nicht", /^Gruppe 1: dup\.png/.test(row(101)[5]) && /^Gruppe 1 \(Abweichung (< )?[\d,]+ %\): sharp\.png/.test(row(102)[5]) && row(103)[5] === "–" && row(104)[5] === "–" && row(105)[5] === "–");
  check("Gleicher Screen mit kleiner Markierung (4×4 Pixel) gilt als sehr ähnlich (mögliche Dublette, bitte prüfen)", /^Gruppe 1 \(Abweichung (< )?[\d,]+ %\): /.test(row(106)[5]));
  check("Angezeigte Abweichung liegt innerhalb der Grenze (höchstens 0,2 %)", Array.from(doc.querySelectorAll("#cv-tbody tr")).every((tr) => { const m = /Abweichung (?:< )?([\d,]+) %/.exec(tr.children[5].textContent); return !m || parseFloat(m[1].replace(",", ".")) <= 0.2; }));
  s = await session();
  const i1 = s.uploadedImages.find((i) => i.id === 101);
  check("Größe aus der Analyse angezeigt (300 × 200)", row(101)[1] === "300 × 200");
  check("Ergebnis je Bild gespeichert (Schärfe, Kontrast, Rand, Fingerabdruck)", i1.cvSharp > 60 && i1.cvContrast > 20 && i1.cvBorder && i1.cvHash.length === 256 && i1.cvDupGroup);

  // Zuschneiden + Wiederherstellen
  const b = i1.cvBorder;
  doc.querySelector('[data-cv-crop="101"]').click();
  await waitUntil(() => row(101) && row(101)[4] === "zugeschnitten", 8000);
  s = await session();
  const c1 = s.uploadedImages.find((i) => i.id === 101);
  const d = await dims(c1.dataUrl);
  check("Zuschneiden: Bild auf den Inhalt verkleinert, Original aufbewahrt", d[0] === b.w && d[1] === b.h && d[0] < 300 && d[1] < 200 && c1.cvUncropped === IMAGES.sharp);
  doc.querySelector('[data-cv-restore="101"]').click(); await wait(50);
  s = await session();
  const r1 = s.uploadedImages.find((i) => i.id === 101);
  check("Original wiederherstellen", r1.dataUrl === IMAGES.sharp && !r1.cvUncropped);

  // OCR mit OpenCV-Vorverarbeitung
  const ocrBtn = () => doc.querySelector('.image-ocr-btn[data-id="105"]');
  ocrBtn().click();
  await waitUntil(() => ocrInputs.length === 1, 8000);
  check("OCR ohne Vorverarbeitung: Originalbild", ocrInputs[0] === IMAGES.text);
  $("cv-ocr-pre").checked = true; fire($("cv-ocr-pre"), "change");
  await wait(50);
  await waitUntil(() => ocrBtn() && !ocrBtn().disabled, 5000);
  ocrBtn().click();
  await waitUntil(() => ocrInputs.length === 2, 8000);
  const pre = await loadImage(ocrInputs[1]), pc = createCanvas(pre.width, pre.height), px = pc.getContext("2d");
  px.drawImage(pre, 0, 0);
  const data = px.getImageData(0, 0, pre.width, pre.height).data, colors = new Set();
  for (let i = 0; i < data.length; i += 4) colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
  const white = Array.from(colors).includes("255,255,255"), dark = Array.from(colors).includes("0,0,0");
  check("OCR mit Vorverarbeitung: doppelte Größe, nur Schwarz/Weiß, heller Hintergrund", pre.width === 320 && pre.height === 80 && colors.size === 2 && white && dark);
  s = await session();
  check("Einstellung in der Sitzung gespeichert", s.cvSettings && s.cvSettings.ocrPre === true);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
