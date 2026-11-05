// v2.162.0 OpenCV-Prüfung beim Hochladen im Register Bilder: Schärfe/Kontrast/Rand der neuen Bilder und Abgleich mit dem
// Bildarchiv („schon im Archiv“ → gemeinsame Gruppe für „Sehr ähnliche Bilder bereinigen“); Schalter gemeinsam mit dem
// Screens-Import; Gruppen aus dem Screens-Import („I1“) funktionieren in der Bereinigung. Echtes OpenCV.js.
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

  const upload = async (files) => {
    const input = $("image-file-input");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fire(input, "change");
  };
  const fileOf = (url, name) => { const b64 = url.split(",")[1]; return new win.File([Buffer.from(b64, "base64")], name, { type: /jpeg/.test(url) ? "image/jpeg" : "image/png" }); };
  const note = () => $("images-cv-note").textContent;
  const findImg = async (name) => (await session()).uploadedImages.find((i) => i.filename === name);

  // Archiv: sharp + flat, analysiert
  let s = await session();
  s.uploadedImages = [{ id: 101, filename: "archiv_maske.png", dataUrl: IMAGES.sharp, mimeType: "image/png" }, { id: 102, filename: "archiv_flach.png", dataUrl: IMAGES.flat, mimeType: "image/png" }];
  // v2.172: bestehende Gruppe „I7“ aus einem früheren Screens-Import (zwei andere Bilder) darf nicht getroffen werden
  s.uploadedImages.push({ id: 103, filename: "alt_a.png", dataUrl: IMAGES.text, mimeType: "image/png", cvDupGroup: "I7" }, { id: 104, filename: "alt_b.png", dataUrl: IMAGES.text, mimeType: "image/png", cvDupGroup: "I7" });
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change");
  if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 10000)) fire($("confirm-modal-ok-btn"), "click");
  await wait(500);
  nav("bilder"); await wait(30);
  check("Schalter „Beim Hochladen mit OpenCV prüfen“ standardmäßig an, wie im Screens-Import", $("images-cv-check").checked && $("editor-cv-check").checked && $("images-cv-note").hidden);
  $("cv-analyze-btn").click();
  await waitUntil(() => /analysiert/.test($("cv-status").textContent), 20000);

  // Upload: Kopie des Archivbilds (JPEG, verkleinert), unscharfes Bild, neues Bild
  await upload([fileOf(IMAGES.dup, "kopie.jpg"), fileOf(IMAGES.blurry, "unscharf.png"), fileOf(screen({ layout: 2, bar: "#b45309" }), "neu.png")]);
  await waitUntil(() => /^OpenCV-Prüfung:/.test(note()), 20000);
  console.log("   " + note());
  check("Hinweis nach dem Hochladen: 3 Bilder, 1 unscharf (mit Name)", /^OpenCV-Prüfung: 3 Bild\(er\) – 1 unscharf/.test(note()) && /\(unscharf\.png\)/.test(note()));
  check("Kopie erkannt: „1 schon im Archiv (kopie.jpg ≈ archiv_maske.png, Abweichung … %)“", /1 schon im Archiv \(kopie\.jpg ≈ archiv_maske\.png, Abweichung (< )?[\d,]+ %\)/.test(note()));
  check("Knopf „→ Sehr ähnliche Bilder bereinigen“ im Hinweis", !!$("images-cv-note").querySelector("[data-images-cv-dups]"));
  const kopie = await findImg("kopie.jpg"), archiv = await findImg("archiv_maske.png"), neu = await findImg("neu.png");
  check("Kopie und Archivbild in derselben Gruppe, neues Bild ohne Gruppe", kopie.cvDupGroup && kopie.cvDupGroup === archiv.cvDupGroup && !neu.cvDupGroup);
  check("v2.172: neue Gruppennummer nach der höchsten vorhandenen (nicht wieder 1/„I1“), fremde Gruppe unberührt", /^\d+$/.test(String(kopie.cvDupGroup)) && +kopie.cvDupGroup !== 7);
  check("Bereinigung zeigt die Gruppe mit Kopie und Archivbild", !$("cv-dup-wrap").hidden && !!doc.querySelector('#cv-dup-list [data-cv-dup-img="' + kopie.id + '"]') && !!doc.querySelector('#cv-dup-list [data-cv-dup-img="101"]'));
  check("Neue Bilder sind analysiert (Ergebnis je Bild)", kopie.cvAt && neu.cvAt && neu.cvHash);
  const log = (await session()).log.map((l) => l.message).join("\n");
  check("Protokoll-Eintrag", /OpenCV-Prüfung beim Hochladen – 3 Bild\(er\), 1 unscharf, \d+ kontrastarm, \d+ mit leerem Rand, 1 schon im Archiv/.test(log));

  // Bereinigen: Kopie entfernen (Archivbild hat mehr Aufloesung → vorgewaehlt)
  const g = doc.querySelector('#cv-dup-list [data-cv-dup-img="101"]').closest("[data-cv-dup-group]").getAttribute("data-cv-dup-group");
  doc.querySelector('[data-cv-dup-merge="' + g + '"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /Gruppe .*entfernt/.test($("cv-status").textContent), 5000);
  s = await session();
  check("Bereinigen entfernt die hochgeladene Kopie, Archivbild bleibt", !s.uploadedImages.some((i) => i.filename === "kopie.jpg") && s.uploadedImages.some((i) => i.id === 101));

  // Schalter aus → keine Pruefung; Schalter gemeinsam mit Screens-Import und in der Sitzung
  $("images-cv-check").checked = false; fire($("images-cv-check"), "change");
  check("Schalter gilt auch für den Screens-Import", !$("editor-cv-check").checked);
  $("images-cv-note").hidden = true;
  await upload([fileOf(IMAGES.text, "aus.png")]);
  await wait(600);
  check("Ausgeschaltet: keine Prüfung, kein Hinweis", $("images-cv-note").hidden && !(await findImg("aus.png")).cvAt);
  s = await session();
  check("Einstellung in der Sitzung", s.cvSettings.importCheck === false);

  // Gruppen aus dem Screens-Import ("I1") in der Bereinigung
  s.uploadedImages.forEach((i) => { i.cvDupGroup = null; });
  s.uploadedImages.find((i) => i.filename === "neu.png").cvDupGroup = "I1";
  s.uploadedImages.find((i) => i.filename === "unscharf.png").cvDupGroup = "I1";
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s2.json")], configurable: true });
  fire(imp, "change");
  if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 10000)) fire($("confirm-modal-ok-btn"), "click");
  await wait(500);
  nav("bilder"); await wait(50);
  check("Gruppe „I1“ aus dem Screens-Import wird angezeigt (vorher Absturz durch Zahl-Umwandlung)", !$("cv-dup-wrap").hidden && !!doc.querySelector('[data-cv-dup-group="I1"]') && $("cv-dup-count").textContent === "1");
  doc.querySelector('[data-cv-dup-merge="I1"]').click();
  await waitUntil(() => !$("confirm-modal-overlay").hidden, 5000);
  fire($("confirm-modal-ok-btn"), "click");
  await waitUntil(() => /Gruppe I1: 1 Bild\(er\) entfernt/.test($("cv-status").textContent), 5000);
  check("Gruppe „I1“ lässt sich bereinigen", /Gruppe I1: 1 Bild\(er\) entfernt/.test($("cv-status").textContent) && $("cv-dup-wrap").hidden);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
