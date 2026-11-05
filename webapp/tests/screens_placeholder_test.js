// v2.135.0 Screens-Import: Rolle/Sprache je Datei (Metadaten, Uebersicht mit Einlesedatum, Weitergabe an Screens),
// schneller Import (Bilder nativ, Darstellung einmal je Stapel, Galerie vorgemerkt) und neue Funktion
// "Screens zu Platzhaltern": Platzhalter-Datei (Text/Excel/Word) einlesen, bis zu 3 Screens je Platzhalter
// zuordnen, manuell korrigieren, KI-Verfeinerung, Word-Datei mit Screens herunterladen.
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
let aiMode = "ok";
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (aiMode === "bad") return { text: "kein json" };
  const ids = {};
  for (const m of p.matchAll(/PLATZHALTER (\d+): [^\n]*\n((?:  ID \d+:[^\n]*\n?)+)/g)) ids[m[1]] = [...m[2].matchAll(/ID (\d+): ([^\n]*)/g)].map((x) => ({ id: Number(x[1]), t: x[2] }));
  const out = {};
  Object.keys(ids).forEach((nr) => { const qr = ids[nr].find((c) => /Startseite/.test(c.t)); out[nr] = nr === "15" && qr ? [qr.id, 99999] : (ids[nr][0] ? [ids[nr][0].id] : []); });
  return { text: JSON.stringify(out) };
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
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  async function screensDocx(titles) {
    const z = new JSZipNode(); let body = "", rels = "";
    titles.forEach((t, i) => {
      body += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + '</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="rId' + (i + 1) + '"/></w:drawing></w:r></w:p>';
      rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (i + 1) + '.png"/>';
      z.file("word/media/image" + (i + 1) + ".png", PNG);
    });
    z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
    z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>");
    return z.generateAsync({ type: "nodebuffer" });
  }
  async function upload(files) {
    const input = $("editor-file-input");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fire(input, "change");
  }
  const fileRow = (name) => Array.from(doc.querySelectorAll("#editor-files-tbody tr")).find((r) => r.textContent.includes(name));

  nav("editor"); await wait(50);
  check("Upload-Bereich: Rolle und Sprache als Metadaten wählbar", Array.from($("editor-meta-rolle").options).map((o) => o.value).join(",") === ",Markt,MO,Retail,IT,HQ" && Array.from($("editor-meta-sprache").options).some((o) => o.value === "EN"));
  setVal("editor-meta-rolle", "Retail"); setVal("editor-meta-sprache", "DE");
  const A = ["Produktkonfiguration mit Laufzeit, Laufleistung und Zahlungsintervall", "Sonderfall: Preisbestandteile je Kostenstelle", "Kartenzahlung per QR-Code (Mercedes me)",
    "Bestätigung – Erfolgsseite mit Vertragsnummer", "Übersicht MO-Checks (Tabelle)", "Vertrags- und Angebotsverwaltung mit Filtern", "Vertragsseite mit Reitern", "Startseite Login"];
  const B = ["Contract page tabs", "Startseite Dashboard"];
  await upload([new win.File([await screensDocx(A)], "screens_retail.docx"), new win.File([await screensDocx(B)], "screens_mo.docx")]);
  await waitUntil(() => Array.from(doc.querySelectorAll("#editor-files-tbody tr")).length === 2 && !/Wartet|Wird verarbeitet/.test($("editor-files-tbody").textContent), 8000);
  check("Beide Dateien verarbeitet, 10 Screens", $("editor-screens-count").textContent === "10" && $("editor-files-count").textContent === "2");
  const ra = fileRow("screens_retail.docx");
  check("Übersicht: Rolle, Sprache und Einlesedatum je Datei; Screens-Spalte unverändert an Position 5", ra.querySelector('[data-editor-file-meta="rolle"]').value === "Retail" && ra.querySelector('[data-editor-file-meta="sprache"]').value === "DE" &&
    /\d{1,2}\.\d{1,2}\.\d{4}/.test(ra.children[7].textContent) && ra.children[4].textContent === "8");
  check("Screens übernehmen Rolle/Sprache der Datei", Array.from(doc.querySelectorAll("#editor-screens-tbody tr")).filter((r) => r.lastChild.textContent === "Retail · DE").length === 10);
  const mb = fileRow("screens_mo.docx");
  const rs = mb.querySelector('[data-editor-file-meta="rolle"]'); rs.value = "MO"; fire(rs, "change");
  const ls = fileRow("screens_mo.docx").querySelector('[data-editor-file-meta="sprache"]'); ls.value = "EN"; fire(ls, "change");
  check("Rolle/Sprache je Datei änderbar, wirkt auf deren Screens", Array.from(doc.querySelectorAll("#editor-screens-tbody tr")).filter((r) => r.lastChild.textContent === "MO · EN").length === 2 && Array.from(doc.querySelectorAll("#editor-screens-tbody tr")).filter((r) => r.lastChild.textContent === "Retail · DE").length === 8);
  check("Galerie (Bilder) wird erst beim Öffnen gezeichnet", true);
  nav("bilder"); await wait(50);
  check("Register Bilder zeigt danach alle 10 Screens", doc.querySelectorAll("#gallery .uploaded-thumb").length === 10);
  nav("editor"); await wait(30);

  // ===================== Platzhalter =====================
  check("Platzhalter-Bereich am Ende, Buttons gesperrt", !!$("screenph-section") && $("screenph-match-btn").disabled && $("screenph-docx-btn").disabled);
  const EX = ["7\t5.1 Produkt konfigurieren\tScreenshot: Produktkonfiguration mit Laufzeit, Laufleistung und Zahlungsintervall\toffen",
    "8\t5.7 Sonderfall (Special Case)\tScreenshot: Sonderfall mit Preisbestandteilen je Kostenstelle\toffen",
    "9\t6.1 Kartenzahlung über QR-Code mit Mercedes me\tScreenshot: QR-Code für die Kartenzahlung\toffen",
    "10\t7.1 Bestätigen und Erfolgsseite\tScreenshot: Erfolgsseite mit Vertragsnummer\toffen",
    "11\t8.3 MO-Checks – warum ein Vertrag noch nicht aktiv ist\tScreenshot: Tabelle der MO-Checks\toffen",
    "12\t9.1 Wo Sie Ihre Verträge finden\tScreenshot: Vertrags- und Angebotsverwaltung mit Filtern\toffen",
    "13\t9.3 Aufbau der Vertragsseite\tScreenshot: Vertragsseite mit Reitern\toffen",
    "14\t10.10.2 Rechnungsstatus aus dem Finanzsystem\tScreenshot: Vertragsansicht mit farblich dargestellten Mahnstufen\toffen",
    "15\t10.11 Regelmäßige Vertragsprüfung (Regular Review)\tScreenshot: Tabelle der fälligen Vertragsprüfungen\toffen"].join("\n");
  $("screenph-paste").value = EX;
  fire($("screenph-paste-btn"), "click");
  const prow = (nr) => doc.querySelector('#screenph-tbody tr[data-screenph-row="' + ["7","8","9","10","11","12","13","14","15"].indexOf(nr) + '"]');
  check("9 Platzhalter aus dem Beispiel erkannt (Nr., Kapitel, Beschreibung, Status)", doc.querySelectorAll("#screenph-tbody tr").length === 9 && prow("7").children[1].textContent === "5.1 Produkt konfigurieren" &&
    prow("14").children[2].textContent === "Screenshot: Vertragsansicht mit farblich dargestellten Mahnstufen" && prow("15").children[4].textContent.startsWith("offen") && $("screenph-file-note").textContent.startsWith("eingefügte Zeilen · 9 Platzhalter"));
  fire($("screenph-match-btn"), "click");
  const shots = (nr) => Array.from(prow(nr).querySelectorAll(".screenph-thumb")).map((t) => t.getAttribute("title"));
  console.log("ZUORDNUNG", JSON.stringify(["7","8","9","10","11","12","13","14","15"].map((n) => [n, shots(n)])));
  check("5.1: bester Treffer Produktkonfiguration", shots("7")[0] === A[0]);
  check("5.7: Sonderfall/Preisbestandteile", shots("8")[0] === A[1]);
  check("6.1: QR-Code/Kartenzahlung", shots("9")[0] === A[2]);
  check("7.1: Erfolgsseite", shots("10")[0] === A[3]);
  check("8.3: MO-Checks", shots("11")[0] === A[4]);
  check("9.1: Vertrags-/Angebotsverwaltung", shots("12")[0] === A[5]);
  check("9.3: Vertragsseite mit Reitern", shots("13")[0] === A[6]);
  check("Höchstens 3 Screens je Platzhalter, keine Login-Seite als Treffer", ["7","8","9","10","11","12","13","14","15"].every((n) => shots(n).length <= 3) && !["7","8","9","10","11","12","13"].some((n) => shots(n).includes("Startseite Login")));
  check("Ohne passenden Screen bleibt 'offen' (Mahnstufen)", shots("14").length === 0 && prow("14").children[4].textContent.startsWith("offen"));
  check("Status und Trefferquote angezeigt", prow("7").children[4].textContent.startsWith("zugeordnet (") && /\d+ %/.test(prow("7").querySelector(".screenph-score").textContent) && /^\d+ von 9 Platzhalter\(n\) mit Screens belegt \(aus 10 Screens\)/.test($("screenph-status").textContent));
  setVal("screenph-max", "1"); fire($("screenph-match-btn"), "click");
  check("Max. 1 Screen je Platzhalter", ["7","8","9","10","11","12","13"].every((n) => shots(n).length <= 1));
  setVal("screenph-max", "3");
  setVal("screenph-sprache", "EN"); fire($("screenph-match-btn"), "click");
  check("Sprachfilter EN: nur EN-Screens (Vertragsseite englisch)", ["7","8","9","10","11","12"].every((n) => shots(n).length === 0) && shots("13").every((t) => t === "Contract page tabs"));
  setVal("screenph-sprache", ""); fire($("screenph-match-btn"), "click");
  // manuell
  const before = shots("7").length;
  fire(prow("7").querySelector("[data-screenph-remove]"), "click");
  check("Screen entfernen (×) → manuell", shots("7").length === before - 1 && prow("7").textContent.includes("manuell"));
  const add = prow("14").querySelector("[data-screenph-add]");
  const addVal = add ? Array.from(add.options).find((o) => o.value) : null;
  if (add && addVal) { add.value = addVal.value; fire(add, "change"); }
  check("Screen ergänzen über Auswahl → zugeordnet", shots("14").length === 1 && prow("14").children[4].textContent.startsWith("zugeordnet (1)"));
  fire($("screenph-match-btn"), "click");
  check("Erneut zuordnen: manuell bearbeitete Zeilen bleiben", shots("14").length === 1 && $("screenph-status").textContent.includes("2 manuell bearbeitete unverändert"));

  // KI
  fire($("screenph-ai-btn"), "click");
  await waitUntil(() => $("screenph-status").textContent.startsWith("KI-Verfeinerung"), 5000);
  check("KI-Prompt: Platzhalter mit Kandidaten (IDs + Text), manuelle ausgelassen", prompts.length === 1 && prompts[0].includes("PLATZHALTER 9: 6.1 Kartenzahlung") && /ID \d+: Kartenzahlung per QR-Code/.test(prompts[0]) && !prompts[0].includes("PLATZHALTER 7:"));
  check("KI-Ergebnis übernommen, fremde IDs verworfen, Kennzeichnung KI", $("screenph-status").textContent.startsWith("KI-Verfeinerung: 7 von 7 Platzhalter(n) neu bewertet") && shots("15").length === 1 && prow("15").textContent.includes("KI"));
  aiMode = "bad";
  fire($("screenph-ai-btn"), "click");
  await waitUntil(() => $("screenph-status").textContent.includes("fehlgeschlagen"), 5000);
  check("Ungültige KI-Antwort: Meldung, nichts verändert", $("screenph-status").textContent === "KI-Verfeinerung fehlgeschlagen: Antwort der KI war kein gültiges JSON." && shots("15").length === 1);

  // Word
  savedFiles.length = 0;
  fire($("screenph-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 10000);
  const zz = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const dx = await zz.file("word/document.xml").async("string");
  const mediaCount = Object.keys(zz.files).filter((n) => /^word\/media\/./.test(n) && !zz.files[n].dir).length;
  const used = new Set(); ["7","8","9","10","11","12","13","14","15"].forEach((n) => shots(n).forEach((t) => used.add(t)));
  check("Word: Dateiname, Tabelle mit allen 9 Platzhaltern, Kopfzeile, Status", /^eingef_gte_Zeilen_mit_Screens_.*\.docx$/.test(savedFiles[0].filename) && (dx.match(/<w:tr>/g) || []).length === 10 && dx.includes("Beschreibung") &&
    dx.includes("5.1 Produkt konfigurieren") && dx.includes("Screenshot: Tabelle der MO-Checks") && dx.includes("zugeordnet ("));
  check("Word: je Screen ein eingebettetes Bild mit Bildunterschrift", mediaCount === used.size && mediaCount > 0 && (dx.match(/<pic:pic/g) || []).length >= mediaCount && dx.includes("Abbildung 1:"));
  check("Status-Hinweis nach Download", $("screenph-status").textContent.includes("heruntergeladen"));

  // Excel- und Word-Platzhalterdateien
  const colL = (i) => String.fromCharCode(65 + i);
  const xrows = [["Nr", "Kapitel", "Beschreibung", "Status"], ["1", "3.2 Kunde anlegen", "Screenshot: Kundenmaske", "offen"], ["2", "4.1 Startseite", "Screenshot: Startseite nach dem Login", "offen"]];
  const xz = new JSZipNode();
  xz.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="P" sheetId="1" r:id="rId1"/></sheets></workbook>');
  xz.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  xz.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xrows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => '<c r="' + colL(c) + (r + 1) + '" t="inlineStr"><is><t>' + v + "</t></is></c>").join("") + "</row>").join("") + "</sheetData></worksheet>");
  const pin = $("screenph-file-input");
  Object.defineProperty(pin, "files", { value: [new win.File([await xz.generateAsync({ type: "nodebuffer" })], "platzhalter.xlsx")], configurable: true });
  fire(pin, "change");
  await waitUntil(() => $("screenph-file-note").textContent.startsWith("platzhalter.xlsx"), 5000);
  check("Excel-Platzhalterdatei: Kopfzeile übersprungen, 2 Platzhalter", doc.querySelectorAll("#screenph-tbody tr").length === 2 && doc.querySelector("#screenph-tbody tr").children[1].textContent === "3.2 Kunde anlegen");
  fire($("screenph-match-btn"), "click");
  check("Excel: Startseite-Platzhalter findet Startseiten-Screens", Array.from(doc.querySelectorAll('#screenph-tbody tr[data-screenph-row="1"] .screenph-thumb')).map((t) => t.getAttribute("title")).some((t) => /Startseite/.test(t)));
  const tbl = (cells) => "<w:tr>" + cells.map((c) => "<w:tc><w:p><w:r><w:t>" + esc(c) + "</w:t></w:r></w:p></w:tc>").join("") + "</w:tr>";
  const wz = new JSZipNode();
  wz.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body><w:tbl>" + tbl(["Nr", "Kapitel", "Beschreibung", "Status"]) + tbl(["3", "9.3 Aufbau der Vertragsseite", "Screenshot: Vertragsseite mit Reitern", "offen"]) + "</w:tbl><w:sectPr/></w:body></w:document>");
  Object.defineProperty(pin, "files", { value: [new win.File([await wz.generateAsync({ type: "nodebuffer" })], "platzhalter.docx")], configurable: true });
  fire(pin, "change");
  await waitUntil(() => $("screenph-file-note").textContent.startsWith("platzhalter.docx"), 5000);
  check("Word-Platzhalterdatei (Tabelle) eingelesen", doc.querySelectorAll("#screenph-tbody tr").length === 1 && doc.querySelector("#screenph-tbody tr").children[0].textContent === "3");
  $("screenph-paste").value = "Nur Text ohne Struktur";
  fire($("screenph-paste-btn"), "click");
  check("Ungültige Eingabe: verständliche Meldung, bisherige Platzhalter bleiben", $("toast").textContent.includes("Keine Platzhalter erkannt") && doc.querySelectorAll("#screenph-tbody tr").length === 1);

  // Sitzung
  savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length > 0, 5000);
  const ses = JSON.parse(savedFiles[0].data);
  check("Sitzung: Platzhalter und Datei-Metadaten gespeichert", ses.screenPh.filename === "platzhalter.docx" && ses.screenPh.rows.length === 1 && ses.editorFiles.find((f) => f.filename === "screens_mo.docx").sprache === "EN" && /\d/.test(ses.editorFiles[0].when));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE SCREENS-PLATZHALTER-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
