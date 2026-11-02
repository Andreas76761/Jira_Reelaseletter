// v2.111.0: FINAL Abschnitt 5 "Bilder zuordnen" (Claude interpretiert Screens,
// schlaegt Untertitel + Kapitel/Unterkapitel vor, Status "Entwurf"; manuelle
// Aenderung -> "Manuell", wird bei erneutem Lauf nicht ueberschrieben;
// Loeschen; Doppelklick oeffnet den Bildbetrachter; oneSCM-Navigationstext je
// Bild aus der Screens-Datei als Teil der Bildunterschrift) sowie die Fixes
// F1 (ID-Zaehler nach Sitzung-Laden), F2 (Alle-auswaehlen-Checkbox), F5
// (Mermaid-Rendering) und F6 (Rovo-Summary-Quellenbudget).
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
const state = { imagesEnabled: true };
const KAP1 = "Kapitel 1: Verträge";
const KAP2 = "Kapitel 2: Kündigung";
const KAP21 = "Kapitel 2.1: Fristen";

function cannedAssignment(input) {
  const rows = [];
  input.split("\n").forEach((line) => {
    const m = /^\[(\d+)\] Navigation in oneSCM: (.*?) \|/.exec(line);
    if (!m) return;
    const nav = m[2];
    if (nav.includes("Vertrag ändern")) rows.push({ nr: +m[1], kapitel: KAP1, untertitel: "Maske zum Ändern eines Vertrags" });
    else if (nav.includes("Fristen")) rows.push({ nr: +m[1], kapitel: "kapitel 2.1: fristen", untertitel: "Übersicht der Kündigungsfristen" });
    else rows.push({ nr: +m[1], kapitel: "Kapitel 99: Gibt es nicht", untertitel: "Händlerstammdaten" });
  });
  return rows;
}

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.mermaid = { initialize() {}, render: async (id, src) => ({ svg: '<svg data-test-mermaid="1" id="' + id + '"><text>' + src.length + "</text></svg>" }) };
    const sample = function (input, opts) {
      sampleCalls.push({ kind: "text", input, opts });
      return Promise.resolve({ text: "## Gesamtdokument\nInhalt.", truncated: false, modelTierApplied: "default" });
    };
    sample.json = function (input, opts) {
      sampleCalls.push({ kind: "json", input, opts });
      return Promise.resolve(cannedAssignment(input));
    };
    sample.limits = function () {
      return Promise.resolve(state.imagesEnabled ? { maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 5000000, mediaTypes: ["image/png", "image/jpeg"] } } : { maxPromptBytes: 262144 });
    };
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
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"';
function heading(text, level) { return '<w:p><w:pPr><w:pStyle w:val="Heading' + (level || 1) + '"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>"; }
function para(text) { return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function drawing(rId) { return '<w:r><w:drawing><a:blip r:embed="' + rId + '"/></w:drawing></w:r>'; }
// Word legt ein Textfeld typischerweise doppelt ab (mc:Choice + mc:Fallback).
function textbox(text) {
  const box = "<w:txbxContent><w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p></w:txbxContent>";
  return "<w:r><mc:AlternateContent><mc:Choice Requires=\"wps\"><w:drawing><wps:txbx>" + box + "</wps:txbx></w:drawing></mc:Choice>" +
    "<mc:Fallback><w:pict><v:textbox>" + box + "</v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>";
}
async function buildDocx(bodyXml, imageCount) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "</w:body></w:document>");
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= imageCount; i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG);
  }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  async function uploadTo(inputId, buf, name, mime) {
    const input = doc.getElementById(inputId);
    Object.defineProperty(input, "files", { value: [new win.File([buf], name, { type: mime })], configurable: true });
    fire(input, "change");
  }
  const rows = () => Array.from(doc.querySelectorAll("#final-screens-tbody tr"));
  const rowFor = (navPart) => rows().find((r) => r.querySelector(".final-col-nav").textContent.includes(navPart));

  // ===================== Tickets (fuer Reset-Guard, F2, F6) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);
  let items = "";
  for (let i = 1; i <= 400; i++) {
    items += "<item><key>FX-" + i + "</key><summary>Langer Zusammenfassungstext für Budgetprüfung Nummer " + i + " " + "x".repeat(120) + "</summary><status>Offen</status><type>Task</type></item>";
  }
  await uploadTo("file-input", "<?xml version=\"1.0\"?><rss><channel>" + items + "</channel></rss>", "fx.xml", "application/xml");
  await waitUntil(() => doc.getElementById("stat-tickets").textContent === "400", 15000);
  check("400 Tickets importiert", doc.getElementById("stat-tickets").textContent === "400");

  // ===================== F2: Alle-auswaehlen-Checkbox =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(100);
  const selectAll = doc.getElementById("select-all-checkbox");
  selectAll.checked = true;
  const t0 = Date.now();
  fire(selectAll, "change");
  const selectMs = Date.now() - t0;
  check("Alle-auswählen-Checkbox wählt alle 400 Treffer aus", doc.getElementById("selection-count").textContent.startsWith("400 "));
  check("Alle-auswählen bleibt schnell (" + selectMs + " ms, ein einziges UI-Update)", selectMs < 3000);
  selectAll.checked = false;
  fire(selectAll, "change");
  check("Abwählen hebt die Auswahl wieder auf", doc.getElementById("selection-count").textContent.startsWith("0 "));

  // ===================== FINAL: Handbuch + Screens-Datei =====================
  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);
  const manualBuf = await buildDocx(heading(KAP1) + para("Verträge werden online geändert.") + heading(KAP2) + para("Kündigung.") + heading(KAP21, 2) + para("Fristen werden angezeigt."), 0);
  await uploadTo("final-manual-file-input", manualBuf, "handbuch.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  const titlesInSelect = Array.from(doc.querySelectorAll("#final-preview-chapter-select option")).map((o) => o.value);
  check("Unterkapitel (Überschrift 2) erscheint als eigener Kapitel-Eintrag", titlesInSelect.includes(KAP21));

  const screensBody = heading("Screens Retail") +
    "<w:p>" + drawing("rId1") + textbox("Verträge > Vertrag ändern") + "</w:p>" +
    "<w:tbl><w:tr><w:tc><w:p>" + drawing("rId2") + "</w:p></w:tc><w:tc>" + para("Kündigung > Fristen anzeigen") + "</w:tc></w:tr></w:tbl>" +
    "<w:p>" + drawing("rId3") + "</w:p>" + para("Stammdaten > Händler");
  await uploadTo("final-screens-file-input", await buildDocx(screensBody, 3), "screens.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await waitUntil(() => rows().length === 3, 5000);
  check("3 Screens extrahiert", rows().length === 3);
  check("Navigation aus Textfeld gelesen (doppelte Ablage mc:Choice/mc:Fallback nur einmal)", !!rowFor("Verträge > Vertrag ändern") && rowFor("Verträge > Vertrag ändern").querySelector(".final-col-nav").textContent === "Verträge > Vertrag ändern");
  check("Navigation aus Nachbarzelle der Tabellenzeile gelesen", !!rowFor("Kündigung > Fristen anzeigen"));
  check("Navigation aus folgendem Absatz gelesen", !!rowFor("Stammdaten > Händler"));
  check("Untertitel ist mit dem Navigationstext vorbelegt", rowFor("Stammdaten > Händler").querySelector("[data-final-screen-caption]").value === "Stammdaten > Händler");
  check("Status anfangs 'Offen'", rows().every((r) => r.querySelector(".final-col-status").textContent.includes("Offen")));
  check("Spalten Untertitel + oneSCM-Navigation im Tabellenkopf", doc.querySelector("#final-screens-table thead").textContent.includes("Untertitel") && doc.querySelector("#final-screens-table thead").textContent.includes("oneSCM-Navigation"));

  // ===================== Bilder zuordnen (mit Bildern) =====================
  sampleCalls.length = 0;
  fire(doc.getElementById("final-assign-images-btn"), "click");
  await waitUntil(() => doc.getElementById("final-assign-images-status-note").textContent.includes("interpretiert,"), 5000);
  const call1 = sampleCalls.filter((c) => c.kind === "json")[0];
  check("Claude genau einmal (ein Stapel) aufgerufen", sampleCalls.filter((c) => c.kind === "json").length === 1);
  check("Die 3 Bilder wurden als Blobs mitgeschickt", !!call1 && Array.isArray(call1.opts.images) && call1.opts.images.length === 3 && call1.opts.images.every((b) => b instanceof win.Blob && b.type === "image/png"));
  check("Prompt enthält Kapitel-Liste inkl. Unterkapitel", !!call1 && call1.input.includes("KAPITEL-LISTE") && call1.input.includes(KAP21));
  check("Prompt enthält Navigationstexte", !!call1 && call1.input.includes("Navigation in oneSCM: Verträge > Vertrag ändern"));
  check("Screen 1 -> Kapitel 1 zugeordnet", rowFor("Vertrag ändern").querySelector("select").value === KAP1);
  check("Screen 2 -> Unterkapitel 2.1 (Groß-/Kleinschreibung toleriert)", rowFor("Fristen anzeigen").querySelector("select").value === KAP21);
  check("Unbekanntes Kapitel aus Claude-Antwort wird NICHT übernommen", rowFor("Händler").querySelector("select").value === "");
  check("Untertitel von Claude übernommen", rowFor("Vertrag ändern").querySelector("[data-final-screen-caption]").value === "Maske zum Ändern eines Vertrags");
  check("Status 'Entwurf' nach der Zuordnung", rows().every((r) => r.querySelector(".final-col-status").textContent.includes("Entwurf")));
  check("Statuszeile meldet 2 von 3 zugeordnet", doc.getElementById("final-assign-images-status-note").textContent.includes("3 Screen(s) interpretiert, 2 einem Kapitel"));

  // ===================== Entwurf manuell umhaengen -> "Manuell", erneuter Lauf laesst ihn aus =====================
  let sel = rowFor("Händler").querySelector("select");
  sel.value = KAP2;
  fire(sel, "change");
  check("Manuelle Änderung setzt Status 'Manuell'", rowFor("Händler").querySelector(".final-col-status").textContent.includes("Manuell"));
  state.imagesEnabled = false;
  sampleCalls.length = 0;
  doc.getElementById("final-assign-images-status-note").textContent = "";
  fire(doc.getElementById("final-assign-images-btn"), "click");
  await waitUntil(() => doc.getElementById("final-assign-images-status-note").textContent.includes("interpretiert,"), 5000);
  const call2 = sampleCalls.filter((c) => c.kind === "json")[0];
  check("Erneuter Lauf schickt nur die 2 Nicht-manuellen Screens", !!call2 && (call2.input.match(/^\[\d+\] Navigation/gm) || []).length === 2);
  check("Ohne Bildfreigabe: keine Bilder mitgeschickt", !!call2 && !call2.opts.images);
  check("Ohne Bildfreigabe: Hinweis in der Statuszeile", doc.getElementById("final-assign-images-status-note").textContent.includes("nur anhand von Navigationstext"));
  check("Manuell zugeordneter Screen bleibt unverändert", rowFor("Händler").querySelector("select").value === KAP2);

  // ===================== Untertitel bearbeiten, Doppelklick, Loeschen =====================
  const capInput = rowFor("Vertrag ändern").querySelector("[data-final-screen-caption]");
  capInput.value = "Vertragsmaske (bearbeitet)";
  fire(capInput, "input");
  check("Untertitel-Eingabe wird übernommen", rowFor("Vertrag ändern").querySelector("[data-final-screen-caption]").value === "Vertragsmaske (bearbeitet)");
  check("Bearbeiteter Untertitel setzt Status 'Manuell' (erneuter Lauf überschreibt ihn nicht)", rowFor("Vertrag ändern").querySelector(".final-col-status").textContent.includes("Manuell"));
  const thumb = rowFor("Vertrag ändern").querySelector("[data-final-screen-view]");
  thumb.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }));
  await waitUntil(() => !doc.getElementById("image-viewer-window").hidden, 3000);
  check("Doppelklick öffnet das Bild im Betrachter-Fenster", !doc.getElementById("image-viewer-window").hidden);
  fire(doc.getElementById("image-viewer-close-btn"), "click");
  fire(rowFor("Fristen anzeigen").querySelector("[data-final-screen-delete]"), "click");
  await confirmViaModal(doc);
  check("Löschen entfernt genau einen Screen", rows().length === 2 && !rowFor("Fristen anzeigen"));

  // ===================== Master: Bildunterschrift = Untertitel + Navigation =====================
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => doc.getElementById("final-build-master-status-note").textContent.includes("zusammengeführt"), 10000);
  const resultSel = doc.getElementById("final-result-chapter-select");
  resultSel.value = KAP1;
  fire(resultSel, "change");
  check("Master-Vorschau: Untertitel + oneSCM-Navigation als Bildunterschrift", doc.getElementById("final-result-master-output").textContent.includes("[Bild: Vertragsmaske (bearbeitet) – Navigation: Verträge > Vertrag ändern]"));
  savedFiles.length = 0;
  fire(doc.getElementById("final-master-download-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  let docXml = "";
  if (savedFiles.length) docXml = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("word/document.xml").async("string");
  check("Word-Master enthält die Bildunterschrift mit Navigation", docXml.includes("Vertragsmaske (bearbeitet) – Navigation: Verträge &gt; Vertrag ändern"));

  // ===================== F1: ID-Zaehler nach Sitzung-Laden =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const sessionJson = savedFiles.length ? savedFiles[0].data : "{}";
  const exported = JSON.parse(sessionJson);
  check("Sitzung enthält Navigationstext + Status der Screens", exported.uploadedImages.some((i) => i.finalNavText === "Stammdaten > Händler" && i.finalStatus === "Manuell"));
  // Neue Seite simulieren: Zaehler stehen dort wieder auf 1 - Laden muss sie vorziehen.
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "s.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="final"]').click();
  await waitUntil(() => rows().length === 2, 3000);
  check("Nach Laden: 2 Screens wiederhergestellt", rows().length === 2);
  await uploadTo("final-screens-file-input", await buildDocx("<w:p>" + drawing("rId1") + "</w:p>" + para("Neu > Screen"), 1), "neu.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await waitUntil(() => rows().length === 3, 5000);
  const ids = rows().map((r) => r.querySelector("[data-final-screen-view]").getAttribute("data-final-screen-view"));
  check("Neuer Screen nach dem Laden bekommt eine noch nicht vergebene ID", new Set(ids).size === 3);
  fire(rowFor("Neu > Screen").querySelector("[data-final-screen-delete]"), "click");
  await confirmViaModal(doc);
  check("Löschen des neuen Screens entfernt nur ihn (keine ID-Kollision)", rows().length === 2 && !!rowFor("Vertrag ändern") && !!rowFor("Händler"));

  // ===================== F5: Mermaid wird gerendert =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  await wait(100);
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await waitUntil(() => !!doc.querySelector("#prozessbild-render pre.mermaid-rendered"), 3000);
  check("Mermaid-Diagramm wird als SVG gezeichnet", !!doc.querySelector('#prozessbild-render pre.mermaid-rendered svg[data-test-mermaid="1"]'));
  check("Mermaid-Quelltext bleibt im Aufklapper verfügbar", (doc.querySelector("#prozessbild-render .mermaid-source") || {}).textContent.includes("flowchart"));

  // ===================== F6: Rovo-Summary-Vergleich kuerzt je Quelle =====================
  doc.querySelector('.nav-item[data-view="rovosummary"]').click();
  await wait(100);
  doc.getElementById("rovo-summary-paste-textarea").value = "Neue Quelle mit Inhalt.";
  fire(doc.getElementById("rovo-summary-paste-add-btn"), "click");
  await wait(100);
  fire(doc.getElementById("rovo-summary-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("rovo-summary-merge-status-note").textContent.includes("erzeugt"), 5000);
  sampleCalls.length = 0;
  fire(doc.getElementById("rovo-summary-compare-btn"), "click");
  await waitUntil(() => sampleCalls.length === 1, 5000);
  const cmp = sampleCalls[0] ? sampleCalls[0].input : "";
  check("Vergleich: alle 5 Quellen trotz langer Ticketliste im Prompt", ["QUELLE A", "QUELLE B", "QUELLE C", "QUELLE D", "QUELLE E"].every((q) => cmp.includes(q)));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-BILDZUORDNUNG/FIX-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
