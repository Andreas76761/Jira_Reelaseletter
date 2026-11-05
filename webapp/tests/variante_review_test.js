// v2.137.0 VARIANTE 6: Dokument-Review – Entwuerfe (.docx) hochladen oder bestehende Staende uebernehmen,
// 20 Pruefungen in 7 Stufen (Design, Inhalt, Bilder, Qualitaet, Uebersetzung, Abschluss, Finalisierung),
// Dashboard, Reviewbericht (Word/Markdown), Ablage mit Version und Status, Word mit/ohne interne Vermerke.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];
const prompts = [];
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (p.includes("ZIELSPRACHE:")) {
    const title = (p.match(/\nTITEL: (.*)\n/) || [])[1] || "";
    return { text: "TITEL: EN-" + title + "\n\n" + "EN: " + p.slice(p.indexOf("\nTEXT:\n") + 7) };
  }
  if (p.includes("Du bist Lektor")) {
    if (p.includes("Vertragsuebersicht")) return { text: 'Befunde: [{"typ":"Rechtschreibung","original":"Vertragsuebersicht","vorschlag":"Vertragsübersicht","hinweis":"Umlaut"},{"typ":"Lücke","original":"","vorschlag":"Schritt zum Speichern ergänzen","hinweis":"fehlt"},{"typ":"Stil","original":"gibt es nicht im Text","vorschlag":"x"}]' };
    return { text: "[]" };
  }
  return { text: "" };
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
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SECRET = "Geheimer Kommentar 4711";
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + NS + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Standard"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="1F4E79"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t, rpr, ppr) => "<w:p>" + (ppr ? "<w:pPr>" + ppr + "</w:pPr>" : "") + "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
async function draftDocx() {
  const z = new JSZipNode();
  const body =
    H("1 Verträge anlegen") +
    P("Neue Verträge werden in der Vertragsuebersicht angelegt (ONESCM-123).") +
    P("[Bild: Vertragsübersicht mit Filtern]") +
    P("Tipp: Filter speichern spart Zeit.") +
    P("TODO: Screenshot aktualisieren") +
    '<w:p><w:r><w:t xml:space="preserve">Die Freigabe erfolgt online. </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>' + SECRET + '</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>' +
    P("Diese Ansicht ist  in Abnahme und wird im Testsystem geprüft.", '<w:rFonts w:ascii="Comic Sans MS" w:hAnsi="Comic Sans MS"/><w:color w:val="FF0000"/><w:sz w:val="28"/>', '<w:spacing w:line="480" w:lineRule="auto"/>') +
    H("2 Kartenzahlung") +
    P("Die Kartenzahlung ist geplant für Q3/2026 und steht ab sofort zur Verfügung.", '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:color w:val="00AA00"/>') +
    P("Screenshot: QR-Code für die Kartenzahlung") +
    P("Die die Zahlung wird bestätigt und ist verfügbar.", '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:color w:val="0000FF"/><w:sz w:val="16"/>') +
    H("3 Ausblick") +
    H("4 E-Mail Versand") + P("Die Email wird automatisch versendet. Der E-Mail Versand ist in Entwicklung.");
  z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/styles.xml", STYLES);
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return z.generateAsync({ type: "nodebuffer" });
}
async function screensDocx(titles) {
  const z = new JSZipNode(); let body = "", rels = "";
  titles.forEach((t, i) => {
    body += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + '</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="rId' + (i + 1) + '"/></w:drawing></w:r></w:p>';
    rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (i + 1) + '.png"/>';
    z.file("word/media/image" + (i + 1) + ".png", Buffer.concat([PNG, Buffer.from([i])]));
  });
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>");
  return z.generateAsync({ type: "nodebuffer" });
}
async function docText(data) {
  const z = await JSZipNode.loadAsync(Buffer.from(await data.arrayBuffer()));
  const xml = await z.file("word/document.xml").async("string");
  return { text: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), media: Object.keys(z.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/")).length };
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  const act = (a, extra) => { const b = $("vrev-step").querySelector('[data-vrev-act="' + a + '"]' + (extra || "")); if (b) b.click(); return !!b; };
  const chk = (id) => { const r = doc.querySelector('#vrev-stage [data-vrev-check="' + id + '"]'); return r ? r.querySelector(".vrev-pill").textContent : ""; };
  const chip = (id) => Array.from(doc.querySelectorAll("#vrev-dash .vrev-chip")).find((c) => c.querySelector("b").textContent === id);
  const chipS = (id) => (chip(id).className.match(/vrev-chip-(\w+)/) || [])[1];
  const gotoStage = (n) => { $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click(); };
  const rows = () => Array.from(doc.querySelectorAll("#vrev-docs-tbody tr"));
  const tile = (label) => Array.from(doc.querySelectorAll("#vrev-dash .vrev-tile")).find((t) => t.querySelector(".vrev-tile-label").textContent === label);

  // Bildarchiv: zwei Screens
  nav("editor"); await wait(30);
  setFiles($("editor-file-input"), [new win.File([await screensDocx(["Vertragsübersicht mit Filtern", "QR-Code Kartenzahlung", "Vertragsliste mit Filtern"])], "archiv.docx")]);
  await waitUntil(() => $("editor-screens-count").textContent === "3" && !/Wartet|Wird verarbeitet/.test($("editor-files-tbody").textContent), 8000);

  nav("variante"); await wait(30);
  check("Abschnitt 6 Dokument-Review vorhanden, Ablage leer", !!$("vrev-step") && $("vrev-step").querySelector(".section-label").textContent.includes("20 Prüfungen in 7 Stufen") && !$("vrev-docs-empty").hidden && $("vrev-work").hidden);
  check("Ohne FINAL-Stand: Übernehmen gesperrt", $("vrev-existing-btn").disabled);

  setFiles($("vrev-file-input"), [new win.File([await draftDocx()], "Entwurf_Handbuch.docx")]);
  await waitUntil(() => rows().length === 1 && !$("vrev-work").hidden, 8000);
  check("Entwurf hochgeladen: in der Ablage mit Version 1.0, Status 'In Review', Quelle Upload", rows().length === 1 && rows()[0].children[1].textContent === "1.0" && rows()[0].children[2].textContent.startsWith("In Review") && rows()[0].children[3].textContent.startsWith("Upload"));
  check("Dashboard: Kacheln und 20 Prüf-Chips", doc.querySelectorAll("#vrev-dash .vrev-chip").length === 20 && !!tile("Qualität") && tile("Stufen").querySelector("b").textContent === "0 / 7");
  check("Stepper mit 7 Stufen, Stufe 1 Design aktiv", doc.querySelectorAll("#vrev-stepper .vrev-stage-btn").length === 7 && $("vrev-stage").textContent.includes("Stufe 1 – Review Design"));

  // Stufe 1 Design
  const fontsTxt = $("vrev-stage").querySelector(".vrev-design").textContent;
  check("Design: Schriftarten aus Formatvorlagen und direkter Formatierung (Arial, Georgia, Comic Sans, Times, Courier)", ["Arial", "Georgia", "Comic Sans MS", "Times New Roman", "Courier New"].every((f) => fontsTxt.includes(f)));
  check("D1 Schriftarten: Fehler (zu viele)", chk("D1") === "Fehler");
  check("D2 Schriftgrößen: 11 pt Fließtext erkannt, uneinheitlich", fontsTxt.includes("11 pt") && fontsTxt.includes("14 pt") && chk("D2") !== "OK");
  check("D3 Zeilenabstand: 1,15-fach und 2-fach erkannt", fontsTxt.includes("1,15-fach") && fontsTxt.includes("2-fach"));
  check("D4 Farbpalette mit Farbfeldern", $("vrev-stage").querySelectorAll(".vrev-swatch").length >= 3 && fontsTxt.includes("FF0000"));
  check("D5: unmarkierter Tipp und interne Bemerkung (Kommentar) erkannt", chk("D5") === "Hinweis" && $("vrev-stage").textContent.includes("Tipp: Filter speichern") && $("vrev-stage").textContent.includes("Interne Bemerkungen: 1 Kommentar"));

  // Stufe 2 Inhalt
  gotoStage(2); await wait(20);
  check("C1 Jira: Fehler (1 Nummer)", chk("C1") === "Fehler" && $("vrev-stage").querySelector('[data-vrev-act="strip-jira"]').textContent.includes("(1)"));
  check("C2 Planung (Q3/2026) und C4 Test (Testsystem): Hinweis", chk("C2") === "Hinweis" && chk("C4") === "Hinweis");
  check("C3 interne Vermerke: Kommentar + TODO-Zeile", chk("C3") === "Hinweis" && doc.querySelector('[data-vrev-check="C3"]').textContent.includes("Kommentarbereiche: 1, Zeilen: 1"));
  const legend = $("vrev-stage").querySelector(".vrev-legend").textContent;
  check("Status-Legende mit den 4 Definitionen", legend.includes("verfügbar Die Funktion ist bereits im Einsatz.") && legend.includes("in Abnahme Die Funktion ist entwickelt und wird derzeit abschließend getestet und freigegeben.") &&
    legend.includes("in Entwicklung Die Funktion wird gerade umgesetzt.") && legend.includes("Beschreiben Sie sie gegenüber Kunden bitte nicht als verfügbar"));
  const stRows = Array.from(doc.querySelectorAll(".vrev-status-table tbody tr"));
  check("Statusangaben im Text als Tabelle (verfügbar, in Abnahme, geplant, in Entwicklung)", ["verfügbar", "in Abnahme", "geplant", "in Entwicklung"].every((s) => stRows.some((r) => r.children[1].textContent.startsWith(s))));
  check("C5: Widerspruch 'geplant … steht ab sofort zur Verfügung' als Fehler markiert", chk("C5") === "Fehler" && stRows.some((r) => r.classList.contains("vrev-conflict") && r.textContent.includes("Kartenzahlung")));
  act("strip-jira"); await wait(20);
  check("Jira-Nummern löschen: C1 OK, 1 Änderung gezählt", chk("C1") === "OK" && tile("Änderungen").querySelector("b").textContent === "1");

  // Text ansehen
  $("vrev-text-chapter").value = "0"; fire($("vrev-text-chapter"), "change");
  check("Textansicht: interner Vermerk markiert, Status hervorgehoben, Platzhalter erkennbar", !!$("vrev-text-view").querySelector(".vrev-m-intern") && $("vrev-text-view").querySelector(".vrev-m-intern").textContent === SECRET &&
    !!$("vrev-text-view").querySelector(".vrev-st-abn") && !!$("vrev-text-view").querySelector(".vrev-l-ph") && !!$("vrev-text-view").querySelector(".vrev-l-intern"));
  check("Bearbeitungsfeld zeigt interne Vermerke als [[INTERN]]", $("vrev-text-edit").value.includes("[[INTERN]]" + SECRET + "[[/INTERN]]"));
  $("vrev-text-edit").value = $("vrev-text-edit").value.replace("Die Freigabe erfolgt online.", "Die Freigabe erfolgt online im Portal.");
  $("vrev-text-save-btn").click(); await wait(20);
  check("Text bearbeitet und gespeichert: Änderung gezählt, Vermerk bleibt intern", tile("Änderungen").querySelector("b").textContent === "2" && $("vrev-text-view").querySelector(".vrev-m-intern") && $("vrev-text-view").textContent.includes("im Portal"));

  // Stufe 3 Bilder
  gotoStage(3); await wait(20);
  const phRows = () => Array.from(doc.querySelectorAll(".vrev-ph-table tbody tr"));
  check("Bilder: 2 Platzhalter ([Bild: …] und Screenshot: …), B1 Fehler", phRows().length === 2 && chk("B1") === "Fehler" && phRows()[1].children[1].textContent.includes("Screenshot: QR-Code"));
  check("Bildvorschlag aus dem Bildarchiv je Platzhalter", phRows()[0].children[3].textContent.includes("Vertragsübersicht") && phRows()[1].children[3].textContent.includes("QR-Code"));
  act("ph-suggest"); await wait(20);
  const thumbs = (i) => Array.from(phRows()[i].querySelectorAll(".screenph-thumb")).map((t) => t.getAttribute("title"));
  check("Vorschläge übernommen: passende Bilder (exakter Bildtext zuerst), B1 OK", thumbs(0)[0] === "Vertragsübersicht mit Filtern" && thumbs(1)[0] === "QR-Code Kartenzahlung" && chk("B1") === "OK");
  check("Vorschlag zeigt 100 % bei exaktem Bildtext", phRows()[1].querySelector(".screenph-score").textContent.includes("QR-Code") && thumbs(0).length === 2);
  phRows()[0].querySelectorAll('[data-vrev-act="ph-remove"]')[1].click(); await wait(20);
  check("Bild entfernen (×)", thumbs(0).length === 1 && thumbs(0)[0] === "Vertragsübersicht mit Filtern");
  const addSel = phRows()[0].querySelector("[data-vrev-ph-add]");
  addSel.value = Array.from(addSel.options).find((o) => o.value).value; fire(addSel, "change"); await wait(20);
  check("Bild manuell ergänzen aus Vorschlagsliste (max. 3)", thumbs(0).length === 2 && thumbs(0)[1] === "Vertragsliste mit Filtern");

  // Stufe 4 Qualitaet
  gotoStage(4); await wait(20);
  // v2.156: das Loeschen der Jira-Nummern raeumt Leerzeichen vor Satzzeichen selbst auf – Q1 meldet nur noch das doppelte Wort
  check("Q1 Formfehler erkannt (doppeltes Wort); Jira-Löschung hinterlässt kein Leerzeichen vor Satzzeichen", chk("Q1") !== "OK" && $("vrev-stage").textContent.includes("doppeltes Wort: „Die die“") && !$("vrev-stage").textContent.includes("Leerzeichen vor Satzzeichen"));
  check("Q2 KI noch offen, Q3 leeres Kapitel 'Ausblick' als Fehler", chk("Q2") === "offen" && chk("Q3") === "Fehler" && doc.querySelector('[data-vrev-check="Q3"]').textContent.includes("3 Ausblick"));
  act("autofix"); await wait(20);
  check("Formfehler automatisch korrigiert", !$("vrev-stage").textContent.includes("doppeltes Wort") && chk("Q1") === "OK");
  act("ai-quality");
  await waitUntil(() => /KI-Prüfung: \d+ Befund/.test($("vrev-status").textContent), 5000);
  const aiRows = () => Array.from(doc.querySelectorAll(".vrev-ai-table tbody tr"));
  check("KI-Prüfung: Befunde je Kapitel, erfundene Zitate verworfen", aiRows().length === 3 && aiRows()[2].children[2].textContent === "–" && prompts.some((p) => p.includes("Du bist Lektor") && !p.includes(SECRET)));
  check("Q2 nach KI bewertet (offener Stil-Befund)", chk("Q2") === "Hinweis");
  aiRows()[0].querySelector('[data-vrev-act="ai-adopt"]').click(); await wait(20);
  check("KI-Vorschlag übernommen: Text korrigiert", aiRows()[0].classList.contains("vrev-done") && vrevTextHas("Vertragsübersicht angelegt"));
  function vrevTextHas(s) { gotoStage(4); $("vrev-text-chapter").value = "0"; fire($("vrev-text-chapter"), "change"); return $("vrev-text-view").textContent.includes(s); }
  aiRows()[1].querySelector('[data-vrev-act="ai-dismiss"]').click(); await wait(20);
  aiRows()[2].querySelector('[data-vrev-act="ai-dismiss"]').click(); await wait(20);
  check("Alle KI-Befunde erledigt: Q2 OK", chk("Q2") === "OK");

  // Stufe 5 Uebersetzung
  gotoStage(5); await wait(20);
  check("T1 offen ohne Übersetzung", chk("T1") === "offen");
  $("vrev-stage").querySelector("[data-vrev-tr-lang]").value = "EN";
  act("translate");
  await waitUntil(() => rows().length === 2 && /Kopie/.test($("vrev-status").textContent), 8000);
  const enRow = rows().find((r) => r.textContent.includes("(EN)"));
  check("Kopie mit Übersetzung in der Ablage (Quelle Übersetzung · EN)", !!enRow && enRow.children[3].textContent.includes("Übersetzung") && enRow.children[3].textContent.includes("EN"));
  check("Übersetzung: interne Vermerke geschützt übergeben", prompts.some((p) => p.includes("ZIELSPRACHE: Englisch") && p.includes("[[INTERN]]" + SECRET + "[[/INTERN]]")));
  check("T1 OK (vollständig: Kapitel und Platzhalter)", chk("T1") === "OK" && doc.querySelector('[data-vrev-check="T1"]').textContent.includes("vollständig"));

  // Stufen abschliessen + Abschluss
  for (const n of [1, 2, 3, 4, 5]) { gotoStage(n); await wait(10); act("complete-stage"); await wait(10); }
  check("Stufen 1–5 abgeschlossen, weiter zu Stufe 6", tile("Stufen").querySelector("b").textContent === "5 / 7" && $("vrev-stage").textContent.includes("Stufe 6 – Review Abschluss"));
  const st6 = $("vrev-stage").textContent;
  check("Abschluss: Änderungen je Stufe, Vergleich vorher/nachher, Qualität vorher → jetzt", /Änderungen\d+Inhalt: \d+ · Bilder: \d+ · Qualität: \d+/.test(st6) && /Vorher → nachher\+\d+ \/ −\d+/.test(st6) && /Qualität\d+ → \d+/.test(st6));
  check("A1 Konsistenz: E-Mail / Email erkannt", doc.querySelector('[data-vrev-check="A1"]').textContent.includes("e-mail / email") || doc.querySelector('[data-vrev-check="A1"]').textContent.includes("email / e-mail"));
  check("Vergleich je Kapitel aufklappbar", doc.querySelectorAll("#vrev-stage .vrev-diff").length >= 1);
  act("complete-stage"); await wait(20);
  check("Stufe 6 abgeschlossen: Status Geprüft", rows()[0].children[2].textContent.startsWith("Geprüft"));

  // Stufe 7 Finalisierung
  savedFiles.length = 0;
  act("word-dist", '[class*="primary"]');
  await waitUntil(() => savedFiles.length === 1, 8000);
  const dist = await docText(savedFiles[0].data);
  check("Word Verteilung: Dateiname mit Version", /^Entwurf_Handbuch_v1\.0_\d{4}-\d{2}-\d{2}\.docx$/.test(savedFiles[0].filename));
  check("Word Verteilung: ohne Kommentar, ohne TODO, ohne Jira", !dist.text.includes(SECRET) && !dist.text.includes("TODO") && !/ONESCM-\d+/.test(dist.text) && dist.text.includes("im Portal"));
  check("Word Verteilung: Bilder an den Platzhaltern eingebettet (2 + 1)", dist.media === 3 && !dist.text.includes("[Bild"));
  savedFiles.length = 0;
  act("word-intern");
  await waitUntil(() => savedFiles.length === 1, 8000);
  const intern = await docText(savedFiles[0].data);
  check("Word intern: mit internen Vermerken ([Intern: …], TODO)", savedFiles[0].filename.includes("_INTERN_") && intern.text.includes("[Intern: " + SECRET + "]") && intern.text.includes("TODO") && intern.text.includes("INTERN – mit internen Vermerken"));
  act("complete-stage"); await wait(20);
  check("Stufe 7 abgeschlossen: Status Freigegeben, 7/7", rows()[0].children[2].textContent.startsWith("Freigegeben") && tile("Stufen").querySelector("b").textContent === "7 / 7");
  savedFiles.length = 0;
  act("word-dist", '[class*="primary"]');
  await waitUntil(() => savedFiles.length === 1 && rows()[0].children[2].textContent.startsWith("Verteilt"), 8000);
  check("Verteilen nach Freigabe: Status Verteilt", rows()[0].children[2].textContent.startsWith("Verteilt"));

  // Reviewbericht
  savedFiles.length = 0;
  $("vrev-report-md-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = await savedFiles[0].data.text();
  check("Reviewbericht (Markdown): Dashboard, 7 Stufen, 20 Prüfungen, Status, Änderungen, Verlauf", md.startsWith("# Reviewbericht – Entwurf_Handbuch") && md.includes("## Dashboard") && (md.match(/^- \[(OK|Hinweis|Fehler|offen)\] [A-Z]\d /gm) || []).length === 20 &&
    md.includes("## Stufe 7 – Finalisierung") && md.includes("## Statusangaben im Text") && md.includes("WIDERSPRUCH") && md.includes("Jira-Nummern gelöscht") && md.includes("## Verlauf") && md.includes("Verteilt"));
  savedFiles.length = 0;
  $("vrev-report-docx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  check("Reviewbericht (Word)", /^Reviewbericht_Entwurf_Handbuch_v1\.0_.*\.docx$/.test(savedFiles[0].filename) && (await docText(savedFiles[0].data)).text.includes("Stufe 4 – Qualität"));

  // Ablage: neue Version, Status, Loeschen
  rows()[0].querySelector('[data-vrev-act="new-version"]').click(); await wait(30);
  check("Neue Version v1.1 in der Ablage, geöffnet, Stufen zurückgesetzt", rows().length === 3 && rows()[2].children[1].textContent === "1.1" && $("vrev-doc-title").textContent.includes("v1.1") && tile("Stufen").querySelector("b").textContent === "0 / 7");
  const stSel = rows()[2].querySelector("[data-vrev-status]"); stSel.value = "Geprüft"; fire(stSel, "change"); await wait(10);
  check("Status je Dokument in der Ablage änderbar", rows()[2].children[2].textContent.startsWith("Geprüft"));
  rows()[2].querySelector('[data-vrev-act="delete"]').click();
  await waitUntil(() => !$("confirm-modal-ok-btn").closest("[hidden]"), 2000);
  $("confirm-modal-ok-btn").click();
  await waitUntil(() => rows().length === 2, 3000);
  check("Dokument löschen nach Bestätigung", rows().length === 2);

  // Bestehendes Dokument (FINAL-Stand) uebernehmen
  nav("final"); await wait(30);
  const fin = $("final-manual-file-input");
  setFiles(fin, [new win.File([await draftDocx()], "basis.docx")]);
  await waitUntil(() => $("final-manuals-tbody").children.length === 1, 5000);
  setVal("final-build-name-input", "Basis");
  fire($("final-build-master-btn"), "click");
  await waitUntil(() => $("final-build-master-status-note").textContent.includes("„Basis“"), 10000);
  nav("variante"); await wait(30);
  check("FINAL-Stand in der Auswahl", !$("vrev-existing-btn").disabled && $("vrev-existing-select").textContent.includes("Basis"));
  $("vrev-existing-btn").click();
  await waitUntil(() => rows().length === 3, 8000);
  const finRow = rows()[2];
  check("Bestehendes Dokument übernommen (Quelle FINAL) und geprüft", finRow.children[3].textContent.startsWith("FINAL") && finRow.children[0].textContent.includes("Basis") && /\d/.test(finRow.children[4].textContent));
  gotoStage(1); await wait(10);
  check("Design eines bestehenden Dokuments über die Word-Ausgabe analysiert (FINAL-Design der Originaldatei: Arial/Georgia, 1,15-fach)", chk("D1") === "OK" && chk("D3") === "OK" && $("vrev-stage").querySelector(".vrev-design").textContent.includes("Arial") && !$("vrev-stage").querySelector(".vrev-design").textContent.includes("Comic Sans"));
  gotoStage(2); await wait(10);
  check("Interner Kommentar aus FINAL bleibt als Vermerk erkennbar", doc.querySelector('[data-vrev-check="C3"]').textContent.includes("Kommentarbereiche: 1"));

  // Sitzung
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sess = JSON.parse(savedFiles[0].data);
  check("Sitzung: Ablage mit 3 Dokumenten, Prüfungen, Stufen und Verlauf", sess.vrev && sess.vrev.docs.length === 3 && Object.keys(sess.vrev.docs[0].checks).length === 20 && Object.keys(sess.vrev.docs[0].steps).length === 7 && sess.vrev.docs[0].history.length > 3);
  const raw = JSON.stringify(sess);
  savedFiles.length = 0;
  doc.querySelector("#reset-btn") && 0;
  const imp = $("session-import-input");
  setFiles(imp, [new win.File([raw], "s.json", { type: "application/json" })]);
  await wait(200);
  const ok = $("confirm-modal-ok-btn"); if (ok && !ok.closest("[hidden]")) ok.click();
  await waitUntil(() => rows().length === 3, 3000);
  check("Sitzung laden stellt die Ablage wieder her", rows().length === 3 && rows()[0].children[2].textContent.startsWith("Verteilt"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
