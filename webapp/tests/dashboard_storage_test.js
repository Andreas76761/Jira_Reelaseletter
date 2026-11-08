// v2.147.0 Dashboard: je Register Anzahl Einträge, belegter Speicher (Anteil an der Sitzung), freier Browser-Speicher
// (navigator.storage.estimate), „Platz für ca. N weitere“, Warnung bei wenig Speicher, Sprung ins Register.
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
let est = { usage: 2 * 1048576, quota: 50 * 1048576 };
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    Object.defineProperty(window.navigator, "storage", { configurable: true, value: { estimate: async () => { if (est === "throw") throw new Error("SecurityError"); return est; } } });
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const toBytes = (t) => { const m = /([\d.,]+)\s*(B|KB|MB|GB)/.exec(t); if (!m) return NaN; return parseFloat(m[1].replace(",", ".")) * { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[2]]; };

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const row = (label) => { const tr = doc.querySelector('#dash-store-tbody tr[data-dash-store-row="' + label + '"]'); return tr ? Array.from(tr.children).map((c) => c.textContent.trim()) : null; };
  const tile = (i) => doc.querySelectorAll("#dash-store-tiles .vrev-tile")[i];
  async function dash() { nav("crossx"); await wait(10); nav("dashboard"); await wait(150); }

  await dash();
  check("Tabelle mit allen 24 Registern (v2.176 inkl. Regelwerk), alle Sitzungsfelder zugeordnet (kein „Sonstiges“)", doc.querySelectorAll("#dash-store-tbody tr").length === 24 && !row("Sonstiges"));
  check("Freier Speicher aus dem Browser (48 MB von 50 MB)", tile(3).querySelector("b").textContent === "48,0 MB" && tile(2).querySelector("b").textContent === "2,00 MB" && tile(2).textContent.includes("4 % von 50,0 MB"));

  // Sitzung mit Daten in mehreren Registern
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const s = JSON.parse(savedFiles[0].data);
  s.rovoEntries = [1, 2].map((id) => ({ id, when: "", chatText: "Frage " + id, answerText: "Antwort " + "x".repeat(400), chapter: "Storno", subchapter: "", labels: ["ROVO"], jiraKeys: [], jiraVisible: false }));
  s.uploadedImages = [5, 6, 7].map((id) => ({ id, filename: "s" + id + ".png", dataUrl: PNG, description: "Maske " + id, chapter: "Storno", ocrText: "x".repeat(20000) }));
  s.rovoTables = [{ id: 1, sourceFile: "preise.docx", tableNumber: 1, chapter: "Preise", rows: [["Paket", "Preis"], ["Basis", "10 €"]] }];
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Storno", level: 1, text: "Text" }], ph: {}, checks: {}, steps: {}, history: [] }], activeId: 1 };
  s.ragLibrary = [{ id: 1, title: "A", text: "eins" }, { id: 2, title: "B", text: "zwei" }];
  const imp = $("session-import-input");
  Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
  fire(imp, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  await dash();
  const img = row("Bilder"), rk = row("Rovo Knowledge");
  check("Einträge je Register: Bilder 3, Rovo Knowledge 2, Tabelle 1, Dokument-Review 1, RAG 2", img[1] === "3" && rk[1] === "2" && row("Tabelle")[1] === "1" && row("Dokument-Review")[1] === "1" && row("Verarbeitung / RAG")[1] === "2");
  check("Größtes Register oben (Bilder ~59 KB)", doc.querySelector("#dash-store-tbody tr").getAttribute("data-dash-store-row") === "Bilder" && toBytes(img[2]) > 58000 && toBytes(img[2]) < 62000);
  // Summe passt zur Sitzungsdatei
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const fileBytes = Buffer.byteLength(savedFiles[0].data, "utf8");
  const shown = toBytes($("dash-store-tfoot").children[0].children[2].textContent);
  check("Belegt gesamt entspricht der Größe der Sitzungsdatei (±3 %)", Math.abs(shown - fileBytes) / fileBytes < 0.03);
  const avg = toBytes(img[4]), free = 48 * 1048576;
  check("Frei je Register und „Platz für ca.“ aus Ø-Größe", img[5] === "48,0 MB" && /^[\d.]+ Bilder$/.test(img[6]) && Math.abs(Number(img[6].replace(/\D/g, "")) - free / (toBytes(img[2]) / 3)) / (free / (toBytes(img[2]) / 3)) < 0.01 && Math.abs(avg - toBytes(img[2]) / 3) < 600);
  check("Leere Register: 0 Einträge, „Platz für“ –", row("CROSS_X")[1] === "0" && row("CROSS_X")[6] === "–");
  check("Kleine Anteile als „< 0,1 %“", doc.querySelectorAll("#dash-store-tbody tr").length > 0 && Array.from(doc.querySelectorAll("#dash-store-tbody tr")).some((tr) => tr.children[3].textContent.includes("< 0,1 %")));
  check("Kopfzeile fasst zusammen", /Einträge · belegt [\d,]+ KB · frei 48,0 MB/.test($("dash-store-head").textContent));
  check("Keine Warnung bei genug Speicher", $("dash-store-warn").hidden && tile(3).classList.contains("vrev-tile-ok"));

  // Wenig Speicher
  est = { usage: 1048576, quota: 1048576 + 50000 };
  $("dash-store-refresh-btn").click(); await wait(100);
  check("Wenig Speicher: Warnung und rote Kachel", !$("dash-store-warn").hidden && $("dash-store-warn").textContent.includes("Wenig freier Speicher: frei 48,8 KB") && tile(3).classList.contains("vrev-tile-fail"));
  // Browser ohne Angabe
  est = "throw";
  $("dash-store-refresh-btn").click(); await wait(100);
  check("Ohne Browser-Angabe: „unbekannt“, keine Warnung", tile(3).querySelector("b").textContent === "unbekannt" && row("Bilder")[5] === "unbekannt" && row("Bilder")[6] === "–" && $("dash-store-warn").hidden);

  // Sprung ins Register
  doc.querySelector('#dash-store-tbody [data-dash-store-open="rovoknowledge"]').click(); await wait(20);
  check("„→ öffnen“ öffnet das Register", !doc.querySelector('[data-view-panel="rovoknowledge"]').hidden);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
