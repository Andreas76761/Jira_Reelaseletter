// v2.155.0 Dokument-Review Stufe 3: Bildqualitaet der im Dokument verwendeten Bilder mit OpenCV pruefen (unscharf,
// kontrastarm, leerer Rand, sehr aehnlich zu einem anderen Bild im Dokument) – Hinweise je Bild, Zusammenfassung, Verlauf.
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
      window.JSZip = JSZipNode; window.jspdf = { jsPDF: jsPDF }; window.cv = cv;
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
  const btn = () => $("vrev-stage").querySelector('[data-vrev-act="ph-cv"]');

  let s = await session();
  s.uploadedImages = [["scharf", IMAGES.sharp], ["kopie", IMAGES.dup], ["unscharf", IMAGES.blurry], ["leer", IMAGES.flat]].map(([n, u], i) => ({ id: 201 + i, filename: n + ".png", dataUrl: u, description: n, mimeType: "image/png", sourceFile: "x.docx" }));
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Verträge", level: 1, text: "Text.\n[Bild: Übersicht]\n[Bild: Kopie der Übersicht]\n[Bild: Maske]\n[Bild: Ohne Bild]" }], ph: { "0:0": [201], "0:1": [202], "0:2": [203] }, checks: {}, steps: {}, history: [], changes: [] }], activeId: 1 };
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("variante"); await wait(30);
  $("vrev-stepper").querySelector('[data-stage="3"]').click(); await wait(30);
  check("Stufe 3: Knopf „Bildqualität mit OpenCV prüfen“ aktiv (3 Bilder im Dokument)", btn() && !btn().disabled && !doc.querySelector(".vrev-cv-sum"));
  btn().click();
  await waitUntil(() => /Bildqualität geprüft|nicht geprüft/.test($("vrev-status").textContent), 20000);
  console.log("   " + $("vrev-status").textContent);
  check("Nur die 3 im Dokument verwendeten Bilder geprüft (nicht das ungenutzte 4.)", $("vrev-status").textContent.startsWith("Bildqualität geprüft: 1 unscharf, 0 kontrastarm") && doc.querySelector(".vrev-cv-sum").textContent.includes("3 Bild(er) geprüft"));
  const rowOf = (key) => doc.querySelector('#vrev-stage tr[data-vrev-ph="' + key + '"]');
  check("Hinweis am unscharfen Bild", rowOf("0:2").querySelector(".cv-badge.cv-bad").textContent === "unscharf");
  check("Sehr ähnliche Bilder im Dokument markiert (Original und verkleinerte Kopie, gleiche Gruppe)", /^ähnlich \d+$/.test(rowOf("0:0").textContent.match(/ähnlich \d+/)[0]) && rowOf("0:0").textContent.match(/ähnlich \d+/)[0] === rowOf("0:1").textContent.match(/ähnlich \d+/)[0] && !/ähnlich/.test(rowOf("0:2").textContent));
  check("Leerer Rand angezeigt", /\d+ % Rand/.test(rowOf("0:0").textContent));
  check("Zusammenfassung mit Sprung ins Register Bilder", doc.querySelector(".vrev-cv-sum").textContent.includes("2 sehr ähnliche(s) Bild(er)") && !!doc.querySelector('[data-vrev-act="goto-bilder"]'));
  s = await session();
  check("Ergebnis und Verlauf im Dokument gespeichert", s.vrev.docs[0].cvCheck && s.vrev.docs[0].cvCheck.n === 3 && s.vrev.docs[0].changes.some((c) => c.stage === 3 && c.what === "Bildqualität mit OpenCV geprüft"));
  doc.querySelector('[data-vrev-act="goto-bilder"]').click(); await wait(20);
  check("„→ Bilder“ öffnet das Register Bilder", !doc.querySelector('[data-view-panel="bilder"]').hidden);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
