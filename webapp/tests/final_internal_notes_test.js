// v2.120.0 FINAL: interne Mitteilungen je Stand (Kategorie, Titel, Text,
// Aktualisierungs-Intervall, Verlauf, "Geprueft – unveraendert", Faelligkeit),
// nie im Dokument-Export (Word/PowerPoint) und nicht im Releaseletter;
// Kopieren zwischen Staenden, Anzeige im Register Editor, Sitzung.
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
const SECRET = "GEHEIM-IDEE-4711";

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const setVal = (id, v) => { const el = doc.getElementById(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const versionRows = () => Array.from(doc.querySelectorAll("#final-versions-tbody tr"));
  const cards = () => Array.from(doc.querySelectorAll("#final-notes-list [data-note-id]"));
  async function build(name) {
    setVal("final-build-name-input", name);
    fire(doc.getElementById("final-build-master-btn"), "click");
    await waitUntil(() => doc.getElementById("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
  }
  nav("final"); await wait(50);
  const input = doc.getElementById("final-manual-file-input");
  Object.defineProperty(input, "files", { value: [new win.File([await buildDocx(heading("Kapitel 1: Verträge") + para("Verträge werden online geändert."))], "h.docx")], configurable: true });
  fire(input, "change");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  await build("Release 1");
  await build("Release 2");
  setVal("final-reviewer-input", "Rita Redakteurin");

  // ===================== Mitteilungen anlegen =====================
  const notesBtn = (i) => versionRows()[i].querySelector("[data-final-version-notes]");
  check("Stände-Tabelle: Button 'Mitteilungen (0)'", notesBtn(0).textContent === "Mitteilungen (0)");
  fire(notesBtn(0), "click");
  check("Panel für 'Release 1' geöffnet", !doc.getElementById("final-notes-panel").hidden && doc.getElementById("final-notes-title").textContent.includes("Release 1"));
  setVal("final-note-new-category", "Version Screen");
  setVal("final-note-new-title", "Screens Stand 2026.4");
  setVal("final-note-new-interval", "7");
  setVal("final-note-new-text", "Screens zuletzt mit Version 4.2 aufgenommen.");
  fire(doc.getElementById("final-note-add-btn"), "click");
  setVal("final-note-new-category", "Ideenspeicher");
  setVal("final-note-new-title", "Idee Export");
  setVal("final-note-new-interval", "30");
  setVal("final-note-new-text", SECRET + ": Export als HTML anbieten.");
  fire(doc.getElementById("final-note-add-btn"), "click");
  check("Zwei Mitteilungen mit Kategorie/Titel", cards().length === 2 && cards()[0].textContent.includes("Version Screen") && cards()[1].querySelector('[data-note-field="title"]').value === "Idee Export");
  check("Fälligkeit angezeigt (wöchentlich)", cards()[0].querySelector(".final-note-due").textContent.startsWith("nächste Aktualisierung fällig am"));
  check("'zuletzt aktualisiert … von Rita Redakteurin'", cards()[0].textContent.includes("von Rita Redakteurin"));
  check("Button zeigt 'Mitteilungen (2)'", notesBtn(0).textContent === "Mitteilungen (2)");

  // ===================== Bearbeiten, Pruefen, Verlauf =====================
  cards()[0].querySelector('[data-note-field="text"]').value = "Screens mit Version 4.3 neu aufgenommen.";
  fire(cards()[0].querySelector("[data-note-save]"), "click");
  check("Gespeichert: neuer Text", cards()[0].querySelector('[data-note-field="text"]').value === "Screens mit Version 4.3 neu aufgenommen.");
  fire(cards()[0].querySelector("[data-note-save]"), "click");
  check("Speichern ohne Änderung: Hinweis", doc.getElementById("toast").textContent.includes("Geprüft – unverändert"));
  fire(cards()[0].querySelector("[data-note-confirm]"), "click");
  fire(cards()[0].querySelector("[data-note-history]"), "click");
  const hist = cards()[0].querySelector(".final-note-history").textContent;
  check("Verlauf: angelegt, geändert (mit altem Text), geprüft", cards()[0].querySelector("[data-note-history]").textContent === "Verlauf (3)" && hist.includes("geprüft") && hist.includes("vorher: „Screens zuletzt mit Version 4.2"));

  // ===================== Nie im Dokument / Releaseletter =====================
  fire(versionRows()[0].querySelector("[data-final-version-activate]"), "click");
  await wait(50);
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-docx-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 10000);
  const docXml = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("word/document.xml").async("string");
  check("Word-Export enthält das Dokument, aber keine internen Mitteilungen", docXml.includes("Verträge werden online geändert.") && !docXml.includes(SECRET) && !docXml.includes("Version 4.3"));
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-pptx-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 10000);
  const pz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  let pptText = "";
  for (const f of Object.keys(pz.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) pptText += await pz.file(f).async("string");
  check("PowerPoint-Export ohne interne Mitteilungen", pptText.includes("Verträge werden online") && !pptText.includes(SECRET));
  const resSel = doc.getElementById("final-result-chapter-select");
  resSel.value = resSel.options[0].value; fire(resSel, "change");
  check("Ergebnis (Schritt 7) ohne interne Mitteilungen", !doc.getElementById("final-result-master-output").textContent.includes(SECRET));
  nav("releaseletter"); await wait(50);
  check("Releaseletter enthält keine internen Mitteilungen", !doc.querySelector('[data-view-panel="releaseletter"]').textContent.includes(SECRET));
  nav("final"); await wait(50);

  // ===================== Kopieren, Editor-Anzeige =====================
  fire(notesBtn(1), "click");
  check("Panel 'Release 2' leer", cards().length === 0 && doc.getElementById("final-notes-title").textContent.includes("Release 2"));
  fire(doc.getElementById("final-note-copy-btn"), "click");
  check("Aus 'Release 1' kopiert (2 Mitteilungen, Verlauf vermerkt)", cards().length === 2 && cards()[0].querySelector("[data-note-history]").textContent === "Verlauf (4)");
  nav("edito"); await wait(50);
  const notesCells = Array.from(doc.querySelectorAll("#edito-final-docs-tbody .edito-final-col-notes")).map((c) => c.textContent);
  check("Register Editor: Spalte 'Interne Mitteilungen' je Dokument", notesCells.length === 2 && notesCells.every((t) => t === "2"));
  nav("final"); await wait(50);

  // ===================== Faelligkeit nach Ablauf (Sitzung) =====================
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  check("Sitzung speichert Mitteilungen samt Verlauf", session.final.versions[0].notes.length === 2 && session.final.versions[0].notes[0].history.length === 3);
  session.final.versions[0].notes[0].updatedAt = new Date(Date.now() - 10 * 86400000).toISOString();
  const si = doc.getElementById("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(session)], "s.json")], configurable: true });
  fire(si, "change");
  await wait(80);
  if (!doc.getElementById("confirm-modal-overlay").hidden) { fire(doc.getElementById("confirm-modal-ok-btn"), "click"); }
  await wait(400);
  nav("final"); await wait(50);
  check("Übersicht: '1 fällig' mit Titel und Stand", doc.getElementById("final-notes-due-summary").textContent.includes("1 fällig") && doc.getElementById("final-notes-due-summary").textContent.includes("„Screens Stand 2026.4“ (Release 1)"));
  check("Button am Stand mit Fällig-Markierung", notesBtn(0).textContent.includes("1 fällig"));
  fire(notesBtn(0), "click");
  check("Karte überfällig hervorgehoben", cards()[0].classList.contains("final-note-overdue") && cards()[0].querySelector(".final-note-due").textContent.startsWith("Aktualisierung fällig seit"));
  fire(cards()[0].querySelector("[data-note-confirm]"), "click");
  check("Nach 'Geprüft – unverändert' nicht mehr fällig", !cards()[0].classList.contains("final-note-overdue") && doc.getElementById("final-notes-due-summary").textContent === "");
  nav("edito"); await wait(50);
  nav("final"); await wait(50);
  fire(cards()[1].querySelector("[data-note-delete]"), "click");
  await wait(40); fire(doc.getElementById("confirm-modal-ok-btn"), "click"); await wait(200);
  check("Mitteilung gelöscht", cards().length === 1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE INTERNE-MITTEILUNGEN-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
