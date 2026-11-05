// v2.167.0 OpenCV und SVG: SVG ohne width/height bekommt die Größe aus der viewBox, wird beim Hochladen geprüft
// (Kontrast, sehr ähnliche Bilder / schon im Archiv), gilt nie als „unscharf“, wird nie zugeschnitten und von
// „Speicher sparen“ nie in ein Rasterbild umgewandelt.
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
// node-canvas kann SVG ohne width/height nicht als <img> anzeigen (Browser schon) – betrifft nur die Vorschaubilder der Galerie
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i) && !/^Could not load img: "data:image\/svg/.test(String(e.message))) errors.push(e.message); });
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

  const upload = async (files) => {
    const input = $("image-file-input");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fire(input, "change");
  };
  const note = () => $("images-cv-note").textContent;
  const findImg = async (name) => (await session()).uploadedImages.find((i) => i.filename === name);
  // grosse Diagramm-SVG mit breitem Rand, ohne width/height; dazu eine weiche (unscharf wirkende) Grafik
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3000 2000"><rect width="3000" height="2000" fill="#ffffff"/>' +
    Array.from({ length: 12 }, (_, i) => '<rect x="' + (600 + (i % 4) * 450) + '" y="' + (500 + Math.floor(i / 4) * 330) + '" width="380" height="200" rx="20" fill="#0e7490"/><text x="' + (620 + (i % 4) * 450) + '" y="' + (610 + Math.floor(i / 4) * 330) + '" font-size="60" fill="#fff">Schritt ' + (i + 1) + "</text>").join("") + "</svg>";
  const SOFT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g"><stop offset="0" stop-color="#e5e7eb"/><stop offset="1" stop-color="#d1d5db"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/></svg>';
  const svgFile = (txt, name) => new win.File([txt], name, { type: "image/svg+xml" });

  nav("bilder"); await wait(30);
  await upload([svgFile(SVG, "prozess.svg"), svgFile(SOFT, "verlauf.svg")]);
  await waitUntil(() => /^OpenCV-Prüfung:/.test(note()) || /nicht möglich/.test(note()), 30000);
  console.log("   " + note());
  check("SVGs werden beim Hochladen geprüft (2 Bilder, keine als unscharf)", /^OpenCV-Prüfung: 2 Bild\(er\) – 0 unscharf/.test(note()));
  let p = await findImg("prozess.svg"), v = await findImg("verlauf.svg");
  check("Analyse ohne Fehler, Größe aus der viewBox (3000 × 2000), als Vektorgrafik markiert", p.cvAt && !p.cvError && p.cvW === 3000 && p.cvH === 2000 && p.cvVector === true && p.cvHash);
  check("Kein leerer Rand zum Zuschneiden bei Vektorgrafik (Rand wäre vorhanden)", p.cvBorder == null && v.cvBorder == null);
  check("Weiche SVG wird nicht als unscharf gewertet", v.cvVector && v.cvSharp != null && v.cvSharp < 60);
  check("Zuschneiden-Knopf gesperrt (nichts zuzuschneiden)", $("cv-crop-all-btn").disabled);

  // gleiche SVG nochmals hochladen → schon im Archiv
  await upload([svgFile(SVG, "prozess_kopie.svg")]);
  await waitUntil(() => /schon im Archiv \(prozess_kopie/.test(note()), 30000);
  check("Gleiche SVG erneut hochgeladen: „1 schon im Archiv (prozess_kopie.svg ≈ prozess.svg …)“", /1 schon im Archiv \(prozess_kopie\.svg ≈ prozess\.svg, Abweichung/.test(note()));

  // Speicher sparen: SVG bleibt unveraendert
  const before = (await findImg("prozess.svg")).dataUrl;
  $("cv-shrink-edge").value = "1280"; fire($("cv-shrink-edge"), "change");
  $("cv-shrink-btn").click();
  await waitUntil(() => /^Nichts zu sparen/.test($("cv-shrink-status").textContent) || !$("confirm-modal-overlay").hidden, 30000);
  check("„Speicher sparen“ lässt SVGs aus (3000 px breit, trotzdem nichts zu sparen)", /^Nichts zu sparen: 3 Bild\(er\) geprüft/.test($("cv-shrink-status").textContent) && $("confirm-modal-overlay").hidden);
  p = await findImg("prozess.svg");
  check("SVG unverändert (kein Rasterbild)", p.dataUrl === before && /^data:image\/svg/.test(p.dataUrl));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
