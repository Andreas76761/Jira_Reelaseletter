// v2.117.0 FINAL/Editor: Verbesserungen ohne Agent als interne Vermerke,
// Bearbeitungsstatus je Verbesserung, Pflicht-Bearbeiter fuer Geprueft/
// Veroeffentlicht, Sperre veroeffentlichter Staende, Agenten erhalten
// interne Vermerke + Jira-Nummern (sonst verworfen) und arbeiten nur offene
// Verbesserungen ein, Kapitelerzeugung im Editor mit internem Dokument als
// Grundlage (Quelle 1).
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
const mode = { dropJira: false };
function cannedSample(input) {
  if (input.includes("QUELLE 1")) return "Neu erzeugtes Kapitel.";
  const text = input.split("KAPITELTEXT:\n")[1] || "";
  const out = text + "\nSprachlich geglättet.";
  return mode.dropJira ? out.replace(/ONESCM-8282/g, "") : out;
}
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    const sample = function (input, opts) { sampleCalls.push({ input, opts }); return Promise.resolve({ text: cannedSample(input), truncated: false }); };
    sample.json = function () { return Promise.resolve([]); };
    sample.limits = function () { return Promise.resolve({ maxPromptBytes: 262144 }); };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        if (name === "sample") return Promise.resolve(sample);
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

const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
function heading(text) { return '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>"; }
function para(text) { return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function commented(before, inside, after) {
  return '<w:p><w:r><w:t xml:space="preserve">' + esc(before) + '</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">' + esc(inside) +
    '</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t xml:space="preserve">' + esc(after) + "</w:t></w:r></w:p>";
}
function img(rId) { return '<w:p><w:r><w:drawing><a:blip r:embed="' + rId + '"/></w:drawing></w:r></w:p>'; }
async function buildDocx(bodyXml, images) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "<w:sectPr/></w:body></w:document>");
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= (images || 0); i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG);
  }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
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
  await wait(500);
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

  // Kapiteltitel aus der Editor-Gliederung (Version Dealer), damit die Quelldatei dazu passt.
  nav("edito"); await wait(50);
  setVal("edito-version-select", "dealer"); await wait(50);
  const editoRows = () => Array.from(doc.querySelectorAll("#edito-chapters-tbody tr"));
  const K1 = editoRows()[0].children[1].textContent.trim();
  const K2 = editoRows()[1].children[1].textContent.trim();
  check("Editor-Gliederung liefert Kapiteltitel", !!K1 && !!K2 && K1 !== K2);

  // ===================== FINAL: Quelldatei mit internem Vermerk + Jira-Nummer =====================
  nav("final"); await wait(50);
  await upload("final-manual-file-input", await buildDocx(
    heading(K1) + commented("Der Dealer ändert Verträge (ONESCM-8282). ", "INTERN: Rechtsprüfung offen.", " Danach wird gespeichert.") + img("rId1") +
    heading(K2) + para("Kündigungen werden erfasst."), 1), "handbuch.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  await upload("final-improvements-file-input", await buildXlsx([["Kapitel", "Verbesserung"], [K1, "Speicherhinweis ergänzen"], [K1, "Screenshot erklären"], [K2, "Fristen nennen"]]), "rovo.xlsx");
  await waitUntil(() => doc.getElementById("final-improvements-files-tbody").children.length === 1, 5000);
  await upload("final-screens-file-input", await buildDocx(img("rId1") + para("V > Speichern"), 1), "screens.docx");
  await waitUntil(() => doc.querySelectorAll("#final-screens-tbody tr").length === 1, 5000);
  const scrSel = doc.querySelector("#final-screens-tbody tr select"); scrSel.value = K1; fire(scrSel, "change");
  check("Excel: 3 von 3 zugeordnet", doc.querySelector("#final-improvements-files-tbody .final-col-mapped").textContent === "3 von 3");

  // ===================== Stand 1: Verbesserungen direkt als Vermerk =====================
  selectByLabel("final-build-improvements-select", "rovo.xlsx");
  doc.getElementById("final-build-improvements-inline-cb").checked = true;
  setVal("final-build-name-input", "Mit Vermerken");
  const note = doc.getElementById("final-build-master-status-note");
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => note.textContent.includes("Mit Vermerken"), 10000);
  const resSel = doc.getElementById("final-result-chapter-select");
  resSel.value = K1; fire(resSel, "change");
  { const cb = doc.getElementById("final-result-images-cb"); if (cb.checked) { cb.checked = false; fire(cb, "change"); } } // v2.186: Text-Ansicht der Bild-Hinweise prüfen
  const master = () => doc.getElementById("final-result-master-output");
  const marks = Array.from(master().querySelectorAll("mark.final-mark-internal")).map((m) => m.textContent);
  check("Verbesserungen ohne Agent als interner Vermerk (gelb) im Kapiteltext", marks.some((t) => t.includes("Verbesserung (ROVO): Speicherhinweis ergänzen") && t.includes("Verbesserung (ROVO): Screenshot erklären")));
  const statusesOf = () => Array.from(master().querySelectorAll(".final-improvements-box li")).map((li) => li.getAttribute("data-final-imp-status-value"));
  check("Status dieser Verbesserungen: 'als Vermerk übernommen'", statusesOf().length === 2 && statusesOf().every((x) => x === "als Vermerk übernommen"));
  check("Vermerk steht vor dem Bild-Platzhalter", /Screenshot erklären[\s\S]*\[Bild:/.test(master().textContent));

  // ===================== Stand 2: ohne Vermerke, Status je Verbesserung =====================
  doc.getElementById("final-build-improvements-inline-cb").checked = false;
  setVal("final-build-name-input", "Ohne Vermerke");
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => note.textContent.includes("Ohne Vermerke"), 10000);
  resSel.value = K1; fire(resSel, "change");
  check("Ohne Option: keine Verbesserungs-Vermerke im Text", !master().textContent.includes("Verbesserung (ROVO):"));
  check("Box: 2 offen von 2, als Auswahl editierbar", master().querySelector(".final-improvements-box b").textContent.includes("2 offen von 2") && master().querySelectorAll(".final-imp-status").length === 2);
  const impSel = master().querySelectorAll(".final-imp-status")[1];
  impSel.value = "abgelehnt"; fire(impSel, "change");
  check("Status 'abgelehnt' gesetzt, Zähler 1 offen", master().querySelector(".final-improvements-box b").textContent.includes("1 offen von 2"));

  // ===================== Bearbeiter-Pflicht, Sperre =====================
  const stSel = (i) => versionRows()[i].querySelector("[data-final-version-status]");
  const pill = (i) => versionRows()[i].querySelector(".final-status-pill").textContent;
  let s0 = stSel(0); s0.value = "Geprüft"; fire(s0, "change"); await wait(50);
  check("Ohne Bearbeiter kein 'Geprüft' (bleibt Entwurf, Hinweis)", pill(0) === "Entwurf" && doc.getElementById("toast").textContent.includes("Bearbeiter"));
  setVal("final-reviewer-input", "A. Muster");
  s0 = stSel(0); s0.value = "Geprüft"; fire(s0, "change"); await wait(50);
  check("Mit Bearbeiter: Geprüft von A. Muster", pill(0) === "Geprüft" && versionRows()[0].textContent.includes("von A. Muster"));
  s0 = stSel(0); s0.value = "Veröffentlicht"; fire(s0, "change"); await wait(50);
  const delBtn = versionRows()[0].querySelector("[data-final-version-delete]");
  check("Veröffentlicht: Löschen gesperrt", pill(0) === "Veröffentlicht" && delBtn.disabled && delBtn.textContent.includes("Gesperrt"));
  s0 = stSel(0); s0.value = "Entwurf"; fire(s0, "change"); await wait(60);
  check("Zurücksetzen fragt nach", !doc.getElementById("confirm-modal-overlay").hidden);
  fire(doc.getElementById("confirm-modal-cancel-btn"), "click"); await wait(300);
  check("Abbrechen: bleibt veröffentlicht", pill(0) === "Veröffentlicht");
  s0 = stSel(0); s0.value = "Entwurf"; fire(s0, "change"); await wait(60);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click"); await wait(300);
  check("Bestätigen: zurück auf Entwurf, wieder löschbar", pill(0) === "Entwurf" && !versionRows()[0].querySelector("[data-final-version-delete]").disabled);

  // ===================== Editor-Agenten: Vermerke + Jira-Nummern =====================
  nav("edito"); await wait(50);
  const docRow = (name) => Array.from(doc.querySelectorAll("#edito-final-docs-tbody tr")).find((r) => r.textContent.includes(name));
  fire(docRow("Ohne Vermerke").querySelector("[data-edito-final-select]"), "click");
  const chapStatus = (t) => doc.querySelector('#edito-final-chapters-tbody tr[data-edito-final-chapter-row="' + t + '"] .edito-final-col-status').textContent;
  const chapImps = (t) => doc.querySelector('#edito-final-chapters-tbody tr[data-edito-final-chapter-row="' + t + '"] .edito-final-col-imps').textContent;
  check("Editor zeigt offene Verbesserungen je Kapitel", chapImps(K1) === "1 offen / 2" && chapImps(K2) === "1 offen / 1");
  mode.dropJira = true;
  sampleCalls.length = 0;
  fire(doc.getElementById("edito-final-agent-style-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-final-agent-status").textContent.includes("Kapitel optimiert"), 5000);
  const p1 = sampleCalls.find((c) => c.input.includes("KAPITEL: " + K1));
  check("Agent bekommt Vermerk als ⟦INTERN⟧-Tags (keine Steuerzeichen)", !!p1 && p1.input.includes("⟦INTERN⟧INTERN: Rechtsprüfung offen.⟦/INTERN⟧") && !p1.input.includes("\u0001"));
  check("Antwort ohne Jira-Nummer wird verworfen", chapStatus(K1).includes("verworfen") && chapStatus(K1).includes("ONESCM-8282"));
  check("Kapitel ohne Jira-Nummer wird optimiert", chapStatus(K2).includes("optimiert"));
  mode.dropJira = false;
  sampleCalls.length = 0;
  fire(doc.getElementById("edito-final-agent-improve-btn"), "click");
  await waitUntil(() => /Verbesserungen einarbeiten“: \d+ von \d+ Kapitel optimiert/.test(doc.getElementById("edito-final-agent-status").textContent), 5000);
  const p2 = sampleCalls.find((c) => c.input.includes("KAPITEL: " + K1));
  check("Nur offene Verbesserungen im Prompt (abgelehnte nicht)", !!p2 && p2.input.includes("Speicherhinweis ergänzen") && !p2.input.includes("Screenshot erklären"));
  check("Kapitel 1 jetzt optimiert", chapStatus(K1).includes("optimiert"));
  check("Kapitel 2: beide Agenten vermerkt", chapStatus(K2).includes("Sprache & Stil + Verbesserungen einarbeiten"));
  setVal("edito-final-save-name-input", "Optimiert");
  fire(doc.getElementById("edito-final-save-btn"), "click");
  await wait(100);
  nav("final"); await wait(50);
  resSel.value = K1; fire(resSel, "change");
  check("Neuer Stand: interner Vermerk weiterhin gelb markiert", Array.from(master().querySelectorAll("mark.final-mark-internal")).some((m) => m.textContent.includes("INTERN: Rechtsprüfung offen.")));
  check("Neuer Stand: Jira-Nummer erhalten (blau)", Array.from(master().querySelectorAll("mark.final-mark-jira")).some((m) => m.textContent === "ONESCM-8282"));
  check("Neuer Stand: Status der Verbesserungen umgesetzt/abgelehnt", statusesOf().join(",") === "umgesetzt,abgelehnt");
  resSel.value = K2; fire(resSel, "change");
  check("Kapitel 2: Verbesserung umgesetzt", statusesOf().join(",") === "umgesetzt");

  // ===================== Editor: internes Dokument als Grundlage (Quelle 1) =====================
  nav("edito"); await wait(50);
  check("Grundlage-Auswahl bietet interne Dokumente", Array.from(doc.getElementById("edito-base-doc-select").options).some((o) => o.textContent.includes("Internes Dokument: Optimiert")));
  selectByLabel("edito-base-doc-select", "Internes Dokument: Optimiert");
  check("Hinweis nennt das gewählte Dokument", doc.getElementById("edito-base-doc-note").textContent.includes("„Optimiert“"));
  sampleCalls.length = 0;
  const genRow = editoRows().find((r) => r.children[1].textContent.trim() === K1);
  fire(genRow.querySelector("[data-edito-generate]"), "click");
  await waitUntil(() => sampleCalls.some((c) => c.input.includes("QUELLE 1")), 5000);
  const gen = sampleCalls.find((c) => c.input.includes("QUELLE 1")).input;
  check("Kapitelerzeugung: Quelle 1 = internes Dokument mit dessen Text (ohne Bild-Platzhalter)", gen.includes("QUELLE 1 – Internes Dokument „Optimiert“") && gen.includes("Der Dealer ändert Verträge") && !/QUELLE 1[\s\S]*\n\[Bild\]\n[\s\S]*QUELLE 2/.test(gen));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FREIGABE/SPERRE/AGENTEN-SCHUTZ-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
