// v2.157.0 (1) Label "Neu" verschwindet nach dem Oeffnen des Registers, (2) Screens-Import prueft neue Screens mit OpenCV,
// (3) Release-Paket: Vorpruefung (Jira-Nummern, offene Bild-Platzhalter, unscharfe/ungepruefte Bilder) – echtes OpenCV.
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
const BLUR = screen({ blur: true, layout: 1 });
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + t + "</w:t></w:r></w:p>";
const IMG = (rid) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rid + '"/></w:drawing></w:r></w:p>';
async function screensDocx(list) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + list.map((x, i) => H(x[0]) + IMG("rId" + (i + 1))).join("") + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map((x, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (i + 1) + '.png"/>').join("") + "</Relationships>");
  list.forEach((x, i) => z.file("word/media/image" + (i + 1) + ".png", Buffer.from(x[1].split(",")[1], "base64")));
  return z.generateAsync({ type: "nodebuffer" });
}

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
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 5000); return JSON.parse(savedFiles[0].data); }
  const hasNew = (v) => !!doc.querySelector('.nav-item[data-view="' + v + '"] .nav-new');

  // (1) Neu-Label
  check("Neu an Bilder und Dashboard nach dem Start (das automatisch geöffnete Dashboard zählt nicht als Besuch)", hasNew("bilder") && hasNew("dashboard"));
  nav("bilder"); await wait(20);
  check("Nach dem Öffnen von Bilder: Label weg, im Browser gemerkt", !hasNew("bilder") && JSON.parse(win.localStorage.getItem("ticketCockpit.navSeen")).bilder.includes("OpenCV") && hasNew("agent"));

  // (2) Screens-Import mit OpenCV-Pruefung
  nav("editor"); await wait(20);
  check("Option „Screens beim Import mit OpenCV prüfen“ standardmäßig an", $("editor-cv-check").checked);
  setFiles($("editor-file-input"), [new win.File([await screensDocx([["Vertragsmaske scharf", SHARP], ["Vertragsmaske unscharf", BLUR]])], "screens.docx")]);
  await waitUntil(() => /OpenCV-Prüfung „/.test($("editor-cv-note").textContent), 20000);
  const note = $("editor-cv-note").textContent;
  console.log("   " + note);
  check("Hinweis nach dem Import: 2 Screens geprüft, 1 unscharf (mit Nr.), Sprung ins Register Bilder", note.includes("2 Screen(s)") && note.includes("1 unscharf") && note.includes("Nr. 2") && !!$("editor-cv-note").querySelector("[data-editor-cv-goto]"));
  const rowTxt = Array.from(doc.querySelectorAll("#editor-screens-tbody tr")).map((r) => r.textContent);
  check("Screens-Tabelle: unscharfer Screen gekennzeichnet, scharfer nicht", rowTxt.some((t) => t.includes("Vertragsmaske unscharf") && t.includes("unscharf") && /unscharf.*unscharf/.test(t)) && rowTxt.some((t) => t.includes("Vertragsmaske scharf") && !/scharfunscharf|\bunscharf\b(?!.*Vertragsmaske)/.test(t.replace("Vertragsmaske unscharf", ""))));
  $("editor-cv-check").checked = false; fire($("editor-cv-check"), "change");
  let s = await session();
  check("Option in der Sitzung gespeichert (aus)", s.cvSettings.importCheck === false);
  const blurId = s.uploadedImages.find((i) => i.description === "Vertragsmaske unscharf").id;
  const before = $("editor-cv-note").textContent;
  setFiles($("editor-file-input"), [new win.File([await screensDocx([["Weitere Maske", SHARP]])], "weitere.docx")]);
  await waitUntil(() => doc.querySelectorAll("#editor-screens-tbody tr").length === 3, 8000); await wait(200);
  check("Option aus: keine Prüfung beim nächsten Import", $("editor-cv-note").textContent === before);

  // (3) Release-Paket: Vorpruefung
  s = await session();
  s.uploadedImages.push({ id: 900, filename: "ungeprueft.png", dataUrl: SHARP, description: "Ungeprüft", mimeType: "image/png", sourceFile: "x.docx" });
  s.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Veröffentlicht", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "1 Verträge", level: 1, text: "Verträge werden angelegt (ONESCM-5).\n[Bild]\n[Bild]", screenIds: [blurId] }] }];
  s.final.activeVersionId = 1;
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Freigegeben", source: "Upload", lang: "DE", chapters: [{ title: "1 Storno", level: 1, text: "Text.\n[Bild: Storno]\n[Bild: Bestätigung]" }], ph: { "0:0": [900] }, checks: {}, steps: {}, history: [], changes: [] }], activeId: 1 };
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("variante"); await wait(30);
  const sj = $("variante-opt-strip-jira"); sj.checked = false; fire(sj, "change");
  $("variante-new-role").value = "Retail"; fire($("variante-new-role"), "change"); $("variante-new-lang").value = "DE"; fire($("variante-new-lang"), "change");
  fire($("variante-add-btn"), "click");
  fire($("variante-generate-all-btn"), "click");
  await waitUntil(() => /erzeugt/.test($("variante-status").textContent), 10000);
  ["paket-inc-variants", "paket-inc-review"].forEach((id) => { $(id).checked = true; });
  fire($("paket-preview-btn"), "click"); await wait(50);
  const st = $("paket-status").textContent, rows = Array.from(doc.querySelectorAll("#paket-list-tbody tr")).map((r) => r.textContent);
  console.log("   " + st);
  check("Vorprüfung Variante: Jira-Nummer, offener Platzhalter, unscharfes Bild", st.includes("Vorprüfung Benutzerhandbuch Retail DE: 1 Jira-Nummer(n), 1 offene(r) Bild-Platzhalter, 1 unscharfe(s) Bild(er)."));
  check("Vorprüfung Review-Dokument: offener Platzhalter (Jira entfernt die Verteilfassung selbst)", st.includes("Vorprüfung Dokument „Handbuch“ v1.0: 1 offene(r) Bild-Platzhalter."));
  check("Hinweis je Datei in der Paket-Liste", rows.some((r) => r.includes("Benutzerhandbuch") && r.includes("⚠ Vorprüfung")) && rows.some((r) => r.includes("Dokument (Review)") && r.includes("1 Bild(er) nicht mit OpenCV geprüft")));
  check("Ungeprüfte Bilder: Hinweis und Knopf „Bilder mit OpenCV prüfen (1)“", st.includes("1 Bild(er) der Paket-Dokumente noch nicht mit OpenCV geprüft") && !$("paket-cv-btn").hidden && $("paket-cv-btn").textContent.includes("(1)"));
  $("paket-cv-btn").click();
  await waitUntil(() => $("paket-cv-btn").hidden, 15000);
  check("Nach der Prüfung: Knopf weg, Hinweis auf ungeprüfte Bilder weg", !$("paket-status").textContent.includes("noch nicht mit OpenCV geprüft"));
  savedFiles.length = 0;
  fire($("paket-build-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 15000);
  const z = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const readme = await z.file("LIESMICH.md").async("string");
  check("LIESMICH.md enthält die Vorprüfung", readme.includes("Vorprüfung Benutzerhandbuch Retail DE: 1 Jira-Nummer(n)") && readme.includes("Vorprüfung Dokument „Handbuch“ v1.0"));

  check("Statuszeile ohne doppelten Punkt", !/\.\.$/.test($("paket-status").textContent) && !st.endsWith(".."));
  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
