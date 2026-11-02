// v2.112.0 FINAL-Erweiterungen: Rolle +HQ, Sparte nur Pkw/Van; interne
// Vermerke gelb / Jira-Nummern blau in Vorschau + Ergebnis; Screens markieren
// (einzeln/alle), Sammel-Zuordnung, Sammel-Loeschen, Screens-Datei loeschen;
// Original-Design (Formatvorlagen) der Handbuch-Datei wird gespeichert und im
// Word-Export verwendet (lokalisierte Style-IDs ueber den Namen zugeordnet);
// Schritt 8: Word-/PowerPoint-Design waehlen, eigene Vorlagen, PowerPoint-Export.
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
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
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
async function lastSavedZip() { return JSZipNode.loadAsync(Buffer.from(await savedFiles[savedFiles.length - 1].data.arrayBuffer())); }

const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
// Deutsches Word: lokalisierte Style-IDs ("berschrift1"), englische Namen ("heading 1").
const DE_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:rPr><w:color w:val="AA0000"/><w:sz w:val="40"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/><w:rPr><w:color w:val="AA0000"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style></w:styles>';
function heading(text, styleId) { return '<w:p><w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr><w:r><w:t>' + esc(text) + "</w:t></w:r></w:p>"; }
function para(text) { return "<w:p><w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function commented(before, inside, after) {
  return '<w:p><w:r><w:t xml:space="preserve">' + esc(before) + '</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">' + esc(inside) +
    '</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t xml:space="preserve">' + esc(after) + "</w:t></w:r></w:p>";
}
async function buildDocx(bodyXml, opts) {
  opts = opts || {};
  const zip = new JSZipNode();
  const sect = opts.landscape ? '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>' : "";
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + sect + "</w:body></w:document>");
  if (opts.styles) zip.file("word/styles.xml", opts.styles);
  if (opts.theme) zip.file("word/theme/theme1.xml", opts.theme);
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= (opts.images || 0); i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG);
  }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

const KAP1 = "Kapitel 1: Verträge";
const KAP2 = "Kapitel 2: Kündigung";

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
  const rows = () => Array.from(doc.querySelectorAll("#final-screens-tbody tr"));

  doc.querySelector('.nav-item[data-view="import"]').click();
  await upload("file-input", '<?xml version="1.0"?><rss><channel><item><key>DB-1</key><summary>Dummy</summary><status>Offen</status><type>Task</type></item></channel></rss>', "d.xml");
  await wait(400);
  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);

  // ===================== Rolle / Sparte =====================
  const roles = Array.from(doc.querySelectorAll("#final-screens-rolle-select option")).map((o) => o.value);
  const spartes = Array.from(doc.querySelectorAll("#final-screens-sparte-select option")).map((o) => o.value + "|" + o.textContent);
  check("Rolle bietet HQ an", roles.includes("HQ"));
  check("Sparte bietet nur Pkw und Van (+ beide), kein Markt", spartes.join(",") === "|Pkw und Van (beide),Pkw|Pkw,Van|Van");
  check("Filter-Sparte ohne Markt", !Array.from(doc.querySelectorAll("#final-filter-sparte-select option")).some((o) => o.value === "Markt"));
  check("Schritt-Überschriften mit Icons (8 Schritte)", doc.querySelectorAll('[data-view-panel="final"] .final-step-label svg').length === 8);

  // ===================== Handbuch mit Original-Design + Vermerk + Jira =====================
  const manual = await buildDocx(
    heading(KAP1, "berschrift1") + commented("Der Dealer ändert Verträge. ", "TODO: Rechtsprüfung offen.", " Siehe auch ABC-123.") +
    heading(KAP2, "berschrift1") + para("Kündigung über DEF-456."),
    { styles: DE_STYLES, theme: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Firmentheme"/>', landscape: true });
  await upload("final-manual-file-input", manual, "firmenhandbuch.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  check("Handbuch-Tabelle zeigt 'Original-Design gespeichert'", doc.getElementById("final-manuals-tbody").textContent.includes("Original-Design gespeichert"));

  const sel = doc.getElementById("final-preview-chapter-select");
  sel.value = KAP1; fire(sel, "change");
  const prev = doc.getElementById("final-preview-output");
  const internalMark = prev.querySelector("mark.final-mark-internal");
  const jiraMark = prev.querySelector("mark.final-mark-jira");
  check("Vorschau: interner Vermerk gelb markiert", !!internalMark && internalMark.textContent === "TODO: Rechtsprüfung offen.");
  check("Vorschau: Jira-Nummer blau markiert", !!jiraMark && jiraMark.textContent === "ABC-123");
  check("Vorschau: Text unverändert (keine Steuerzeichen)", prev.textContent === "Der Dealer ändert Verträge. TODO: Rechtsprüfung offen. Siehe auch ABC-123.");
  doc.getElementById("final-hide-internal-cb").checked = true; fire(doc.getElementById("final-hide-internal-cb"), "change");
  check("Interne Vermerke ausgeblendet: keine gelbe Markierung mehr", !prev.querySelector("mark.final-mark-internal") && !prev.textContent.includes("TODO"));
  doc.getElementById("final-hide-jira-cb").checked = true; fire(doc.getElementById("final-hide-jira-cb"), "change");
  check("Jira-Nummern ausgeblendet: keine blaue Markierung mehr", !prev.querySelector("mark.final-mark-jira") && !prev.textContent.includes("ABC-123"));
  doc.getElementById("final-hide-internal-cb").checked = false; fire(doc.getElementById("final-hide-internal-cb"), "change");
  doc.getElementById("final-hide-jira-cb").checked = false; fire(doc.getElementById("final-hide-jira-cb"), "change");

  // ===================== Zwei Screens-Dateien, markieren, Sammelaktionen =====================
  doc.getElementById("final-screens-rolle-select").value = "HQ";
  doc.getElementById("final-screens-sparte-select").value = "Van";
  await upload("final-screens-file-input", await buildDocx('<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' + para("A > Eins") +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>' + para("A > Zwei") +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId3"/></w:drawing></w:r></w:p>' + para("A > Drei"), { images: 3 }), "screens_a.docx");
  await waitUntil(() => rows().length === 3, 5000);
  await upload("final-screens-file-input", await buildDocx('<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' + para("B > Eins"), { images: 1 }), "screens_b.docx");
  await waitUntil(() => rows().length === 4, 5000);
  check("4 Screens aus 2 Dateien", rows().length === 4);
  check("Rolle/Sparte HQ / Van übernommen", rows().some((r) => r.textContent.includes("HQ / Van")));
  check("Zeilen haben Markier-Checkbox, Bearbeiten- und Löschen-Button mit Icon", rows().every((r) => r.querySelector("[data-final-screen-select]") && r.querySelector("[data-final-screen-edit] svg") && r.querySelector("[data-final-screen-delete] svg")));

  const rowByNav = (nav) => rows().find((r) => r.children[3].textContent === nav);
  const cbFor = (nav) => rowByNav(nav).querySelector("[data-final-screen-select]");
  let cb = cbFor("A > Eins"); cb.checked = true; fire(cb, "change");
  cb = cbFor("A > Zwei"); cb.checked = true; fire(cb, "change");
  check("Zähler: 2 markiert", doc.getElementById("final-selected-count").textContent === "2 markiert");
  check("Alle-markieren-Checkbox halb gesetzt", doc.getElementById("final-screens-select-all-cb").indeterminate === true);
  check("Kapitel-zuweisen ohne Kapitelwahl deaktiviert", doc.getElementById("final-bulk-assign-btn").disabled);
  const bulkSel = doc.getElementById("final-bulk-chapter-select");
  bulkSel.value = KAP2; fire(bulkSel, "change");
  fire(doc.getElementById("final-bulk-assign-btn"), "click");
  check("Sammel-Zuordnung: beide markierten Screens -> Kapitel 2", rowByNav("A > Eins").querySelector("select").value === KAP2 && rowByNav("A > Zwei").querySelector("select").value === KAP2);
  check("Sammel-Zuordnung setzt Status 'Manuell'", rowByNav("A > Eins").children[6].textContent.includes("Manuell"));
  check("Nicht markierter Screen unverändert", rowByNav("A > Drei").querySelector("select").value === "");
  check("Markierung bleibt nach der Zuordnung erhalten", cbFor("A > Eins").checked && cbFor("A > Zwei").checked);
  fire(doc.getElementById("final-bulk-delete-btn"), "click");
  await confirmViaModal(doc);
  check("Markierte löschen entfernt genau die 2 markierten Screens", rows().length === 2 && !rowByNav("A > Eins") && !rowByNav("A > Zwei"));
  check("Zähler nach dem Löschen wieder 0", doc.getElementById("final-selected-count").textContent === "0 markiert");

  const allCb = doc.getElementById("final-screens-select-all-cb");
  allCb.checked = true; fire(allCb, "change");
  check("Alle markieren markiert alle Screens", rows().every((r) => r.querySelector("[data-final-screen-select]").checked) && doc.getElementById("final-selected-count").textContent === "2 markiert");
  allCb.checked = false; fire(allCb, "change");
  check("Alle abwählen", doc.getElementById("final-selected-count").textContent === "0 markiert");

  fire(rowByNav("A > Drei").querySelector("[data-final-screen-edit]"), "click");
  check("Bearbeiten setzt den Fokus ins Untertitel-Feld", doc.activeElement === rowByNav("A > Drei").querySelector("[data-final-screen-caption]"));

  const fileRows = () => Array.from(doc.querySelectorAll("#final-screens-files-tbody tr"));
  const removeB = fileRows().find((r) => r.textContent.includes("screens_b.docx")).querySelector("[data-final-screens-file-remove]");
  fire(removeB, "click");
  await confirmViaModal(doc);
  check("Screens-Datei löschen entfernt Datei und ihre Screens", fileRows().length === 1 && rows().length === 1 && !rowByNav("B > Eins"));

  const drei = rowByNav("A > Drei").querySelector("select");
  drei.value = KAP1; fire(drei, "change");

  // ===================== Master + Ergebnis-Markierungen =====================
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => doc.getElementById("final-build-master-status-note").textContent.includes("zusammengeführt"), 10000);
  const resSel = doc.getElementById("final-result-chapter-select");
  resSel.value = KAP1; fire(resSel, "change");
  check("Ergebnis-Quellversion: Vermerk gelb + Jira blau", !!doc.querySelector("#final-result-source-output mark.final-mark-internal") && !!doc.querySelector("#final-result-source-output mark.final-mark-jira"));
  check("Ergebnis-Master: Vermerk gelb + Jira blau", !!doc.querySelector("#final-result-master-output mark.final-mark-internal") && !!doc.querySelector("#final-result-master-output mark.final-mark-jira"));

  // ===================== Schritt 8: Word-Design =====================
  const wordSel = doc.getElementById("final-word-design-select");
  const wordOpts = Array.from(wordSel.options).map((o) => o.value);
  check("Word-Design: Original-Design voreingestellt", wordSel.value.startsWith("orig:") && wordSel.selectedOptions[0].textContent.includes("firmenhandbuch.docx"));
  check("Word-Design: 3 App-Designs wählbar", ["app:standard", "app:klassisch", "app:modern"].every((k) => wordOpts.includes(k)));
  check("Download-Buttons in Schritt 8 aktiv nach Master", !doc.getElementById("final-design-docx-btn").disabled && !doc.getElementById("final-design-pptx-btn").disabled);

  savedFiles.length = 0;
  fire(doc.getElementById("final-design-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  let z = await lastSavedZip();
  let docXml = await z.file("word/document.xml").async("string");
  const ct = await z.file("[Content_Types].xml").async("string");
  const rels = await z.file("word/_rels/document.xml.rels").async("string");
  check("Original-Design: styles.xml der Handbuch-Datei übernommen", (await z.file("word/styles.xml").async("string")) === DE_STYLES);
  check("Original-Design: Theme übernommen", (await z.file("word/theme/theme1.xml").async("string")).includes("Firmentheme"));
  check("Original-Design: Kapitelüberschrift nutzt lokalisierte Style-ID 'berschrift1'", docXml.includes('<w:pStyle w:val="berschrift1"/>') && !docXml.includes('w:val="Heading1"'));
  check("Original-Design: Titel nutzt Style 'Titel'", docXml.includes('<w:pStyle w:val="Titel"/>'));
  check("Original-Design: Seitenformat (Querformat + Ränder) übernommen", docXml.includes('w:orient="landscape"') && docXml.includes('w:top="567"'));
  check("Styles/Theme in Content-Types und Beziehungen registriert", ct.includes("/word/styles.xml") && ct.includes("/word/theme/theme1.xml") && rels.includes('Target="styles.xml"') && rels.includes('Target="theme/theme1.xml"'));
  check("Word-Export enthält Fußzeile weiterhin", !!z.file("word/footer1.xml"));
  check("Word-Export enthält Screen + Bildunterschrift", docXml.includes("A &gt; Drei") && !!Object.keys(z.files).find((p) => p.startsWith("word/media/")));

  wordSel.value = "app:modern"; fire(wordSel, "change");
  check("Design-Hinweis wechselt zum App-Design", doc.getElementById("final-word-design-note").textContent.includes("Segoe UI"));
  savedFiles.length = 0;
  fire(doc.getElementById("final-master-download-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  z = await lastSavedZip();
  const appStyles = await z.file("word/styles.xml").async("string");
  docXml = await z.file("word/document.xml").async("string");
  check("Schritt-6-Word-Export nutzt das gewählte App-Design", appStyles.includes('w:ascii="Segoe UI"') && appStyles.includes('w:val="1F4E79"'));
  check("App-Design: Standard-Style-IDs (Heading1/Title)", docXml.includes('<w:pStyle w:val="Heading1"/>') && docXml.includes('<w:pStyle w:val="Title"/>'));

  const tpl = await buildDocx(para("Vorlage"), { styles: DE_STYLES.replace("AA0000", "00AA00") });
  await upload("final-word-template-input", tpl, "firmenvorlage.dotx");
  await waitUntil(() => wordSel.value === "tpl", 5000);
  check("Word-Vorlage hochgeladen und ausgewählt", wordSel.value === "tpl" && wordSel.selectedOptions[0].textContent.includes("firmenvorlage.dotx"));
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  z = await lastSavedZip();
  check("Word-Export mit eigener Vorlage", (await z.file("word/styles.xml").async("string")).includes("00AA00"));

  // ===================== Schritt 8: PowerPoint =====================
  const pptSel = doc.getElementById("final-ppt-design-select");
  check("PowerPoint: App-Design 'Standard' voreingestellt", pptSel.value === "app:standard");
  pptSel.value = "app:klassisch"; fire(pptSel, "change");
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-pptx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 8000);
  check("PowerPoint gespeichert (.pptx)", savedFiles.length === 1 && /\.pptx$/.test(savedFiles[0].filename));
  z = await lastSavedZip();
  let pres = await z.file("ppt/presentation.xml").async("string");
  const slideFiles = Object.keys(z.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  // Titel + Kapitel 1 (Text) + Kapitel 1 (Bild) + Kapitel 2 (Text)
  check("PowerPoint: 4 Folien (Titel, 2 Kapitel, 1 Bild)", slideFiles.length === 4 && (pres.match(/<p:sldId /g) || []).length === 4);
  const allSlides = (await Promise.all(slideFiles.map((p) => z.file(p).async("string")))).join("\n");
  check("PowerPoint: Kapiteltitel und Text enthalten", allSlides.includes(KAP1) && allSlides.includes("Der Dealer ändert Verträge."));
  check("PowerPoint: Bildfolie mit eingebettetem Bild + Bildunterschrift", allSlides.includes("<p:pic>") && allSlides.includes("Abbildung 1: A &gt; Drei") && Object.keys(z.files).some((p) => p.startsWith("ppt/media/final_bild1")));
  check("PowerPoint: App-Design setzt Theme-Akzentfarbe + Schrift", (await z.file("ppt/theme/theme1.xml").async("string")).includes('<a:accent1><a:srgbClr val="3A3F47"/></a:accent1>'));
  const pct = await z.file("[Content_Types].xml").async("string");
  check("PowerPoint: Folien in Content-Types registriert", (pct.match(/presentationml\.slide\+xml/g) || []).length === 4);
  check("PowerPoint: XML der Folien wohlgeformt", slideFiles.length > 0 && (await Promise.all(slideFiles.map((p) => z.file(p).async("string")))).every((x) => !new win.DOMParser().parseFromString(x, "application/xml").querySelector("parsererror")));

  // Eigene Vorlage mit bereits vorhandener Folie (muss entfernt werden), als .potx
  const base = await lastSavedZip();
  let bct = await base.file("[Content_Types].xml").async("string");
  base.file("[Content_Types].xml", bct.replace("presentationml.presentation.main+xml", "presentationml.template.main+xml"));
  await upload("final-ppt-template-input", await base.generateAsync({ type: "nodebuffer" }), "firmenfolien.potx");
  await waitUntil(() => pptSel.value === "tpl", 5000);
  check("PowerPoint-Vorlage hochgeladen und ausgewählt", pptSel.value === "tpl" && pptSel.selectedOptions[0].textContent.includes("firmenfolien.potx"));
  savedFiles.length = 0;
  fire(doc.getElementById("final-design-pptx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 8000);
  z = await lastSavedZip();
  pres = await z.file("ppt/presentation.xml").async("string");
  const ct2 = await z.file("[Content_Types].xml").async("string");
  check("Vorlage: alte Folien ersetzt (wieder genau 4)", (pres.match(/<p:sldId /g) || []).length === 4 && Object.keys(z.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length === 4);
  check("Vorlage (.potx) wird als Präsentation (.pptx) ausgegeben", ct2.includes("presentationml.presentation.main+xml") && !ct2.includes("template.main+xml"));

  // ===================== Sitzung: Design-Auswahl bleibt erhalten =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const session = JSON.parse(savedFiles[0].data);
  check("Sitzung enthält Design-Auswahl und Vorlagen", session.final.wordDesign === "tpl" && session.final.pptDesign === "tpl" && !!session.final.wordTemplate && !!session.final.pptTemplate && !!session.final.manuals[0].design);

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Design zurück auf App-Standard, Buttons gesperrt", doc.getElementById("final-word-design-select").value === "app:standard" && doc.getElementById("final-design-docx-btn").disabled);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-DESIGN/SAMMELAKTIONS-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
