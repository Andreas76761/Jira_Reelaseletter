// v2.152.0 Dokument-Review Stufe 3: Bilder fuer leere Platzhalter per KI auswaehlen (Kandidaten aus der Textaehnlichkeit,
// nur deren IDs erlaubt, hoechstens 3 je Platzhalter, im Zweifel keines).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });
const savedFiles = [];
const prompts = [];
let reply = null;
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  return { text: reply ? reply(p) : "{}" };
}
sample.json = async () => ({});
sample.limits = async () => ({ images: false });
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : name === "sample" ? sample : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const IMG = (rid) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rid + '"/></w:drawing></w:r></w:p>';
async function docx(body, n) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  let rels = "";
  for (let i = 1; i <= (n || 0); i++) { rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>'; z.file("word/media/image" + i + ".png", Buffer.concat([PNG, Buffer.from([i])])); }
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>");
  return z.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  const btn = () => $("vrev-stage").querySelector('[data-vrev-act="ph-ai"]');
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 5000); return JSON.parse(savedFiles[0].data); }

  // Review-Dokument zuerst ohne Bildarchiv
  nav("variante"); await wait(20);
  setFiles($("vrev-file-input"), [new win.File([await docx(H("1 Verträge") + P("Die Übersicht zeigt alle Verträge.") + P("[Bild: Vertragsübersicht mit Filtern]") +
    H("2 Zahlung") + P("[Bild: QR-Code für die Kartenzahlung]") + H("3 Wetter") + P("[Bild: Wetterkarte von Europa]"))], "Entwurf.docx")]);
  await waitUntil(() => doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]").length === 1, 8000);
  gotoStage(3); await wait(20);
  check("Ohne Bildarchiv: Knopf „Bilder mit KI auswählen“ gesperrt", btn() && btn().disabled);

  // Bildarchiv
  nav("editor"); await wait(20);
  setFiles($("editor-file-input"), [new win.File([await docx(H("Vertragsübersicht mit Filtern") + IMG("rId1") + H("QR-Code Kartenzahlung") + IMG("rId2") + H("Kundenliste") + IMG("rId3"), 3)], "archiv.docx")]);
  await waitUntil(() => $("editor-screens-count").textContent === "3", 8000);
  let s = await session();
  const id = (t) => s.uploadedImages.find((i) => i.description && i.description.includes(t)).id;
  const idVert = id("Vertragsübersicht"), idQr = id("QR-Code");
  nav("variante"); await wait(20); gotoStage(3); await wait(20);
  check("Mit Bildarchiv: Knopf aktiv", btn() && !btn().disabled);

  reply = (p) => {
    const ph = {};
    for (const m of p.matchAll(/PLATZHALTER (\d+): [^\n]*\n((?:  ID \d+:[^\n]*\n?)+)/g)) ph[m[1]] = [...m[2].matchAll(/ID (\d+)/g)].map((x) => Number(x[1]));
    const out = {};
    Object.keys(ph).forEach((k) => {
      const line = p.split("\n").find((l) => l.startsWith("PLATZHALTER " + k + ":"));
      out[k] = /Vertragsübersicht/.test(line) ? [idVert, 9999] : /QR-Code/.test(line) ? [idQr, idQr] : [];
    });
    return "Hier die Zuordnung:\n" + JSON.stringify(out);
  };
  btn().click();
  await waitUntil(() => /KI-Auswahl/.test($("vrev-status").textContent), 8000);
  const p = prompts[prompts.length - 1];
  check("Prompt: Regeln (höchstens 3, im Zweifel keines), Platzhalter mit Kandidaten-IDs", p.includes("MAX = 3") && p.includes("PLATZHALTER 1: 1 Verträge – Vertragsübersicht mit Filtern") && /  ID \d+: /.test(p) && p.includes("Erfinde keine IDs"));
  check("Status: 2 Platzhalter belegt, 1 ohne passendes Bild", $("vrev-status").textContent.includes("KI-Auswahl: 2 Platzhalter mit 2 Bild(ern) belegt") && $("vrev-status").textContent.includes("1 ohne passendes Bild"));
  s = await session();
  const ph = s.vrev.docs[0].ph, vals = Object.values(ph);
  check("Erfundene ID verworfen, doppelte ID nur einmal", vals.length === 2 && vals.some((v) => JSON.stringify(v) === JSON.stringify([idVert])) && vals.some((v) => JSON.stringify(v) === JSON.stringify([idQr])) && !JSON.stringify(ph).includes("9999"));
  check("Änderung im Verlauf protokolliert (Stufe 3)", s.vrev.docs[0].changes.some((c) => c.stage === 3 && c.what === "Bilder per KI ausgewählt" && c.n === 2));
  check("B1 neu bewertet: 2 von 3 Platzhaltern belegt", doc.querySelector('[data-vrev-check="B1"]').textContent.includes("2 von 3"));

  // Zweiter Lauf: nur noch der leere Platzhalter
  prompts.length = 0;
  btn().click();
  await waitUntil(() => prompts.length === 1 && /KI-Auswahl/.test($("vrev-status").textContent), 8000);
  check("Erneuter Lauf fragt nur leere Platzhalter an", (prompts[0].match(/^PLATZHALTER \d+:/gm) || []).length === 1 && prompts[0].includes("Wetterkarte"));

  // Fehlerhafte Antwort
  reply = () => "Leider kann ich das nicht.";
  btn().click();
  await waitUntil(() => /fehlgeschlagen/.test($("vrev-status").textContent), 8000);
  check("Ungültige KI-Antwort: Fehlermeldung, Zuordnung unverändert", $("vrev-status").textContent.includes("KI-Bildauswahl fehlgeschlagen") && Object.keys((await session()).vrev.docs[0].ph).length === 2);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
