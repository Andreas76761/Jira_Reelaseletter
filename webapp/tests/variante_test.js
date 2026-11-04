// v2.125.0 Register VARIANTE: aus einem FINAL-Stand Varianten je Rolle und Sprache erzeugen –
// Domaenen/Unterdomaenen, Kapitel-Zuordnung, Matrix Domaene · Rolle · Kapitel (inkl. manueller
// Abweichung), neu nummeriertes Inhaltsverzeichnis, Verweise auf andere Rollen (Hinweis + Verweis-Kapitel),
// KI-Uebersetzung mit Platzhalter-Schutz, Ablage als Stand in FINAL, Word, Sitzung.
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
let slow = false;
async function sample(input, opts) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (slow) {
    await new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      if (sig) sig.addEventListener("abort", () => reject(Object.assign(new Error("abgebrochen"), { code: "cancelled" })));
      setTimeout(resolve, 5000);
    });
  }
  let text = "SONSTIGES";
  if (p.includes("ZIELSPRACHE:")) {
    const title = (p.match(/\nTITEL: (.*)\n/) || [])[1] || "";
    const body = p.slice(p.indexOf("\nTEXT:\n") + 7);
    text = title.includes("Verträge anlegen") ? "TITEL: Create contracts\n\nContracts are created online." : "TITEL: EN-" + title + "\n\n" + "EN: " + body;
  }
  return { text, truncated: false };
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
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function buildDocx(body) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type: "nodebuffer" });
}
const heading = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const para = (t) => "<w:p><w:r><w:t>" + esc(t) + "</w:t></w:r></w:p>";
const SECRET = "INTERNE-NOTIZ-5150";
async function blobBuf(d) { return Buffer.from(await d.arrayBuffer()); }

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  async function build(name) {
    setVal("final-build-name-input", name);
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
  }
  async function session() {
    savedFiles.length = 0;
    fire($("session-export-btn"), "click");
    await waitUntil(() => savedFiles.length > 0, 5000);
    return JSON.parse(savedFiles[0].data);
  }
  const h2 = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
  const domRow = (name) => Array.from(doc.querySelectorAll("#variante-domains-list [data-vr-dom]")).find((r) => r.querySelector("b").textContent === name);
  const mapSel = (title) => Array.from(doc.querySelectorAll("[data-vr-map]")).find((s) => s.closest("tr").firstChild.textContent === title);
  const cell = (kind, key, role) => Array.from(doc.querySelectorAll('#variante-matrix-tbody [data-vm-kind="' + kind + '"]')).find((c) => c.getAttribute("data-vm-key") === key && c.getAttribute("data-vm-role") === role);
  const chCell = (title, role) => { const tr = Array.from(doc.querySelectorAll("#variante-matrix-tbody .variante-row-ch")).find((r) => r.firstChild.textContent === title); return tr && tr.querySelector('[data-vm-role="' + role + '"]'); };
  const toggle = (cb, on) => { cb.checked = on; fire(cb, "change"); };
  const count = (role) => doc.querySelector('#variante-matrix-tfoot [data-vr-count="' + role + '"]').textContent;
  const vRow = (name) => Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b").textContent === name);
  const SEP = "\u0001";

  nav("variante");
  check("Register VARIANTE vorhanden, ohne Stand: Hinweis, Erzeugen gesperrt", !doc.querySelector('[data-view-panel="variante"]').hidden && $("variante-base-info").textContent.startsWith("Kein Basisdokument") && $("variante-generate-all-btn").disabled);

  nav("final"); await wait(50);
  const input = $("final-manual-file-input");
  Object.defineProperty(input, "files", { value: [new win.File([await buildDocx(
    heading("Kapitel 1: Verträge anlegen") + para("Neue Verträge werden online angelegt.") + para("[Bild]") +
    h2("1.1 Vertragsprüfung") + para("Die Prüfung erfolgt durch das Backoffice.") +
    heading("Kapitel 2: Kunden verwalten") + para("Kundendaten pflegen.") +
    heading("Kapitel 3: Finanzen") + para("Abrechnung gemäß ONESCM-77.") +
    heading("Kapitel 4: Allgemeines") + para("Anmeldung und Navigation."))], "basis.docx")], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("final-manuals-tbody").children.length === 1, 5000);
  await build("Basis");

  nav("variante");
  check("Basisdokument 'Basis' vorgewählt: 5 Kapitel/Unterkapitel", $("variante-base-select").selectedOptions[0].textContent.includes("Basis") && $("variante-base-info").textContent.startsWith("5 Kapitel/Unterkapitel"));
  const chRows = Array.from(doc.querySelectorAll("#variante-chapters-tbody tr"));
  check("Unterkapitel eingerückt mit 'wie übergeordnetes Kapitel'", chRows.length === 5 && mapSel("1.1 Vertragsprüfung").options[0].textContent.includes("wie übergeordnetes Kapitel"));

  // Domaenen
  for (const d of ["Verträge", "Kunden", "Finanzen"]) { setVal("variante-domain-new-input", d); fire($("variante-domain-add-btn"), "click"); }
  setVal("variante-domain-new-input", "kunden"); fire($("variante-domain-add-btn"), "click");
  check("3 Domänen angelegt, Duplikat (Groß/Klein) abgewiesen", doc.querySelectorAll("#variante-domains-list [data-vr-dom]").length === 3 && $("toast").textContent.includes("existiert bereits"));
  for (const sname of ["Anlage", "Prüfung"]) { const r = domRow("Verträge"); r.querySelector("[data-vr-sub-new]").value = sname; fire(r.querySelector("[data-vr-sub-add]"), "click"); }
  check("Unterdomänen 'Anlage' und 'Prüfung' bei Verträge", domRow("Verträge").querySelectorAll(".variante-chip").length === 2 && domRow("Verträge").textContent.includes("Prüfung"));
  fire($("variante-automap-btn"), "click");
  check("Automatische Zuordnung über Domänen-Namen (3 Kapitel)", $("variante-automap-note").textContent.startsWith("3 Kapitel automatisch zugeordnet") &&
    mapSel("Kapitel 1: Verträge anlegen").value === "Verträge" && mapSel("Kapitel 2: Kunden verwalten").value === "Kunden" && mapSel("Kapitel 3: Finanzen").value === "Finanzen" && mapSel("Kapitel 4: Allgemeines").value === "");
  let ms = mapSel("1.1 Vertragsprüfung"); ms.value = "Verträge" + SEP + "Prüfung"; fire(ms, "change");
  ms = mapSel("Kapitel 1: Verträge anlegen"); ms.value = "Verträge" + SEP + "Anlage"; fire(ms, "change");
  check("Manuelle Zuordnung auf Unterdomäne", mapSel("1.1 Vertragsprüfung").value === "Verträge" + SEP + "Prüfung");

  // Matrix
  const head = Array.from(doc.querySelectorAll("#variante-matrix-thead th")).map((t) => t.textContent.trim());
  check("Matrix: Spalten = Rollen (Markt, MO, Retail, IT, HQ)", ["Markt", "MO", "Retail", "IT", "HQ"].every((r) => head.includes(r)));
  const rowsTxt = Array.from(doc.querySelectorAll("#variante-matrix-tbody tr")).map((r) => r.firstChild.textContent);
  check("Matrix: Zeilen Domäne › Unterdomäne › Kapitel, Allgemein am Ende", rowsTxt.indexOf("Verträge") < rowsTxt.indexOf("› Anlage") && rowsTxt.indexOf("› Anlage") < rowsTxt.indexOf("Kapitel 1: Verträge anlegen") && rowsTxt.indexOf("› Prüfung") < rowsTxt.indexOf("1.1 Vertragsprüfung") && rowsTxt[rowsTxt.length - 2] === "Allgemein (ohne Domäne)");
  check("Standard: alles aktiv (5 / 5 je Rolle)", count("Retail") === "5 / 5" && count("HQ") === "5 / 5");
  toggle(cell("dom", "Finanzen", "Retail"), false);
  toggle(cell("sub", "Verträge" + SEP + "Prüfung", "Retail"), false);
  toggle(cell("dom", "Kunden", "MO"), false);
  check("Domäne/Unterdomäne deaktiviert: Retail 3 / 5, MO 4 / 5", count("Retail") === "3 / 5" && count("MO") === "4 / 5" && !chCell("Kapitel 3: Finanzen", "Retail").checked && !chCell("1.1 Vertragsprüfung", "Retail").checked);
  toggle(cell("dom", "Verträge", "IT"), false);
  check("Deaktivierte Domäne blendet Unterdomänen und Kapitel aus (IT 3 / 5)", count("IT") === "3 / 5" && !chCell("Kapitel 1: Verträge anlegen", "IT").checked && cell("sub", "Verträge" + SEP + "Anlage", "IT").closest("td").classList.contains("variante-cell-off"));
  toggle(chCell("Kapitel 4: Allgemeines", "IT"), false);
  toggle(chCell("Kapitel 1: Verträge anlegen", "IT"), true);
  check("Kapitel abweichend geschaltet ('manuell'), Unterkapitel folgt nicht automatisch der Unterdomäne", count("IT") === "3 / 5" && chCell("Kapitel 1: Verträge anlegen", "IT").closest("td").textContent.includes("manuell") && !chCell("1.1 Vertragsprüfung", "IT").checked);
  fire(chCell("Kapitel 1: Verträge anlegen", "IT").closest("td").querySelector("[data-vr-reset]"), "click");
  check("↺ setzt Kapitel auf Domäne zurück", !chCell("Kapitel 1: Verträge anlegen", "IT").checked && count("IT") === "2 / 5");
  toggle(cell("dom", "Verträge", "IT"), true);
  check("Domäne wieder aktiv: IT 4 / 5 (Allgemeines bleibt manuell aus)", count("IT") === "4 / 5");
  setVal("variante-role-new-input", "Partner"); fire($("variante-role-add-btn"), "click");
  check("Weitere Rolle 'Partner' als Spalte", Array.from(doc.querySelectorAll("#variante-matrix-thead th")).some((t) => t.textContent.includes("Partner")));
  fire(doc.querySelector('[data-vr-role-del="Partner"]'), "click"); await wait(40); fire($("confirm-modal-ok-btn"), "click"); await wait(200);
  check("Eigene Rolle wieder entfernt", !Array.from(doc.querySelectorAll("#variante-matrix-thead th")).some((t) => t.textContent.includes("Partner")));

  // Varianten
  setVal("variante-new-role", "Retail"); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click");
  setVal("variante-new-role", "MO"); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click");
  setVal("variante-new-role", "Retail"); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click");
  check("Varianten angelegt, doppelte Kombination abgewiesen", doc.querySelectorAll("#variante-tbody tr").length === 2 && $("toast").textContent.includes("bereits"));
  doc.querySelector('#variante-bulk-roles input[value="Retail"]').checked = true;
  doc.querySelector('#variante-bulk-langs input[value="DE"]').checked = false;
  doc.querySelector('#variante-bulk-langs input[value="EN"]').checked = true;
  fire($("variante-bulk-add-btn"), "click");
  check("Mehrfach-Anlage Rollen × Sprachen: Retail EN", doc.querySelectorAll("#variante-tbody tr").length === 3 && !!vRow("Basis – Retail – EN"));
  check("Zeile zeigt aktive/ausgelassene Kapitel und Verweise", vRow("Basis – Retail – DE").textContent.includes("3 aktiv · 2 ausgelassen") && vRow("Basis – Retail – DE").children[4].textContent === "2");

  // Inhaltsverzeichnis-Vorschau
  fire(vRow("Basis – Retail – DE").querySelector("[data-vr-preview]"), "click");
  const toc = Array.from(doc.querySelectorAll("#variante-preview-toc li")).map((l) => l.textContent);
  check("Neues Inhaltsverzeichnis: neu nummeriert, ausgelassene Themen mit Verweis-Rollen, Verweis-Kapitel",
    toc[0] === "1 Verträge anlegen" && toc[1].startsWith("Vertragsprüfung→ Verweis: Markt, MO, IT, HQ") && toc[2] === "2 Kunden verwalten" && toc[3].includes("Finanzen") && toc[4] === "3 Allgemeines" && toc[5].startsWith("4 Themen in anderen Rollen-Handbüchern"));

  // Erzeugen
  prompts.length = 0;
  fire($("variante-generate-all-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.includes("Variante(n) erzeugt"), 15000);
  check("Alle 3 Varianten erzeugt", $("variante-status").textContent.startsWith("3 von 3 Variante(n) erzeugt"));
  let ses = await session();
  const vs = (name) => ses.final.versions.find((v) => v.name === name);
  const rde = vs("Basis – Retail – DE"), mde = vs("Basis – MO – DE"), ren = vs("Basis – Retail – EN");
  check("Je Variante ein Stand in FINAL (origin Variante, Konfiguration Rolle/Sprache)", ses.final.versions.length === 4 && rde && rde.origin === "Variante" && rde.config.variant.role === "Retail" && ren.config.variant.lang === "EN");
  check("Aktiver FINAL-Stand bleibt die Basis", ses.final.versions.find((v) => v.id === ses.final.activeVersionId).name === "Basis");
  check("Retail DE: Kapitel und Ebenen", JSON.stringify(rde.chapters.map((c) => [c.title, c.level])) === JSON.stringify([["1 Verträge anlegen", 1], ["2 Kunden verwalten", 1], ["3 Allgemeines", 1], ["4 Themen in anderen Rollen-Handbüchern", 1]]));
  check("Hinweis an der Stelle des ausgelassenen Unterkapitels (im vorherigen Kapitel)", rde.chapters[0].text.includes("Hinweis: Das Thema „Vertragsprüfung“ ist im Benutzerhandbuch für die Rolle(n) Markt, MO, IT, HQ beschrieben.") && rde.chapters[0].text.includes("[Bild]"));
  check("Hinweis auf 'Finanzen' nach Kapitel 2", rde.chapters[1].text.includes("„Finanzen“ ist im Benutzerhandbuch für die Rolle(n) Markt, MO, IT, HQ"));
  check("Verweis-Kapitel listet beide Themen mit Rollen", rde.chapters[3].text.includes("- Vertragsprüfung → Rolle(n): Markt, MO, IT, HQ") && rde.chapters[3].text.includes("- Finanzen → Rolle(n): Markt, MO, IT, HQ"));
  check("MO DE: Kunden ausgelassen, Unterkapitel 1.1 erhalten, Verweis auf andere Rollen",
    JSON.stringify(mde.chapters.map((c) => c.title)) === JSON.stringify(["1 Verträge anlegen", "1.1 Vertragsprüfung", "2 Finanzen", "3 Allgemeines", "4 Themen in anderen Rollen-Handbüchern"]) && mde.chapters[1].text.includes("„Kunden verwalten“ ist im Benutzerhandbuch für die Rolle(n) Markt, Retail, IT, HQ"));
  check("Deutsche Varianten ohne KI-Aufruf; EN: 3 Übersetzungen", prompts.length === 3 && prompts.every((p) => p.includes("ZIELSPRACHE: Englisch (EN)")));
  check("EN: übersetzte Titel mit neuer Nummer, Jira-Nummer erhalten", ren.chapters[1].title === "2 EN-Kunden verwalten" && ren.chapters[1].text.startsWith("EN: Kundendaten pflegen.") && ren.chapters[1].text.includes("Note: The topic “Finanzen”"));
  check("EN: Übersetzung ohne [Bild] verworfen → Kapitel unverändert", ren.chapters[0].title === "1 Verträge anlegen" && ren.chapters[0].text.includes("[Bild]"));
  check("EN: Verweis-Kapitel in Zielsprache, nicht an KI geschickt", ren.chapters[3].title === "4 Topics in other role manuals" && ren.chapters[3].text.startsWith("The following topics") && !prompts.some((p) => p.includes("Topics in other role")));
  check("Status je Variante: Übersetzungs-Bilanz", vRow("Basis – Retail – EN").textContent.includes("2 übersetzt, 1 unverändert (Übersetzung verworfen)"));
  const vrRow = Array.from(doc.querySelectorAll("#final-versions-tbody tr")).find((r) => r.textContent.includes("Basis – Retail – DE"));
  check("FINAL-Stände: Konfiguration 'Variante Retail · DE aus „Basis“'", !!vrRow && vrRow.textContent.includes("Variante Retail · DE aus „Basis“"));

  // Word
  savedFiles.length = 0;
  fire(vRow("Basis – Retail – EN").querySelector("[data-vr-docx]"), "click");
  await waitUntil(() => savedFiles.length === 1, 8000);
  const dz = savedFiles[0] ? await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer())) : null;
  const dx = dz ? await dz.file("word/document.xml").async("string") : "";
  check("Word der Variante: Deckblatt 'User Manual', geändertes Inhaltsverzeichnis", /^Variante_Basis_.*Retail_.*EN_.*\.docx$/.test(savedFiles[0] ? savedFiles[0].filename : "") && dx.includes("User Manual") && dx.includes("2 EN-Kunden verwalten") && dx.includes("4 Topics in other role manuals") && !dx.includes("Kapitel 3: Finanzen"));

  // Neu erzeugen nach Matrix-Aenderung
  const oldId = rde.id;
  toggle(cell("dom", "Finanzen", "Retail"), true);
  fire(vRow("Basis – Retail – DE").querySelector("[data-vr-generate]"), "click");
  await waitUntil(() => $("variante-status").textContent.startsWith("1 von 1"), 8000);
  ses = await session();
  const rde2 = ses.final.versions.find((v) => v.name === "Basis – Retail – DE");
  check("Neu erzeugen aktualisiert denselben Stand (Finanzen jetzt enthalten)", ses.final.versions.length === 4 && rde2.id === oldId && rde2.chapters.map((c) => c.title).includes("3 Finanzen"));

  // Optionen
  $("variante-opt-ref-chapter").checked = false; fire($("variante-opt-ref-chapter"), "change");
  $("variante-opt-renumber").checked = false; fire($("variante-opt-renumber"), "change");
  fire(vRow("Basis – MO – DE").querySelector("[data-vr-preview]"), "click");
  const toc2 = Array.from(doc.querySelectorAll("#variante-preview-toc li")).map((l) => l.textContent);
  check("Ohne Neunummerierung/Verweis-Kapitel: Originaltitel, kein Verweis-Kapitel", toc2[0] === "Kapitel 1: Verträge anlegen" && !toc2.some((t) => t.includes("Themen in anderen")));
  $("variante-opt-ref-chapter").checked = true; fire($("variante-opt-ref-chapter"), "change");
  $("variante-opt-renumber").checked = true; fire($("variante-opt-renumber"), "change");

  // In FINAL oeffnen
  fire(vRow("Basis – MO – DE").querySelector("[data-vr-open]"), "click");
  check("'In FINAL öffnen' aktiviert den Varianten-Stand", !doc.querySelector('[data-view-panel="final"]').hidden && $("final-result-version-select").selectedOptions[0].textContent.includes("Basis – MO – DE"));

  // Sitzung
  ses = await session();
  check("Sitzung enthält Domänen, Matrix-Abweichungen, Zuordnungen, Varianten", ses.variante.domains.length === 3 && ses.variante.subOff["Verträge" + SEP + "Prüfung"].Retail === true &&
    ses.variante.chOverride["Kapitel 4: Allgemeines"].IT === false && ses.variante.chapterMap["1.1 Vertragsprüfung"].sub === "Prüfung" && ses.variante.variants.length === 3);
  ses.variante.domOff = {};
  const si = $("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
  fire(si, "change");
  await wait(80);
  if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("variante");
  check("Sitzung laden stellt VARIANTE wieder her", doc.querySelectorAll("#variante-tbody tr").length === 3 && count("MO") === "5 / 5" && count("Retail") === "4 / 5");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VARIANTE-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
