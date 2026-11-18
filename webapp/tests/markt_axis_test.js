// v2.196.0: Markt als eigene Achse wie Sparte – Stammdaten-Kategorie „Markt“ (Vorgabe Deutschland/Österreich/Schweiz,
// auch bei älteren Sitzungen ergänzt), Ticket-Filter „Alle Märkte“ / je Markt in der Verarbeitung (wie Sparte), FINAL mit
// Auswahllisten statt Freitext; die Rolle „Markt“ bleibt unverändert.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];

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
    fire(imp, "change");
    if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 15000)) fire($("confirm-modal-ok-btn"), "click");
    await waitUntil(() => $("confirm-modal-overlay").hidden, 5000);
    await wait(400);
  }

  // ===================== Stammdaten =====================
  let s = await session();
  const markt = (labels) => labels.filter((l) => l.category === "Markt").map((l) => l.de);
  check("Stammdaten: Kategorie „Markt“ mit Deutschland/Österreich/Schweiz", markt(s.labels).join("|") === "Deutschland|Österreich|Schweiz");
  check("Rolle „Markt“ bleibt in der Kategorie Rolle", s.labels.some((l) => l.category === "Rolle" && l.de === "Markt"));
  s.labels = s.labels.filter((l) => l.category !== "Markt");
  await load(s);
  s = await session();
  check("Ältere Sitzung ohne Kategorie „Markt“: Kategorie wird beim Laden ergänzt", markt(s.labels).length === 3);
  s.labels = s.labels.filter((l) => !(l.category === "Markt" && l.de === "Schweiz")).concat([{ category: "Markt", de: "Italien", en: "Italy" }]);
  await load(s);
  s = await session();
  check("Eigene Markt-Stammdaten bleiben erhalten (nicht überschrieben)", markt(s.labels).join("|") === "Deutschland|Österreich|Italien");

  // ===================== Ticket-Filter in der Verarbeitung =====================
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>MK-1</key><summary>Vertrag in Österreich anlegen</summary><description>Nur für den Markt Österreich.</description><status>Offen</status></item>
    <item><key>MK-2</key><summary>Vertrag in Deutschland anlegen</summary><description>Gilt für Deutschland.</description><status>Offen</status></item>
    <item><key>MK-3</key><summary>Allgemeine Änderung</summary><description>Ohne Marktbezug.</description><status>Offen</status></item>
  </channel></rss>`;
  nav("import");
  const input = $("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "markt.xml", { type: "text/xml" })], configurable: true });
  fire(input, "change");
  await wait(500);
  nav("verarbeitung"); await wait(100);
  const radios = () => Array.from(doc.querySelectorAll('input[type="radio"][name$="-markt"]'));
  check("Verarbeitung: Markt-Auswahl wie Sparte („Alle Märkte“ voreingestellt + Märkte aus den Stammdaten)", radios().length >= 4 &&
    radios().filter((r) => r.value === "markt:").every((r) => r.checked) && radios().some((r) => r.value === "markt:Italien"));
  const at = radios().find((r) => r.value === "markt:Österreich");
  at.checked = true; fire(at, "change"); await wait(100);
  const note = () => doc.body.textContent.match(/aktiv: [^\n]*?\((\d+) Tickets\)/);
  check("Filter Österreich: nur das Österreich-Ticket", /Markt: Österreich/.test(doc.body.textContent) && note() && note()[1] === "1");
  s = await session();
  check("Markt-Filter wird in der Sitzung gespeichert", Array.isArray(s.activeMarktFilter) && s.activeMarktFilter[0] === "Österreich");
  await load(s); nav("verarbeitung"); await wait(100);
  check("Nach dem Laden bleibt „Österreich“ gewählt", radios().some((r) => r.value === "markt:Österreich" && r.checked));
  const all = radios().find((r) => r.value === "markt:");
  all.checked = true; fire(all, "change"); await wait(100);
  check("„Alle Märkte“: kein Markt-Filter mehr, wieder alle Tickets", (await session()).activeMarktFilter.length === 0 && radios().some((r) => r.value === "markt:" && r.checked) && !(note() && /Markt:/.test(note()[0])));

  // ===================== FINAL =====================
  nav("final"); await wait(100);
  const opts = (id) => Array.from($(id).options).map((o) => o.value + "=" + o.textContent).join("|");
  check("FINAL: Markt als Auswahlliste (Quelldatei, Screens-Datei, Filter)", ["final-manual-markt-select", "final-screens-markt-select", "final-filter-markt-select"].every((id) => $(id) && $(id).tagName === "SELECT" && opts(id) === "=Alle Märkte|Deutschland=Deutschland|Österreich=Österreich|Italien=Italien"));
  $("final-filter-markt-select").value = "Deutschland"; fire($("final-filter-markt-select"), "change"); await wait(20);
  s = await session();
  check("FINAL-Markt-Filter gespeichert", s.final.filterMarkt === "Deutschland");
  s.final.filterMarkt = "UK"; // älterer Freitext-Wert, nicht in den Stammdaten
  await load(s); nav("final"); await wait(100);
  check("Älterer Freitext-Wert bleibt wählbar und gewählt", $("final-filter-markt-select").value === "UK" && opts("final-filter-markt-select").includes("UK=UK"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
