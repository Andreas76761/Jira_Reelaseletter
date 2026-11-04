// v2.132.0 Releaseletter je Rolle: Rollen-Zuordnung pruefen, manuelle Zuordnung (Vorrang vor Labels, ↺),
// KI-Rollenvorschlag (JSON, nur angezeigte Tickets, Uebernahme einzeln/alle), Wirkung auf die Briefe,
// Excel-Quelle, Sitzung.
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
let aiMode = "ok";
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (aiMode === "bad") return { text: "Ich kann das leider nicht als JSON liefern." };
  return { text: 'Hier die Zuordnung:\n```json\n{"ONESCM-3": ["IT", "Unbekannt"], "ONESCM-99": ["HQ"]}\n```' };
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
    item("ONESCM-3", "Schnittstelle Abrechnung beschleunigt", []) + item("ONESCM-4", "Rabattmodell erweitert", ["Retail", "HQ"]) + "</channel></rss>";
  Object.defineProperty(input, "files", { value: [new win.File([xml], "t.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("stat-tickets").textContent === "4", 5000);
  nav("releaseletter");
  $("releaseletter-keys").value = "ONESCM-1\nONESCM-2\nONESCM-3\nONESCM-4";
  $("releaseletter-use-filtered").checked = false;
  $("releaseletter-name").value = "2026.5";
  const rows = () => Array.from(doc.querySelectorAll("#rl-assign-tbody tr"));
  const row = (k) => doc.querySelector('#rl-assign-tbody [data-rl-assign="' + k + '"]');
  const cb = (k, r) => row(k).querySelector('[data-rl-assign-role="' + r + '"]');

  check("Zuordnung: noch keine manuellen, KI gesperrt", $("rl-assign-count").textContent === "0" && $("rl-assign-ai-btn").disabled);
  fire($("rl-assign-load-btn"), "click");
  check("Anzeigen: 4 Tickets, 1 ohne Rolle – nur dieses gelistet", $("rl-assign-note").textContent === "4 Ticket(s) in der Auswahl, davon 1 ohne Rolle." && rows().length === 1 && !!row("ONESCM-3"));
  $("rl-assign-only-untagged").checked = false; fire($("rl-assign-only-untagged"), "change");
  check("Alle Tickets: Rollen aus Labels und Häkchen", rows().length === 4 && row("ONESCM-4").children[1].textContent === "Retail, HQ" && cb("ONESCM-4", "HQ").checked && !cb("ONESCM-4", "MO").checked);
  cb("ONESCM-1", "MO").checked = true; fire(cb("ONESCM-1", "MO"), "change");
  check("Manuelle Zuordnung: Retail + MO, als 'manuell' markiert, Zähler 1", $("rl-assign-count").textContent === "1" && cb("ONESCM-1", "MO").checked && cb("ONESCM-1", "Retail").checked && row("ONESCM-1").textContent.includes("manuell"));
  fire(row("ONESCM-1").querySelector("[data-rl-assign-reset]"), "click");
  check("↺ zurück zu den Labels", $("rl-assign-count").textContent === "0" && !cb("ONESCM-1", "MO").checked);
  $("rl-assign-only-untagged").checked = true; fire($("rl-assign-only-untagged"), "change");

  // KI
  fire($("rl-assign-ai-btn"), "click");
  await waitUntil(() => $("rl-assign-note").textContent.startsWith("KI-Vorschläge"), 5000);
  check("KI-Prompt nur mit den angezeigten Tickets", prompts.length === 1 && prompts[0].includes("- ONESCM-3: Schnittstelle Abrechnung beschleunigt") && !prompts[0].includes("ONESCM-1:") && prompts[0].includes("JSON-Objekt"));
  check("Vorschlag: nur gültige Rollen (IT), fremde Keys ignoriert", $("rl-assign-note").textContent === "KI-Vorschläge für 1 von 1 Ticket(s) – bitte prüfen und übernehmen." && row("ONESCM-3").lastChild.textContent.startsWith("IT") && !$("rl-assign-accept-all-btn").hidden && $("rl-assign-count").textContent === "0");
  fire($("rl-assign-accept-all-btn"), "click");
  check("Alle Vorschläge übernommen: ONESCM-3 → IT (manuell)", $("rl-assign-note").textContent === "1 KI-Vorschlag/Vorschläge übernommen." && $("rl-assign-count").textContent === "1" && cb("ONESCM-3", "IT").checked && row("ONESCM-3").textContent.includes("manuell"));
  aiMode = "bad";
  fire($("rl-assign-ai-btn"), "click");
  await waitUntil(() => $("rl-assign-note").textContent.startsWith("KI-Vorschlag fehlgeschlagen"), 5000);
  check("Ungültige KI-Antwort: verständliche Meldung, nichts geändert", $("rl-assign-note").textContent === "KI-Vorschlag fehlgeschlagen: Antwort der KI war kein gültiges JSON." && $("rl-assign-count").textContent === "1");

  // Wirkung auf die Briefe
  const roleCb = (t) => doc.querySelector('[data-rl-role="' + t + '"]');
  roleCb("IT").checked = true; fire(roleCb("IT"), "change");
  roleCb("Markt").checked = false; fire(roleCb("Markt"), "change");
  $("rl-roles-untagged").checked = false;
  fire($("rl-roles-generate-btn"), "click");
  const res = Array.from(doc.querySelectorAll("#rl-roles-tbody tr")).map((r) => Array.from(r.children).slice(0, 3).map((c) => c.textContent).join("|"));
  check("Briefe: IT enthält ONESCM-3, Retail nicht; keine Tickets mehr ohne Rolle", JSON.stringify(res) === JSON.stringify(["Retail|Deutsch|2", "MO|Deutsch|1", "HQ|Deutsch|1", "IT|Deutsch|1"]) && !$("rl-roles-status").textContent.includes("ohne Rollen-Label"));
  savedFiles.length = 0;
  fire($("rl-roles-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const xs = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("xl/worksheets/sheet1.xml").async("string");
  check("Excel: Spalte Quelle (manuell / Label)", xs.includes("Quelle") && xs.includes("manuell") && xs.includes("Label"));

  // Sitzung
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const ses = JSON.parse(savedFiles[0].data);
  check("Sitzung enthält manuelle Rollen", JSON.stringify(ses.rlRoleOverrides) === JSON.stringify({ "ONESCM-3": ["IT"] }));
  ses.rlRoleOverrides = { "ONESCM-2": ["HQ", "Quatsch"] };
  const si = $("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
  fire(si, "change"); await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("releaseletter");
  fire($("rl-assign-load-btn"), "click");
  check("Sitzung laden: manuelle Rollen übernommen, ungültige Rollen verworfen", $("rl-assign-count").textContent === "1" && !!row("ONESCM-2") && cb("ONESCM-2", "HQ").checked && !cb("ONESCM-2", "MO").checked);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ROLLEN-ZUORDNUNGS-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
