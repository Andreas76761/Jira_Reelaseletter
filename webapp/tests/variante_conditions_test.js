// v2.126.0 VARIANTE: Rollen-Bedingungen auf Absatz-Ebene ([Rolle: ...], [Nicht Rolle: ...], Block bis [/Rolle],
// Screens entfallen mit), veraltete Varianten erkennen und aktualisieren, Varianten auf neues Basisdokument
// uebertragen, Matrix als Excel exportieren und wieder einlesen.
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
  async function session() {
    savedFiles.length = 0;
    fire($("session-export-btn"), "click");
    await waitUntil(() => savedFiles.length > 0, 5000);
    return JSON.parse(savedFiles[0].data);
  }
  async function load(ses) {
    const si = $("session-import-input");
    Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(ses)], "s.json")], configurable: true });
    fire(si, "change");
    await wait(80);
    if (!$("confirm-modal-overlay").hidden) fire($("confirm-modal-ok-btn"), "click");
    await wait(400);
  }
  async function runStatus(prefix) { await waitUntil(() => $("variante-status").textContent.includes("Variante(n) erzeugt"), 10000); }
  const vRow = (name) => Array.from(doc.querySelectorAll("#variante-tbody tr")).find((r) => r.querySelector("b").textContent === name);
  const stale = (name) => { const b = vRow(name).querySelector(".variante-stale"); return b ? b.textContent : ""; };
  const count = (role) => doc.querySelector('#variante-matrix-tfoot [data-vr-count="' + role + '"]').textContent;
  const T1 = ["Allgemeiner Text.", "[Rolle: Retail] Nur für Händler.", "[Nicht Rolle: Retail] Für alle außer Händler.", "[Rolle: MO, HQ]", "MO-Block Zeile 1.", "[Bild]", "MO-Block Zeile 2.", "[/Rolle]", "[Bild]", "Schluss."].join("\n");
  const stand = (id, name, t2) => ({ id, name, createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {},
    chapters: [{ title: "Kapitel 1: Verträge", level: 1, text: T1, screenIds: [11, 12] }, { title: "Kapitel 2: Kunden", level: 1, text: t2, screenIds: [] }] });

  let ses = await session();
  ses.final.versions = [stand(1, "Basis", "Kundentext.")];
  ses.final.activeVersionId = 1;
  await load(ses);
  nav("variante");
  const condCell = (i) => doc.querySelector('[data-vr-cond-count="' + i + '"]').textContent;
  check("Schritt 2 zeigt Rollen-Bedingungen je Kapitel", condCell(0) === "3 Absatz/Block" && condCell(1) === "–");

  for (const r of ["Retail", "MO"]) { setVal("variante-new-role", r); setVal("variante-new-lang", "DE"); fire($("variante-add-btn"), "click"); }
  fire($("variante-generate-all-btn"), "click");
  await runStatus();
  ses = await session();
  const vs = (name) => ses.final.versions.find((v) => v.name === name);
  const r1 = vs("Basis – Retail – DE").chapters[0], m1 = vs("Basis – MO – DE").chapters[0];
  check("Retail: nur passende Absätze, Block ausgeblendet, Markierungen entfernt", r1.text === "Allgemeiner Text.\nNur für Händler.\n[Bild]\nSchluss.");
  check("Retail: Screen des ausgeblendeten Blocks entfällt (nur 2. Screen)", JSON.stringify(r1.screenIds) === "[12]");
  check("MO: 'Nicht Retail'-Absatz und MO-Block enthalten, beide Screens", m1.text === "Allgemeiner Text.\nFür alle außer Händler.\nMO-Block Zeile 1.\n[Bild]\nMO-Block Zeile 2.\n[Bild]\nSchluss." && JSON.stringify(m1.screenIds) === "[11,12]");
  check("Keine Rollen-Markierung in irgendeiner Variante", !JSON.stringify(ses.final.versions.slice(1)).includes("[Rolle") && !JSON.stringify(ses.final.versions.slice(1)).includes("[/Rolle]"));
  check("Basisdokument bleibt unverändert", vs("Basis").chapters[0].text === T1);
  check("Direkt nach dem Erzeugen: nichts veraltet", !stale("Basis – Retail – DE") && !stale("Basis – MO – DE") && $("variante-update-stale-btn").hidden);

  // Matrix-Aenderung -> veraltet
  setVal("variante-domain-new-input", "Kunden"); fire($("variante-domain-add-btn"), "click");
  let sel = Array.from(doc.querySelectorAll("[data-vr-map]"))[1]; sel.value = "Kunden"; fire(sel, "change");
  check("Nur Zuordnung geändert (alles aktiv): nichts veraltet", !stale("Basis – MO – DE"));
  const cb = Array.from(doc.querySelectorAll('#variante-matrix-tbody [data-vm-kind="dom"]')).find((c) => c.getAttribute("data-vm-key") === "Kunden" && c.getAttribute("data-vm-role") === "MO");
  cb.checked = false; fire(cb, "change");
  check("Kunden für MO aus: MO veraltet (Matrix), Retail nicht", stale("Basis – MO – DE") === "veraltet: Matrix/Optionen geändert" && !stale("Basis – Retail – DE") && $("variante-update-stale-btn").textContent === "Veraltete Varianten aktualisieren (1)");
  $("variante-opt-ref-chapter").checked = false; fire($("variante-opt-ref-chapter"), "change");
  check("Option geändert: betroffene Variante veraltet", stale("Basis – MO – DE").includes("Matrix/Optionen"));
  $("variante-opt-ref-chapter").checked = true; fire($("variante-opt-ref-chapter"), "change");

  // Basisdokument geaendert -> veraltet
  ses = await session();
  ses.final.versions[0].chapters[1].text = "Kundentext, überarbeitet.";
  await load(ses);
  nav("variante");
  check("Basis geändert: beide veraltet, Gründe genannt", stale("Basis – Retail – DE") === "veraltet: Basisdokument geändert" && stale("Basis – MO – DE") === "veraltet: Basisdokument geändert, Matrix/Optionen geändert" && $("variante-update-stale-btn").textContent.endsWith("(2)"));
  fire($("variante-update-stale-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.startsWith("2 von 2"), 10000);
  ses = await session();
  check("Aktualisiert: gleiche Stände, neuer Inhalt, MO ohne Kunden-Kapitel", ses.final.versions.length === 3 && vs("Basis – Retail – DE").chapters[1].text.startsWith("Kundentext, überarbeitet.") &&
    !vs("Basis – MO – DE").chapters.some((c) => c.title.includes("Kunden")) && !stale("Basis – Retail – DE") && !stale("Basis – MO – DE") && $("variante-update-stale-btn").hidden);

  // Auf neues Basisdokument uebertragen
  ses.final.versions.push(stand(9, "Basis 2", "Kundentext Version 2."));
  await load(ses);
  nav("variante");
  setVal("variante-base-select", "9");
  check("Anderes Basisdokument gewählt: Varianten markiert, Übertragen-Button (2)", vRow("Basis – Retail – DE").textContent.includes("anderes Basisdokument") && !$("variante-rebase-btn").hidden && $("variante-rebase-btn").textContent.endsWith("(2)") && $("variante-generate-all-btn").disabled);
  fire($("variante-rebase-btn"), "click"); await wait(40); fire($("confirm-modal-ok-btn"), "click"); await wait(200);
  check("Übertragen: Varianten gehören zu 'Basis 2' und sind veraltet", $("variante-status").textContent.startsWith("2 Variante(n) übertragen") && stale("Basis – Retail – DE").includes("Basisdokument geändert") && $("variante-rebase-btn").hidden);
  fire($("variante-update-stale-btn"), "click");
  await waitUntil(() => $("variante-status").textContent.startsWith("2 von 2"), 10000);
  ses = await session();
  const rr = vs("Basis – Retail – DE");
  check("Neu aufgebaut aus 'Basis 2' (gleicher Stand, Konfiguration aktualisiert)", ses.final.versions.length === 4 && rr.chapters[1].text.startsWith("Kundentext Version 2.") && rr.config.variant.baseName === "Basis 2" && rr.basedOnId === 9);

  // Matrix als Excel
  savedFiles.length = 0;
  fire($("variante-matrix-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const xz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const sheet = await xz.file("xl/worksheets/sheet1.xml").async("string");
  check("Matrix-Excel: Kopf, Domänen- und Kapitelzeilen mit x je aktiver Rolle", /^Variante_Matrix_Basis_2_.*\.xlsx$/.test(savedFiles[0].filename) && ["Typ", "Unterdomäne", "Markt", "HQ", "Hinweis", "Domäne", "Kunden", "Kapitel 1: Verträge", "Kapitel 2: Kunden"].every((t) => sheet.includes(t)) && (sheet.match(/>x</g) || []).length === 13);

  // Bearbeitete Matrix einlesen
  const xesc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const colL = (i) => String.fromCharCode(65 + i);
  const rowsIn = [["Typ", "Domäne", "Unterdomäne", "Kapitel", "Markt", "MO", "Retail", "IT", "HQ", "Partner", "Hinweis"],
    ["Domäne", "Kunden", "", "", "x", "x", "", "x", "x", "x", ""],
    ["Unterdomäne", "Kunden", "Privat", "", "x", "x", "x", "x", "x", "x", ""],
    ["Domäne", "Finanzen", "", "", "x", "x", "x", "x", "x", "", ""],
    ["Kapitel", "", "", "Kapitel 1: Verträge", "x", "x", "x", "", "x", "x", ""],
    ["Kapitel", "Kunden", "", "Kapitel 2: Kunden", "x", "x", "", "x", "x", "x", ""],
    ["Kapitel", "", "", "Kapitel 9: Gibt es nicht", "x", "x", "x", "x", "x", "x", ""]];
  const z = new JSZipNode();
  z.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Matrix" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  z.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rowsIn.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => '<c r="' + colL(c) + (r + 1) + '" t="inlineStr"><is><t>' + xesc(v) + "</t></is></c>").join("") + "</row>").join("") + "</sheetData></worksheet>");
  const mi = $("variante-matrix-import-input");
  Object.defineProperty(mi, "files", { value: [new win.File([await z.generateAsync({ type: "nodebuffer" })], "matrix.xlsx")], configurable: true });
  fire(mi, "change");
  await waitUntil(() => $("variante-matrix-note").textContent.includes("geladen"), 5000);
  check("Import-Bilanz: Domänen, Unterdomäne, Kapitel, Abweichung, neue Rolle, unbekanntes Kapitel",
    $("variante-matrix-note").textContent === "Matrix aus „matrix.xlsx“ geladen: 2 Domäne(n), 1 Unterdomäne(n), 2 Kapitel (1 abweichend geschaltet), neue Rolle(n): Partner, 1 unbekannte(s) Kapitel übersprungen.");
  const doms = Array.from(doc.querySelectorAll("#variante-domains-list [data-vr-dom] b")).map((b) => b.textContent);
  check("Neue Domäne 'Finanzen' und Unterdomäne 'Privat' angelegt", doms.includes("Finanzen") && doc.querySelector("#variante-domains-list").textContent.includes("Privat"));
  check("Matrix nach Import: Retail 1/2 (Kunden aus), MO 2/2, IT 1/2 (Kapitel 1 manuell aus), Partner 2/2",
    count("Retail") === "1 / 2" && count("MO") === "2 / 2" && count("IT") === "1 / 2" && count("Partner") === "2 / 2");
  const itCell = Array.from(doc.querySelectorAll("#variante-matrix-tbody .variante-row-ch")).find((r) => r.firstChild.textContent === "Kapitel 1: Verträge").querySelector('[data-vm-role="IT"]');
  check("Abweichung als 'manuell' markiert", itCell.closest("td").textContent.includes("manuell"));
  check("Varianten nach Import veraltet (Matrix)", stale("Basis – Retail – DE").includes("Matrix") && stale("Basis – MO – DE").includes("Matrix"));
  const bad = $("variante-matrix-import-input");
  Object.defineProperty(bad, "files", { value: [new win.File([await (() => { const zz = new JSZipNode(); zz.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'); zz.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'); zz.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Irgendwas</t></is></c></row></sheetData></worksheet>'); return zz.generateAsync({ type: "nodebuffer" }); })()], "x.xlsx")], configurable: true });
  fire(bad, "change");
  await waitUntil(() => $("toast").textContent.includes("Import fehlgeschlagen"), 5000);
  check("Fremde Excel ohne 'Typ'-Spalte: verständliche Fehlermeldung", $("toast").textContent.includes("Spalte „Typ“ nicht gefunden"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VARIANTE-ERWEITERUNGS-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
