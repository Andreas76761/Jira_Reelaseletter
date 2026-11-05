// v2.171.0 Einstellungen → „Selbsttest der Umgebung“: 8 Prüfungen (ZIP, PDF, Word, OpenCV mit echtem OpenCV.js, Tesseract,
// KI, Browser-Speicher mit echter IndexedDB-Implementierung, Downloads) mit ok / Hinweis / Fehler, Dauer, Bericht als Markdown.
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
  const { IDBFactory } = require("fake-indexeddb");
  const ocrSeen = [];
  let sampleMode = "ok";
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.cv = cv;
      window.indexedDB = new IDBFactory();
      window.Tesseract = { createWorker: async () => ({ recognize: async (input) => { ocrSeen.push(input); return { data: { text: "Test 123\n" } }; } }) };
      const sample = async (prompt, opts) => { if (sampleMode === "bad") return { text: "Hallo" }; return { text: "OK" }; };
      window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : name === "sample" ? sample : null) };
    },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(25); } return false; }
  await wait(600);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const row = (name) => { const tr = doc.querySelector('#selftest-tbody tr[data-selftest="' + name + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  doc.querySelector('.nav-item[data-view="einstellungen"]').click(); await wait(50);
  check("Abschnitt „Selbsttest der Umgebung“ in Einstellungen, Bericht-Knöpfe anfangs gesperrt", !!$("selftest-section") && $("selftest-copy-btn").disabled && $("selftest-md-btn").disabled && $("selftest-wrap").hidden);

  $("selftest-run-btn").click();
  await waitUntil(() => /^Selbsttest .*: \d+ ok/.test($("selftest-status").textContent), 120000);
  console.log("   " + $("selftest-status").textContent);
  doc.querySelectorAll("#selftest-tbody tr").forEach((tr) => console.log("     " + Array.from(tr.children).map((c) => c.textContent.trim()).join(" | ")));
  check("8 Prüfungen, alle ok (inkl. Downloads)", doc.querySelectorAll("#selftest-tbody tr").length === 8 && /: 8 ok, 0 Hinweis\(e\), 0 Fehler\./.test($("selftest-status").textContent));
  check("ZIP, PDF und Word erzeugt", row("ZIP-Export (JSZip)")[1] === "ok" && /PDF erzeugt/.test(row("PDF-Export (jsPDF)")[2]) && /Word-Datei erzeugt/.test(row("Word-Export (DOCX)")[2]));
  check("OpenCV analysiert ein Testbild", row("Bildprüfung (OpenCV)")[1] === "ok" && /Testbild analysiert \(Schärfe \d+\)/.test(row("Bildprüfung (OpenCV)")[2]));
  check("Tesseract erkennt den Testtext „Test 123“ (Testbild übergeben)", row("Texterkennung (Tesseract)")[1] === "ok" && /„Test 123“ erkannt/.test(row("Texterkennung (Tesseract)")[2]) && ocrSeen.length === 1 && /^data:image\/png/.test(ocrSeen[0]));
  check("KI antwortet „OK“", row("KI (Claude)")[1] === "ok" && /Antwort „OK“/.test(row("KI (Claude)")[2]));
  check("Browser-Speicher: Schreiben/Lesen ok, Testeintrag wieder entfernt", row("Browser-Speicher (automatisches Speichern)")[1] === "ok" && /Schreiben\/Lesen ok/.test(row("Browser-Speicher (automatisches Speichern)")[2]));
  check("Dauer je Prüfung angezeigt", doc.querySelectorAll("#selftest-tbody tr").length && Array.from(doc.querySelectorAll("#selftest-tbody tr")).every((tr) => /s$/.test(tr.children[3].textContent)));

  // Bericht speichern
  savedFiles.length = 0;
  $("selftest-md-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = savedFiles[0] && savedFiles[0].data;
  check("Bericht als Markdown mit Version, Browser und Tabelle", /^Selbsttest_\d{4}-\d{2}-\d{2}\.md$/.test(savedFiles[0].filename) && /# Selbsttest ONESCM Ticket-Cockpit/.test(md) && /- Version: 2\.\d+\.\d+/.test(md) && /\| Texterkennung \(Tesseract\) \| ok \|/.test(md) && /\| KI \(Claude\) \| ok \|/.test(md));

  // Fehlerfaelle: KI antwortet falsch, Tesseract fehlt, JSZip fehlt
  sampleMode = "bad";
  const realT = win.Tesseract; delete win.Tesseract;
  const realZ = win.JSZip; win.JSZip = undefined;
  $("selftest-run-btn").click();
  await waitUntil(() => /^Selbsttest .*Fehler\.$/.test($("selftest-status").textContent) && !$("selftest-run-btn").disabled, 120000);
  console.log("   " + $("selftest-status").textContent);
  check("Fehlerfälle: ZIP, Word, KI als Fehler mit Grund", row("ZIP-Export (JSZip)")[1] === "Fehler" && /JSZip nicht geladen/.test(row("ZIP-Export (JSZip)")[2]) && row("Word-Export (DOCX)")[1] === "Fehler" && row("KI (Claude)")[1] === "Fehler" && /unerwartete Antwort: „Hallo“/.test(row("KI (Claude)")[2]));
  check("Tesseract fehlt: Fehler mit Grund (weder neben der App noch aus dem Internet); PDF, OpenCV, Speicher bleiben ok", row("Texterkennung (Tesseract)")[1] === "Fehler" && /weder neben der App \(vendor\/tesseract\/\) noch aus dem Internet/.test(row("Texterkennung (Tesseract)")[2]) && row("PDF-Export (jsPDF)")[1] === "ok" && row("Bildprüfung (OpenCV)")[1] === "ok" && /: 4 ok, 0 Hinweis\(e\), 4 Fehler\./.test($("selftest-status").textContent));
  win.Tesseract = realT; win.JSZip = realZ;
  check("Protokoll-Einträge", Array.from(doc.querySelectorAll("#log-list li")).filter((li) => /Selbsttest: /.test(li.textContent)).length === 2);
  check("Navigation: Neu-Label bei Einstellungen nennt den Selbsttest", /Selbsttest/.test(doc.querySelector('.nav-item[data-view="einstellungen"]').getAttribute("aria-description") || ""));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
