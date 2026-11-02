// v2.118.0 FINAL/Editor: Bearbeiter aus dem claude.ai-Konto (user-
// Faehigkeit, Name schreibgeschuetzt, Konto-ID in der Historie, Anzeige ueber
// profiles()), Pruefbericht an Stand anhaengen + als Word/Markdown
// exportieren, Staende vergleichen (Titel- bzw. Positionszuordnung,
// Zeilenvergleich, inhaltlicher KI-Vergleich).
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
const sampleCalls = [];
function cannedSample(input) {
  if (input.includes("STAND A:")) return "Kapitel 1: inhaltlich gleich.\nGesamteinschätzung: Fassungen stimmen überein.";
  if (input.includes("DOKUMENT:")) return "Kapitel 1: vollständig.\nGesamtempfehlung: Geprüft";
  return "";
}
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    const sample = function (input, opts) { sampleCalls.push({ input, opts }); return Promise.resolve({ text: cannedSample(input), truncated: false }); };
    sample.json = function () { return Promise.resolve([]); };
    sample.limits = function () { return Promise.resolve({ maxPromptBytes: 262144 }); };
    const user = {
      me: () => Promise.resolve({ id: "u_42", name: "Erika Prüferin", avatarUrl: "data:,", color: "#000", email: null, isOwner: true, canEdit: true }),
      profiles: (ids) => Promise.resolve(Object.fromEntries([].concat(ids).map((id) => [id, { id, name: id === "u_42" ? "Erika P. (aktuell)" : "", avatarUrl: "data:,", color: "#000", email: null, isMe: id === "u_42", guest: false }]))),
    };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        if (name === "sample") return Promise.resolve(sample);
        if (name === "user") return Promise.resolve(user);
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (fn()) return true; await wait(20); }
  return false;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
function heading(text) { return '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>"; }
function para(text) { return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
async function buildDocx(bodyXml) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "<w:sectPr/></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type: "nodebuffer" });
}
async function buildXlsx(rows) {
  const zip = new JSZipNode();
  const col = (i) => String.fromCharCode(65 + i);
  const sr = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => '<c r="' + col(c) + (r + 1) + '" t="inlineStr"><is><t>' + esc(v) + "</t></is></c>").join("") + "</row>").join("");
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sr + "</sheetData></worksheet>");
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(600);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  async function upload(inputId, buf, name) {
    const input = doc.getElementById(inputId);
    Object.defineProperty(input, "files", { value: [new win.File([buf], name, { type: "application/octet-stream" })], configurable: true });
    fire(input, "change");
  }
  const setVal = (id, v) => { const el = doc.getElementById(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const selectByLabel = (id, part) => { const sel = doc.getElementById(id); const o = Array.from(sel.options).find((x) => x.textContent.includes(part)); sel.value = o ? o.value : ""; fire(sel, "change"); return !!o; };
  const versionRows = () => Array.from(doc.querySelectorAll("#final-versions-tbody tr"));
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const note = doc.getElementById("final-build-master-status-note");
  async function build(name, opts) {
    opts = opts || {};
    selectByLabel("final-build-manual-select", opts.manual);
    selectByLabel("final-build-improvements-select", opts.imp || "– keine –");
    doc.getElementById("final-build-improvements-inline-cb").checked = !!opts.inline;
    setVal("final-build-name-input", name);
    note.textContent = "";
    fire(doc.getElementById("final-build-master-btn"), "click");
    await waitUntil(() => note.textContent.includes("„" + name + "“"), 10000);
  }

  nav("final"); await wait(50);
  await upload("final-manual-file-input", await buildDocx(heading("Kapitel 1: Verträge") + para("Verträge werden online geändert.") + heading("Kapitel 2: Kündigung") + para("Kündigungen werden erfasst.") + heading("Kapitel 3: Stammdaten") + para("Händlerdaten pflegen.")), "handbuch_de.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  await upload("final-manual-file-input", await buildDocx(heading("Chapter 1: Contracts") + para("Contracts are changed online.") + heading("Chapter 2: Termination") + para("Terminations are recorded.") + heading("Chapter 3: Master data") + para("Maintain dealer data.")), "manual_en.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 2, 5000);
  await upload("final-improvements-file-input", await buildXlsx([["Kapitel", "Verbesserung"], ["Kapitel 1: Verträge", "Speicherhinweis ergänzen"]]), "rovo.xlsx");
  await waitUntil(() => doc.getElementById("final-improvements-files-tbody").children.length === 1, 5000);
  await build("DE", { manual: "handbuch_de.docx" });
  await build("DE + Vermerk", { manual: "handbuch_de.docx", imp: "rovo.xlsx", inline: true });
  await build("EN", { manual: "manual_en.docx" });
  check("Drei Stände erzeugt", versionRows().length === 3);

  // ===================== Anmeldung ueber das claude.ai-Konto =====================
  const reviewer = doc.getElementById("final-reviewer-input");
  check("Bearbeiter aus dem Konto (schreibgeschützt)", reviewer.readOnly && reviewer.value === "Erika Prüferin");
  check("Hinweis 'Angemeldet als'", doc.getElementById("final-reviewer-signed-note").textContent.includes("Angemeldet als Erika Prüferin"));
  const st = versionRows()[0].querySelector("[data-final-version-status]");
  st.value = "Geprüft"; fire(st, "change");
  await wait(80);
  check("Geprüft ohne Namenseingabe möglich", versionRows()[0].querySelector(".final-status-pill").textContent === "Geprüft");
  const bySpan = () => versionRows()[0].querySelector('[data-final-by-id="u_42"]');
  await waitUntil(() => bySpan() && bySpan().textContent === "Erika P. (aktuell)", 2000);
  check("Anzeige 'von …' über die Konto-ID aufgelöst", !!bySpan() && bySpan().textContent === "Erika P. (aktuell)");

  // ===================== Staende vergleichen =====================
  check("Vergleich: Stand-Auswahl mit 3 Ständen", doc.getElementById("final-compare-a-select").options.length === 3);
  selectByLabel("final-compare-a-select", "DE – ");
  selectByLabel("final-compare-b-select", "DE + Vermerk");
  fire(doc.getElementById("final-compare-btn"), "click");
  const cmpRows = () => Array.from(doc.querySelectorAll("#final-compare-tbody tr"));
  const change = (i) => cmpRows()[i].querySelector(".final-col-change").textContent;
  check("DE vs. DE+Vermerk: Kapitel 1 geändert, 2 und 3 unverändert", cmpRows().length === 3 && change(0).startsWith("geändert") && change(1) === "unverändert" && change(2) === "unverändert");
  check("Zusammenfassung", doc.getElementById("final-compare-summary").textContent.includes("1 geändert") && doc.getElementById("final-compare-summary").textContent.includes("2 unverändert"));
  fire(cmpRows()[0].querySelector("[data-final-compare-diff]"), "click");
  check("Unterschiede zeigen die hinzugekommene Zeile", !doc.getElementById("final-compare-diff").hidden && doc.getElementById("final-compare-diff-body").textContent.includes("+ Verbesserung (ROVO): Speicherhinweis ergänzen"));
  selectByLabel("final-compare-b-select", "EN – ");
  fire(doc.getElementById("final-compare-btn"), "click");
  check("DE vs. EN: Zuordnung über die Reihenfolge (3 Paare)", cmpRows().length === 3 && cmpRows().every((r) => r.textContent.includes("Zuordnung über die Reihenfolge")) && cmpRows()[1].children[1].textContent === "Chapter 2: Termination");
  sampleCalls.length = 0;
  fire(doc.getElementById("final-compare-ai-btn"), "click");
  await waitUntil(() => !doc.getElementById("final-compare-ai-wrap").hidden, 5000);
  check("KI-Vergleich bekommt beide Stände (ohne Bild-Platzhalter)", sampleCalls.length === 1 && sampleCalls[0].input.includes("STAND A: DE") && sampleCalls[0].input.includes("STAND B: EN") && sampleCalls[0].input.includes("Contracts are changed online."));
  check("KI-Vergleich angezeigt", doc.getElementById("final-compare-ai-output").textContent.includes("Gesamteinschätzung"));

  // ===================== Pruefbericht anhaengen + exportieren =====================
  fire(versionRows()[0].querySelector("[data-final-version-editor]"), "click");
  await wait(50);
  fire(doc.getElementById("edito-final-agent-review-btn"), "click");
  await waitUntil(() => !doc.getElementById("edito-final-report-wrap").hidden, 5000);
  savedFiles.length = 0;
  fire(doc.getElementById("edito-final-report-md-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 3000);
  check("Prüfbericht als Markdown (mit Stand und Status)", savedFiles[0] && /^Pruefbericht_DE_\d{4}-\d{2}-\d{2}\.md$/.test(savedFiles[0].filename) && String(savedFiles[0].data).includes("# Prüfbericht – DE") && String(savedFiles[0].data).includes("Gesamtempfehlung: Geprüft"));
  fire(doc.getElementById("edito-final-report-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 2, 3000);
  const zip = savedFiles[1] ? await JSZipNode.loadAsync(Buffer.from(await savedFiles[1].data.arrayBuffer())) : null;
  const xml = zip ? await zip.file("word/document.xml").async("string") : "";
  check("Prüfbericht als Word", /\.docx$/.test(savedFiles[1] ? savedFiles[1].filename : "") && xml.includes("Prüfbericht – DE") && xml.includes("Gesamtempfehlung: Geprüft"));
  fire(doc.getElementById("edito-final-report-attach-btn"), "click");
  check("Bericht an den Stand angehängt", doc.getElementById("edito-final-report-note").textContent.includes("1 Prüfbericht"));
  nav("final"); await wait(50);
  const repBtn = versionRows()[0].querySelector("[data-final-version-report]");
  check("Stände-Tabelle: Button 'Prüfbericht (1)'", !!repBtn && repBtn.textContent === "Prüfbericht (1)");
  savedFiles.length = 0;
  fire(repBtn, "click");
  await waitUntil(() => savedFiles.length === 1, 3000);
  check("Angehängter Bericht als Word aus der Stände-Tabelle", savedFiles[0] && /^Pruefbericht_DE_.*\.docx$/.test(savedFiles[0].filename));

  // Sitzung behaelt Bericht + Konto-ID
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  const v0 = session.final.versions[0];
  check("Sitzung: Prüfbericht und Konto-ID in der Historie gespeichert", v0.reviews.length === 1 && v0.reviews[0].byId === "u_42" && v0.history.some((h) => h.byId === "u_42"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VERGLEICH/PRÜFBERICHT/ANMELDUNG-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
