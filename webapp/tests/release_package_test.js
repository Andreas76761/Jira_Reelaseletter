// v2.133.0 Release-Paket (VARIANTE Schritt 5): Releaseletter je Rolle + Benutzerhandbuch-Varianten +
// Uebersichten in einer ZIP, Ordner je Rolle oder je Dokumentart, LIESMICH.md mit Inhalt und Hinweisen
// (fehlende Gegenstuecke, Status, veraltet), Vorschau der Dateiliste.
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  // Basis-Stand ueber Sitzung
  savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length > 0, 5000);
  const ses = JSON.parse(savedFiles[0].data);
  ses.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: "Verträge anlegen.", screenIds: [] }, { title: "Kapitel 2: Kunden", level: 1, text: "Kunden pflegen.", screenIds: [] }] }];
  ses.final.activeVersionId = 1;
  const si = $("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
  fire(si, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  // Tickets
  const item = (key, summary, labels) => "<item><key>" + key + "</key><summary>" + summary + "</summary><status>Fertig</status>" + (labels.length ? "<labels>" + labels.map((l) => "<label>" + l + "</label>").join("") + "</labels>" : "") + "</item>";
  nav("import");
  const input = $("file-input");
  Object.defineProperty(input, "files", { value: [new win.File(['<?xml version="1.0"?><rss><channel>' + item("ONESCM-1", "Vertragsänderung online", ["Retail"]) + item("ONESCM-2", "Freigabe Kampagnen", ["MO"]) + "</channel></rss>"], "t.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("stat-tickets").textContent === "2", 5000);

  nav("variante");
  check("Schritt 5 Release-Paket vorhanden, Zähler 0/0", !!$("paket-step") && $("paket-rl-count").textContent === "0" && $("paket-variant-count").textContent === "0" && $("paket-build-btn").disabled);
  fire($("paket-preview-btn"), "click");
  check("Leeres Paket: Hinweis, Download gesperrt", $("paket-status").textContent.startsWith("Noch nichts für das Paket vorhanden") && $("paket-build-btn").disabled);

  // Releaseletter je Rolle
  nav("releaseletter");
  $("releaseletter-keys").value = "ONESCM-1\nONESCM-2"; $("releaseletter-use-filtered").checked = false; $("releaseletter-name").value = "2026.5";
  ["Markt", "HQ"].forEach((t) => { const c = doc.querySelector('[data-rl-role="' + t + '"]'); c.checked = false; fire(c, "change"); });
  $("rl-roles-lang-en").checked = true;
  fire($("rl-roles-generate-btn"), "click");
  // Varianten
  nav("variante");
  for (const r of ["Retail", "MO"]) { setVal("variante-new-role", r); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click"); }
  fire($("variante-generate-all-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.includes("Variante(n) erzeugt"), 8000);
  check("Zähler: 4 Releaseletter, 2 Varianten", $("paket-rl-count").textContent === "4" && $("paket-variant-count").textContent === "2" && $("paket-name").placeholder === "z. B. 2026.5");

  fire($("paket-preview-btn"), "click");
  const paths = () => Array.from(doc.querySelectorAll("#paket-list-tbody tr")).map((r) => r.firstChild.textContent);
  check("Vorschau je Rolle: Ordner Retail/MO, Übersichten, LIESMICH", JSON.stringify(paths()) === JSON.stringify([
    "Retail/2026_5_Releaseletter_Retail_DE.docx", "Retail/2026_5_Releaseletter_Retail_EN.docx", "MO/2026_5_Releaseletter_MO_DE.docx", "MO/2026_5_Releaseletter_MO_EN.docx",
    "Retail/2026_5_Benutzerhandbuch_Retail_DE.docx", "MO/2026_5_Benutzerhandbuch_MO_DE.docx", "Uebersichten/2026_5_Varianten_Uebersicht.xlsx", "Uebersichten/2026_5_Tickets_je_Rolle.xlsx", "LIESMICH.md"]));
  const st = $("paket-status").textContent;
  check("Hinweise: EN-Releaseletter ohne Handbuch, Status Entwurf", st.startsWith("Paket „2026.5“: 9 Datei(en) · 4 Hinweis(e)") && st.includes("Retail EN: Releaseletter vorhanden, aber kein Benutzerhandbuch.") && st.includes("Benutzerhandbuch MO DE hat den Status „Entwurf“."));
  check("Download aktiv", !$("paket-build-btn").disabled);

  savedFiles.length = 0;
  fire($("paket-build-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 15000);
  const zz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const names = Object.keys(zz.files).filter((n) => !zz.files[n].dir).sort();
  check("ZIP: Dateiname und 9 Dateien", /^2026_5_Release-Paket_.*\.zip$/.test(savedFiles[0].filename) && names.length === 9 && names.includes("LIESMICH.md") && names.includes("MO/2026_5_Benutzerhandbuch_MO_DE.docx"));
  const rlx = await (await JSZipNode.loadAsync(await zz.file("Retail/2026_5_Releaseletter_Retail_DE.docx").async("nodebuffer"))).file("word/document.xml").async("string");
  const hbx = await (await JSZipNode.loadAsync(await zz.file("Retail/2026_5_Benutzerhandbuch_Retail_DE.docx").async("nodebuffer"))).file("word/document.xml").async("string");
  check("Inhalte: Retail-Releaseletter mit ONESCM-1, Handbuch mit Kapiteln", rlx.includes("ONESCM-1") && rlx.includes("Änderungen für andere Rollen") && hbx.includes("1 Verträge"));
  const readme = await zz.file("LIESMICH.md").async("string");
  check("LIESMICH: Tabelle mit Dateien und Hinweisen, ohne interne Mitteilungen", readme.startsWith("# Release-Paket 2026.5") && readme.includes("| Retail/2026_5_Benutzerhandbuch_Retail_DE.docx | Benutzerhandbuch | Retail | DE |") &&
    readme.includes("## Hinweise") && readme.includes("- MO EN: Releaseletter vorhanden, aber kein Benutzerhandbuch.") && readme.includes("Interne Mitteilungen und Prüfberichte sind nicht Teil"));
  check("Status nach Download", $("paket-status").textContent.startsWith("Release-Paket „2026_5_Release-Paket_") && $("paket-status").textContent.includes("9 Dateien"));

  // je Dokumentart + Markdown + eigener Name
  setVal("paket-name", "Herbst-Release");
  $("paket-inc-rl-md").checked = true; fire($("paket-inc-rl-md"), "change");
  setVal("paket-group", "type");
  check("Je Dokumentart: Ordner Releaseletter/Benutzerhandbuch, Markdown dazu, eigener Name", paths().includes("Releaseletter/Herbst-Release_Releaseletter_Retail_DE.docx") && paths().includes("Releaseletter/Herbst-Release_Releaseletter_Retail_DE.md") &&
    paths().includes("Benutzerhandbuch/Herbst-Release_Benutzerhandbuch_MO_DE.docx") && paths().length === 13);
  // Veraltet
  const cbx = Array.from(doc.querySelectorAll("[data-vr-map]"))[1];
  setVal("variante-domain-new-input", "Kunden"); fire($("variante-domain-add-btn"), "click");
  const sel = Array.from(doc.querySelectorAll("[data-vr-map]"))[1]; sel.value = "Kunden"; fire(sel, "change");
  const off = Array.from(doc.querySelectorAll('#variante-matrix-tbody [data-vm-kind="dom"]')).find((c) => c.getAttribute("data-vm-key") === "Kunden" && c.getAttribute("data-vm-role") === "MO");
  off.checked = false; fire(off, "change");
  fire($("paket-preview-btn"), "click");
  const moRow = Array.from(doc.querySelectorAll("#paket-list-tbody tr")).find((r) => r.firstChild.textContent.includes("Benutzerhandbuch_MO"));
  check("Veraltete Variante im Paket markiert", moRow.textContent.includes("⚠ veraltet: Matrix/Optionen geändert") && $("paket-status").textContent.includes("Benutzerhandbuch MO DE ist veraltet"));
  // nur Uebersichten abwaehlen etc.
  ["paket-inc-rl", "paket-inc-variants", "paket-inc-overview"].forEach((id) => { $(id).checked = false; fire($(id), "change"); });
  check("Nichts gewählt: Hinweis, Download gesperrt", $("paket-build-btn").disabled && $("paket-status").textContent.startsWith("Noch nichts"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RELEASE-PAKET-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
