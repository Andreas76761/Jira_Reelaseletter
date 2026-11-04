// v2.131.0 Releaseletter je Rolle und Sprache: Tickets ueber Rollen-Labels zugeordnet, Tickets ohne
// Rollen-Label wahlweise fuer alle, Rollenhinweis, Abschnitt "Aenderungen fuer andere Rollen", Vorschau,
// Markdown/Word je Brief, ZIP (Word + Markdown), Excel-Uebersicht Ticket x Rolle.
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
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const item = (key, summary, labels) => "<item><key>" + key + "</key><summary>" + summary + "</summary><status>Fertig</status>" + (labels.length ? "<labels>" + labels.map((l) => "<label>" + l + "</label>").join("") + "</labels>" : "") + "</item>";
  nav("import");
  const input = $("file-input");
  const xml = '<?xml version="1.0"?><rss><channel>' + item("ONESCM-1", "Vertragsänderung online", ["Retail"]) + item("ONESCM-2", "Freigabe Kampagnen", ["MO"]) +
    item("ONESCM-3", "Neue Anmeldeseite", []) + item("ONESCM-4", "Rabattmodell erweitert", ["Retail", "HQ"]) + "</channel></rss>";
  Object.defineProperty(input, "files", { value: [new win.File([xml], "t.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("stat-tickets").textContent === "4", 5000);
  nav("releaseletter");
  $("releaseletter-keys").value = "ONESCM-1\nONESCM-2\nONESCM-3\nONESCM-4";
  $("releaseletter-use-filtered").checked = false;
  $("releaseletter-name").value = "2026.5";
  const roleCb = (t) => doc.querySelector('[data-rl-role="' + t + '"]');
  check("Bereich 'Releaseletter je Rolle' mit 5 Rollen (IT nicht vorausgewählt)", !!$("rl-roles-section") && doc.querySelectorAll("[data-rl-role]").length === 5 && roleCb("Retail").checked && !roleCb("IT").checked && $("rl-roles-zip-btn").disabled);
  roleCb("Markt").checked = false; fire(roleCb("Markt"), "change");
  $("rl-roles-lang-en").checked = true;
  fire($("rl-roles-generate-btn"), "click");
  const rows = () => Array.from(doc.querySelectorAll("#rl-roles-tbody tr")).map((r) => Array.from(r.children).slice(0, 4).map((c) => c.textContent).join("|"));
  check("3 Rollen × 2 Sprachen = 6 Releaseletter", rows().length === 6 && $("rl-roles-status").textContent === "6 Releaseletter erzeugt (3 Rolle(n) × 2 Sprache(n)) aus 4 Ticket(s); 1 ohne Rollen-Label (in allen enthalten).");
  check("Ticketzahlen: Retail 3 (1, 3, 4), MO 2 (2, 3), HQ 2 (3, 4); andere Rollen 1 / 2 / 2", JSON.stringify(rows().filter((r) => r.includes("Deutsch"))) === JSON.stringify(["Retail|Deutsch|3|1", "MO|Deutsch|2|2", "HQ|Deutsch|2|2"]));
  fire(doc.querySelector('[data-rl-preview="0"]'), "click");
  const pv = $("rl-roles-preview").textContent;
  check("Vorschau Retail DE: eigene Tickets, Rollenhinweis, Abschnitt andere Rollen mit MO-Ticket",
    pv.startsWith("# Release Letter – 2026.5 – Retail") && pv.includes("ONESCM-1") && pv.includes("ONESCM-3") && pv.includes("ONESCM-4") && pv.includes("Rollenhinweis (Retail)") &&
    pv.includes("## Änderungen für andere Rollen") && pv.includes("- **ONESCM-2** – Freigabe Kampagnen (Rollen: MO)") && pv.indexOf("ONESCM-2") > pv.indexOf("Änderungen für andere Rollen"));
  fire(doc.querySelector('[data-rl-preview="1"]'), "click");
  const pvEn = $("rl-roles-preview").textContent;
  check("Vorschau Retail EN: englische Texte", $("rl-roles-preview-title").textContent === "Vorschau – Retail (Englisch)" && pvEn.includes("## Changes for other roles") && pvEn.includes("do not affect the Retail role") && pvEn.includes("Role note"));
  savedFiles.length = 0;
  fire(doc.querySelector('[data-rl-md="2"]'), "click");
  await waitUntil(() => savedFiles.length === 1, 3000);
  const md = savedFiles[0] ? (typeof savedFiles[0].data === "string" ? savedFiles[0].data : Buffer.from(await savedFiles[0].data.arrayBuffer()).toString("utf-8")) : "";
  check("Markdown MO DE: Dateiname und Inhalt (ohne Retail-only-Ticket in eigenen Tickets)", savedFiles[0].filename === "2026_5_releaseletter_MO_de.md" && md.includes("ONESCM-2") && md.includes("Rollenhinweis (MO (Market Operation))") && md.indexOf("ONESCM-1") > md.indexOf("Änderungen für andere Rollen"));
  fire(doc.querySelector('[data-rl-docx="4"]'), "click");
  await waitUntil(() => savedFiles.length === 2, 5000);
  const dx = savedFiles[1] ? await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[1].data.arrayBuffer()))).file("word/document.xml").async("string") : "";
  check("Word HQ DE", savedFiles[1].filename === "2026_5_releaseletter_HQ_de.docx" && dx.includes("ONESCM-4") && dx.includes("Änderungen für andere Rollen"));

  // ZIP + Excel
  savedFiles.length = 0;
  fire($("rl-roles-zip-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 8000);
  const zz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const names = Object.keys(zz.files).sort();
  check("ZIP: 6 × (Word + Markdown)", /^2026_5_Releaseletter_je_Rolle_.*\.zip$/.test(savedFiles[0].filename) && names.length === 12 && names.includes("2026_5_releaseletter_Retail_en.docx") && names.includes("2026_5_releaseletter_HQ_de.md"));
  fire($("rl-roles-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 2, 5000);
  const xs = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[1].data.arrayBuffer()))).file("xl/worksheets/sheet1.xml").async("string");
  check("Excel Ticket × Rolle: Spalten je Rolle, ohne-Label-Hinweis, x-Markierungen", ["Ticket", "Rollen-Label", "Retail", "MO", "HQ", "ONESCM-4", "Retail, HQ", "(ohne – gilt für alle)"].every((t) => xs.includes(t)) && (xs.match(/>x</g) || []).length === 7);

  // Optionen: ohne Label nicht aufnehmen, kein Abschnitt andere Rollen
  $("rl-roles-untagged").checked = false; $("rl-roles-others").checked = false; $("rl-roles-lang-en").checked = false;
  fire($("rl-roles-generate-btn"), "click");
  check("Ohne Label nicht aufgenommen: Retail 2, MO 1, HQ 1", JSON.stringify(rows()) === JSON.stringify(["Retail|Deutsch|2|1", "MO|Deutsch|1|2", "HQ|Deutsch|1|2"]) && $("rl-roles-status").textContent.includes("1 ohne Rollen-Label (nicht enthalten)"));
  fire(doc.querySelector('[data-rl-preview="0"]'), "click");
  check("Ohne Abschnitt 'andere Rollen'", !$("rl-roles-preview").textContent.includes("Änderungen für andere Rollen") && !$("rl-roles-preview").textContent.includes("ONESCM-3"));
  check("Haupt-Releaseletter oben unverändert nutzbar (eigener Generator)", !!$("releaseletter-generate-btn"));
  roleCb("Retail").checked = false; fire(roleCb("Retail"), "change"); roleCb("MO").checked = false; fire(roleCb("MO"), "change"); roleCb("HQ").checked = false; fire(roleCb("HQ"), "change");
  fire($("rl-roles-generate-btn"), "click");
  check("Keine Rolle gewählt: Hinweis", $("toast").textContent.includes("mindestens eine Rolle"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RELEASELETTER-JE-ROLLE-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
