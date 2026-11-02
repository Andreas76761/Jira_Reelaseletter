// v2.116.0 FINAL: mehrere Quelldateien mit Rolle/Sparte/Sprache/Markt,
// Excel "Verbesserungen aus ROVO" je Kapitel (Mapping auf Quelldatei,
// Anzeige in Uebersicht/Vorschau/Ergebnis), Auswahl von Quelldatei /
// Verbesserungen / Screens-Datei je Schritt, mehrere Staende (Outputs) mit
// Status Entwurf/Geprueft/Veroeffentlicht, und im Register Editor interne
// Dokumente (Staende) mit Datum/Status, Agenten-Optimierung und Uebernahme
// als neuer Stand.
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
// KI-Antworten: "Verbesserungen einarbeiten" haengt einen Satz an (Kapitel 1),
// fuer Kapitel 2 geht der Bild-Platzhalter verloren -> muss verworfen werden.
function cannedSample(input) {
  if (input.includes("DOKUMENT:")) return "Kapitel 1: Verträge\n- Verbesserung umgesetzt.\nGesamtempfehlung: Geprüft";
  const kap = /KAPITEL: (.*)/.exec(input)[1];
  const text = input.split("KAPITELTEXT:\n")[1] || "";
  if (kap.startsWith("Kapitel 2")) return text.replace(/\[Bild\]\n?/g, "") + "\nOhne Bild.";
  return text + "\nNeu: Vertragsdaten werden vor dem Speichern geprüft.";
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
async function confirmViaModal(doc) { await wait(30); fire(doc.getElementById("confirm-modal-ok-btn"), "click"); await wait(200); }

const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
function heading(text) { return '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>"; }
function para(text) { return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
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
// Minimal-.xlsx: Kopfzeile ueber gemeinsame Zeichenketten, Daten als inlineStr.
async function buildXlsx(rows) {
  const zip = new JSZipNode();
  const shared = [];
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => {
    const ref = col(c) + (r + 1);
    if (r === 0) { shared.push(v); return '<c r="' + ref + '" t="s"><v>' + (shared.length - 1) + "</v></c>"; }
    return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v) + "</t></is></c>";
  }).join("") + "</row>").join("");
  zip.file("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ROVO" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/sharedStrings.xml", '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + shared.map((t) => "<si><t>" + esc(t) + "</t></si>").join("") + "</sst>");
  zip.file("xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sheetRows + "</sheetData></worksheet>");
  return zip.generateAsync({ type: "nodebuffer" });
}

const DE1 = "Kapitel 1: Verträge", DE2 = "Kapitel 2: Kündigung", DE3 = "Kapitel 3: Stammdaten";
const EN1 = "Chapter 1: Contracts", EN2 = "Chapter 2: Termination";

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
  const optionLabels = (id) => Array.from(doc.getElementById(id).options).map((o) => o.textContent);
  const selectByLabel = (id, part) => { const sel = doc.getElementById(id); const o = Array.from(sel.options).find((x) => x.textContent.includes(part)); sel.value = o ? o.value : ""; fire(sel, "change"); return !!o; };
  const screenRows = () => Array.from(doc.querySelectorAll("#final-screens-tbody tr"));
  const navOf = (r) => r.querySelector(".final-col-nav").textContent;
  const versionRows = () => Array.from(doc.querySelectorAll("#final-versions-tbody tr"));

  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);

  // ===================== Schritt 1: zwei Quelldateien (DE/Retail, EN/HQ) =====================
  setVal("final-manual-rolle-select", "Retail"); setVal("final-manual-sprache-input", "DE"); setVal("final-manual-markt-input", "Deutschland");
  await upload("final-manual-file-input", await buildDocx(heading(DE1) + para("Verträge werden online geändert.") + heading(DE2) + para("Kündigungen werden erfasst.") + heading(DE3) + para("Händlerdaten pflegen.")), "handbuch_de.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  setVal("final-manual-rolle-select", "HQ"); setVal("final-manual-sprache-input", "EN"); setVal("final-manual-markt-input", "UK");
  await upload("final-manual-file-input", await buildDocx(heading(EN1) + para("Contracts are changed online.") + heading(EN2) + para("Terminations are recorded.")), "manual_en.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 2, 5000);
  const manualRows = Array.from(doc.querySelectorAll("#final-manuals-tbody tr")).map((r) => r.textContent);
  check("Quelldateien mit Rolle/Sprache/Markt in der Übersicht", manualRows[0].includes("Retail / DE / Deutschland") && manualRows[1].includes("HQ / EN / UK"));

  // ===================== Excel: Verbesserungen aus ROVO =====================
  await upload("final-improvements-file-input", await buildXlsx([
    ["Kapitel", "Verbesserung", "Priorität"],
    [DE1, "Prüfung der Vertragsdaten vor dem Speichern beschreiben", "hoch"],
    ["2 Kündigung", "Fristenberechnung ergänzen", "mittel"],
    ["Stammdaten pflegen", "Feld Ansprechpartner erklären", ""],
    ["Druckfunktion", "Druckvorschau ergänzen", "niedrig"],
  ]), "rovo_verbesserungen.xlsx");
  await waitUntil(() => doc.getElementById("final-improvements-files-tbody").children.length === 1, 5000);
  const impFileRow = doc.querySelector("#final-improvements-files-tbody tr");
  check("Excel-Datei gelistet mit 4 Verbesserungen, 3 zugeordnet", impFileRow.textContent.includes("rovo_verbesserungen.xlsx") && impFileRow.querySelector(".final-col-mapped").textContent === "3 von 4");
  check("Mapping automatisch auf die passende Quelldatei (DE)", impFileRow.querySelector("[data-final-improvements-source]").selectedOptions[0].textContent === "handbuch_de.docx");
  const impRows = () => Array.from(doc.querySelectorAll("#final-improvements-tbody tr"));
  const chapterOf = (i) => impRows()[i].querySelector("select").value;
  const matchOf = (i) => impRows()[i].querySelector(".final-col-match").textContent;
  check("Zeile 1: exakter Titel → Kapitel 1", chapterOf(0) === DE1 && matchOf(0) === "exakt");
  check("Zeile 2: Kapitelnummer → Kapitel 2", chapterOf(1) === DE2 && matchOf(1) === "Nummer");
  check("Zeile 3: ähnlicher Titel → Kapitel 3", chapterOf(2) === DE3 && matchOf(2).startsWith("ähnlich"));
  check("Zeile 4: kein Treffer", chapterOf(3) === "" && matchOf(3) === "kein Treffer");
  check("Übersicht zeigt Verbesserungstext mit Priorität", impRows()[0].textContent.includes("[hoch] Prüfung der Vertragsdaten"));
  const sel4 = impRows()[3].querySelector("select");
  sel4.value = DE1; fire(sel4, "change");
  check("Manuelle Zuordnung: Treffer 'manuell', Zähler 4 von 4", matchOf(3) === "manuell" && doc.querySelector("#final-improvements-files-tbody .final-col-mapped").textContent === "4 von 4");
  // Mapping auf EN umstellen -> automatische Treffer neu berechnet, manuelle (nicht mehr gueltige) verworfen
  // Die Tabelle wird nach jeder Aenderung neu aufgebaut -> Select jeweils neu holen.
  const setSource = (name) => { const srcSel = doc.querySelector("[data-final-improvements-source]"); srcSel.value = Array.from(srcSel.options).find((o) => o.textContent === name).value; fire(srcSel, "change"); };
  setSource("manual_en.docx");
  check("Mapping auf EN-Quelldatei: Zeile 2 per Nummer auf 'Chapter 2: Termination'", chapterOf(1) === EN2);
  setSource("handbuch_de.docx");
  check("Zurück auf DE: Zuordnungen wiederhergestellt", chapterOf(0) === DE1 && chapterOf(1) === DE2 && chapterOf(2) === DE3);
  const sel4b = impRows()[3].querySelector("select");
  sel4b.value = DE1; fire(sel4b, "change");

  // ===================== Schritt 3: Quelldatei + Verbesserungen waehlen =====================
  check("Vorschau: Quelldatei-Auswahl bietet Automatisch + beide Dateien", optionLabels("final-preview-manual-select").length === 3);
  selectByLabel("final-preview-manual-select", "manual_en.docx");
  check("Vorschau EN: Kapitel-Liste der EN-Datei", optionLabels("final-preview-chapter-select").join("|") === EN1 + "|" + EN2);
  check("Vorschau EN: Text aus EN-Datei, Quelle genannt", doc.getElementById("final-preview-output").textContent.includes("Contracts are changed online.") && doc.getElementById("final-preview-source-note").textContent.includes("manual_en.docx"));
  selectByLabel("final-preview-manual-select", "handbuch_de.docx");
  selectByLabel("final-preview-improvements-select", "rovo_verbesserungen.xlsx");
  setVal("final-preview-chapter-select", DE1);
  const box = doc.getElementById("final-preview-improvements");
  check("Vorschau zeigt Verbesserungen des Kapitels (2 für Kapitel 1)", !box.hidden && box.querySelectorAll("li").length === 2 && box.textContent.includes("Prüfung der Vertragsdaten"));

  // ===================== Screens: zwei Dateien, Schritt-5-Filter =====================
  await upload("final-screens-file-input", await buildDocx(img("rId1") + para("DE > Vertrag") + img("rId2") + para("DE > Kündigung"), 2), "screens_de.docx");
  await waitUntil(() => screenRows().length === 2, 5000);
  await upload("final-screens-file-input", await buildDocx(img("rId1") + para("EN > Contract"), 1), "screens_en.docx");
  await waitUntil(() => screenRows().length === 3, 5000);
  selectByLabel("final-screens-file-filter-select", "screens_en.docx");
  check("Schritt 5: Filter auf eine Screens-Datei zeigt nur deren Screens", screenRows().length === 1 && navOf(screenRows()[0]) === "EN > Contract");
  const assign = (nav, title) => { const sel = screenRows().find((r) => navOf(r) === nav).querySelector("select"); sel.value = title; fire(sel, "change"); };
  assign("EN > Contract", EN1);
  selectByLabel("final-screens-file-filter-select", "Alle Screens-Dateien");
  check("Filter 'Alle' zeigt wieder alle 3 Screens", screenRows().length === 3);
  assign("DE > Vertrag", DE1);
  assign("DE > Kündigung", DE2);

  // ===================== Schritt 6: zwei Staende =====================
  const buildBtn = doc.getElementById("final-build-master-btn");
  const note = doc.getElementById("final-build-master-status-note");
  selectByLabel("final-build-manual-select", "handbuch_de.docx");
  selectByLabel("final-build-improvements-select", "rovo_verbesserungen.xlsx");
  selectByLabel("final-build-screens-select", "screens_de.docx");
  setVal("final-build-name-input", "DE – Retail");
  note.textContent = "";
  fire(buildBtn, "click");
  await waitUntil(() => note.textContent.includes("zusammengeführt"), 10000);
  check("Stand 'DE – Retail' erzeugt (Entwurf, Verbesserungen hinterlegt)", note.textContent.includes("„DE – Retail“ (Entwurf)") && note.textContent.includes("4 Verbesserung(en)"));
  selectByLabel("final-build-manual-select", "manual_en.docx");
  selectByLabel("final-build-improvements-select", "– keine –");
  selectByLabel("final-build-screens-select", "screens_en.docx");
  setVal("final-build-name-input", "EN – HQ");
  note.textContent = "";
  fire(buildBtn, "click");
  await waitUntil(() => note.textContent.includes("zusammengeführt"), 10000);
  check("Zweiter Stand 'EN – HQ' erzeugt", note.textContent.includes("„EN – HQ“"));
  check("Stände-Tabelle: 2 Stände, beide Entwurf, EN aktiv", versionRows().length === 2 && versionRows().every((r) => r.textContent.includes("Entwurf")) && versionRows()[1].classList.contains("final-version-active"));
  check("Konfiguration je Stand angezeigt", versionRows()[0].textContent.includes("handbuch_de.docx · rovo_verbesserungen.xlsx · screens_de.docx") && versionRows()[1].textContent.includes("manual_en.docx · ohne Verbesserungen · screens_en.docx"));
  check("Kapitel/Screens je Stand (DE 3/2, EN 2/1)", versionRows()[0].children[3].textContent === "3 / 2" && versionRows()[1].children[3].textContent === "2 / 1");

  // ===================== Schritt 7: Stand waehlen =====================
  const resMaster = () => doc.getElementById("final-result-master-output");
  check("Schritt 7 zeigt aktiven Stand (EN)", resMaster().textContent.includes("Contracts are changed online.") && resMaster().textContent.includes("EN > Contract"));
  selectByLabel("final-result-version-select", "DE – Retail");
  doc.getElementById("final-result-chapter-select").value = DE1; fire(doc.getElementById("final-result-chapter-select"), "change");
  check("Stand-Wechsel auf DE: Master + Quellversion aus DE-Datei", resMaster().textContent.includes("Verträge werden online geändert.") && doc.getElementById("final-result-source-output").textContent.includes("Verträge werden online geändert."));
  check("Ergebnis zeigt hinterlegte Verbesserungen (noch einzuarbeiten)", !!resMaster().querySelector(".final-improvements-box") && resMaster().querySelector(".final-improvements-box").textContent.includes("Druckvorschau ergänzen"));
  check("DE-Stand ist jetzt aktiv (Tabelle + Schritt 8)", versionRows()[0].classList.contains("final-version-active") && doc.getElementById("final-design-version-select").selectedOptions[0].textContent.startsWith("DE – Retail"));

  // ===================== Status-Workflow =====================
  const statusSel = (i) => versionRows()[i].querySelector("[data-final-version-status]");
  let st = statusSel(0); st.value = "Geprüft"; fire(st, "change");
  check("Status Entwurf → Geprüft", versionRows()[0].querySelector(".final-status-pill").textContent === "Geprüft");
  st = statusSel(0); st.value = "Veröffentlicht"; fire(st, "change");
  check("Status Geprüft → Veröffentlicht", versionRows()[0].querySelector(".final-status-pill").textContent === "Veröffentlicht" && doc.getElementById("final-result-version-status").textContent === "Veröffentlicht");

  // ===================== Schritt 8: Export des gewaehlten Stands =====================
  selectByLabel("final-design-version-select", "EN – HQ");
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-docx-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 10000);
  const docxZip = savedFiles.length ? await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer())) : null;
  const docXml = docxZip ? await docxZip.file("word/document.xml").async("string") : "";
  check("Word-Export enthält den in Schritt 8 gewählten Stand (EN)", docXml.includes("Contracts are changed online.") && !docXml.includes("Verträge werden online"));

  // ===================== Register Editor: interne Dokumente =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  const docRows = () => Array.from(doc.querySelectorAll("#edito-final-docs-tbody tr"));
  check("Editor listet 2 interne Dokumente mit Datum und Status", docRows().length === 2 && docRows().some((r) => r.textContent.includes("DE – Retail") && r.textContent.includes("Veröffentlicht")) && docRows().every((r) => /\d{1,2}\.\d{1,2}\.\d{4}/.test(r.children[1].textContent)));
  check("Arbeitsbereich erst nach Auswahl sichtbar", doc.getElementById("edito-final-work").hidden);
  fire(docRows().find((r) => r.textContent.includes("DE – Retail")).querySelector("[data-edito-final-select]"), "click");
  check("Dokument ausgewählt: Kapitel und Verbesserungen angezeigt", !doc.getElementById("edito-final-work").hidden && doc.querySelectorAll("#edito-final-chapters-tbody tr").length === 3 && doc.getElementById("edito-final-selected-note").textContent.includes("4 Verbesserung(en)"));
  sampleCalls.length = 0;
  fire(doc.getElementById("edito-final-agent-improve-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-final-agent-status").textContent.includes("Kapitel optimiert"), 5000);
  check("Agent bekommt Verbesserungen + Kapiteltext (3 Kapitel mit Verbesserungen)", sampleCalls.length === 3 && sampleCalls[0].input.includes("VERBESSERUNGEN AUS ROVO") && sampleCalls[0].input.includes("Prüfung der Vertragsdaten"));
  const chapStatus = (title) => doc.querySelector('#edito-final-chapters-tbody tr[data-edito-final-chapter-row="' + title + '"] .edito-final-col-status').textContent;
  check("Kapitel 1 optimiert", chapStatus(DE1).includes("optimiert"));
  check("Kapitel 2 verworfen (Bild-Platzhalter verändert)", chapStatus(DE2).includes("verworfen") && chapStatus(DE2).includes("Bild-Platzhalter"));
  check("Statuszeile fasst zusammen", doc.getElementById("edito-final-agent-status").textContent.includes("2 von 3 Kapitel optimiert, 1 verworfen"));
  fire(doc.querySelector('[data-edito-final-compare="' + DE1 + '"]'), "click");
  check("Vergleich Bisher/Optimiert", !doc.getElementById("edito-final-compare").hidden && doc.getElementById("edito-final-compare-new").textContent.includes("Neu: Vertragsdaten werden vor dem Speichern geprüft.") && !doc.getElementById("edito-final-compare-old").textContent.includes("Neu:"));
  fire(doc.getElementById("edito-final-agent-review-btn"), "click");
  await waitUntil(() => !doc.getElementById("edito-final-report-wrap").hidden, 5000);
  check("Prüfbericht angezeigt", doc.getElementById("edito-final-report").textContent.includes("Gesamtempfehlung"));
  setVal("edito-final-save-name-input", "DE – Retail (optimiert)");
  fire(doc.getElementById("edito-final-save-btn"), "click");
  await wait(100);
  check("Neuer Stand aus dem Editor (Entwurf) in der Liste", docRows().length === 3 && docRows()[0].textContent.includes("DE – Retail (optimiert)") && docRows()[0].textContent.includes("Entwurf") && docRows()[0].textContent.includes("im Editor optimiert"));

  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);
  check("FINAL: 3 Stände, optimierter Stand aktiv", versionRows().length === 3 && versionRows()[2].classList.contains("final-version-active"));
  doc.getElementById("final-result-chapter-select").value = DE1; fire(doc.getElementById("final-result-chapter-select"), "change");
  check("Ergebnis des neuen Stands enthält die eingearbeitete Verbesserung und den Screen", resMaster().textContent.includes("Neu: Vertragsdaten werden vor dem Speichern geprüft.") && resMaster().textContent.includes("[Bild: DE > Vertrag]"));
  doc.getElementById("final-result-chapter-select").value = DE2; fire(doc.getElementById("final-result-chapter-select"), "change");
  check("Verworfenes Kapitel bleibt unverändert (mit Screen)", resMaster().textContent.includes("Kündigungen werden erfasst.") && resMaster().textContent.includes("[Bild: DE > Kündigung]") && !resMaster().textContent.includes("Ohne Bild."));
  fire(versionRows()[2].querySelector("[data-final-version-editor]"), "click");
  check("'Im Editor optimieren' springt ins Register Editor mit diesem Dokument", !doc.querySelector('.view-panel[data-view-panel="edito"]').hidden && doc.getElementById("edito-final-selected-note").textContent.includes("DE – Retail (optimiert)"));
  doc.querySelector('.nav-item[data-view="final"]').click();

  // ===================== Sitzung speichern/laden =====================
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  check("Sitzung enthält Stände (mit Status/Historie) und Verbesserungs-Excel", session.final.versions.length === 3 && session.final.versions[0].status === "Veröffentlicht" &&
    session.final.versions[0].history.map((h) => h.status).join(">") === "Entwurf>Geprüft>Veröffentlicht" && session.final.improvementFiles.length === 1);
  const input = doc.getElementById("session-import-input");
  Object.defineProperty(input, "files", { value: [new win.File([savedFiles[0].data], "s.json", { type: "application/json" })], configurable: true });
  fire(input, "change");
  await wait(60);
  if (!doc.getElementById("confirm-modal-overlay").hidden) await confirmViaModal(doc);
  await wait(400);
  doc.querySelector('.nav-item[data-view="final"]').click();
  check("Nach Laden: 3 Stände und Excel-Mapping wiederhergestellt", versionRows().length === 3 && doc.querySelector("#final-improvements-files-tbody .final-col-mapped").textContent === "4 von 4");

  // ===================== Stand loeschen =====================
  fire(versionRows()[1].querySelector("[data-final-version-delete]"), "click");
  await confirmViaModal(doc);
  check("Stand gelöscht (2 übrig)", versionRows().length === 2 && !versionRows().some((r) => r.textContent.includes("EN – HQ")));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-STÄNDE/VERBESSERUNGEN/EDITOR-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
