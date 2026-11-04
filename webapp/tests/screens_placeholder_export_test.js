// v2.136.0 Screens zu Platzhaltern: optional vorher OCR fuer Screens ohne erkannten Bildtext,
// Excel-Liste (Platzhalter / Zuordnung / Fehlende Screens) und Aufnahme-Liste fehlender Screens (Markdown).
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// Je Screen ein eigenes PNG (angehaengtes Byte nach IEND) -> der OCR-Mock erkennt den Screen an seinen Daten.
const pngN = (n) => Buffer.concat([PNG, Buffer.from([n])]);
const OCR_TEXT = {};
OCR_TEXT[pngN(2).toString("base64")] = "Regular Review – Fällige Vertragsprüfungen (Tabelle)";
OCR_TEXT[pngN(3).toString("base64")] = "Startseite Login Benutzername Passwort";
let recognizeCalls = 0;
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.Tesseract = {
      createWorker: () => Promise.resolve({
        recognize: (dataUrl) => { recognizeCalls++; const b64 = String(dataUrl).split(",")[1] || ""; return Promise.resolve({ data: { text: OCR_TEXT[b64] || "" } }); },
      }),
    };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
async function sheetRows(zip, n) {
  const xml = await zip.file("xl/worksheets/sheet" + n + ".xml").async("string");
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((m) => [...m[1].matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map((x) => x[1].replace(/&amp;/g, "&")));
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  async function screensDocx(titles, startN) {
    const z = new JSZipNode(); let body = "", rels = "";
    titles.forEach((t, i) => {
      body += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + t + '</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="rId' + (i + 1) + '"/></w:drawing></w:r></w:p>';
      rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (i + 1) + '.png"/>';
      z.file("word/media/image" + (i + 1) + ".png", pngN(startN + i));
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

  nav("editor"); await wait(50);
  setVal("editor-meta-rolle", "Retail"); setVal("editor-meta-sprache", "DE");
  await upload([new win.File([await screensDocx(["Produktkonfiguration mit Laufzeit und Zahlungsintervall", "Abbildung 2", "Abbildung 3"], 1)], "screens.docx")]);
  await waitUntil(() => $("editor-screens-count").textContent === "3" && !/Wartet|Wird verarbeitet/.test($("editor-files-tbody").textContent), 8000);
  check("3 Screens eingelesen", $("editor-screens-count").textContent === "3");

  check("Neue Bedienelemente vorhanden und anfangs gesperrt", !!$("screenph-ocr-first") && !$("screenph-ocr-first").checked && $("screenph-xlsx-btn").disabled && $("screenph-missing-md-btn").disabled && $("screenph-missing-note").hidden);
  $("screenph-paste").value = ["7\t5.1 Produkt konfigurieren\tScreenshot: Produktkonfiguration mit Laufzeit, Laufleistung und Zahlungsintervall\toffen",
    "14\t10.10.2 Rechnungsstatus aus dem Finanzsystem\tScreenshot: Vertragsansicht mit farblich dargestellten Mahnstufen\toffen",
    "15\t10.11 Regelmäßige Vertragsprüfung (Regular Review)\tScreenshot: Tabelle der fälligen Vertragsprüfungen\toffen"].join("\n");
  fire($("screenph-paste-btn"), "click");
  const prow = (nr) => doc.querySelector('#screenph-tbody tr[data-screenph-row="' + ["7", "14", "15"].indexOf(nr) + '"]');
  const shots = (nr) => Array.from(prow(nr).querySelectorAll(".screenph-thumb")).map((t) => t.getAttribute("title"));
  check("Excel-Button nach dem Einlesen aktiv", !$("screenph-xlsx-btn").disabled);

  fire($("screenph-match-btn"), "click");
  await wait(50);
  check("Ohne OCR: 5.1 belegt, 10.11 bleibt offen (Screen ohne Bildtext)", shots("7")[0] === "Produktkonfiguration mit Laufzeit und Zahlungsintervall" && shots("15").length === 0 && recognizeCalls === 0);
  check("Hinweis „Fehlende Screens“ nennt offene Platzhalter", !$("screenph-missing-note").hidden && $("screenph-missing-note").textContent.startsWith("Fehlende Screens: 2 Platzhalter") && $("screenph-missing-note").textContent.includes("10.11") && !$("screenph-missing-md-btn").disabled);

  $("screenph-ocr-first").checked = true;
  fire($("screenph-match-btn"), "click");
  await waitUntil(() => /per OCR gelesen/.test($("screenph-status").textContent), 8000);
  check("Mit OCR: alle 3 Screens ohne OCR-Text gelesen", recognizeCalls === 3 && $("screenph-status").textContent.includes("vorher 3 Screen(s) per OCR gelesen"));
  check("Mit OCR: 10.11 bekommt den Screen mit erkanntem Text „Regular Review“", shots("15")[0] === "Abbildung 2" && prow("15").children[4].textContent.startsWith("zugeordnet (1)"));
  check("Login-Screen wird trotz OCR-Text keinem Platzhalter zugeordnet", !["7", "14", "15"].some((n) => shots(n).includes("Abbildung 3")));
  check("Fehlende Screens: nur noch 1 (Mahnstufen)", $("screenph-missing-note").textContent.startsWith("Fehlende Screens: 1 Platzhalter") && $("screenph-missing-note").textContent.includes("10.10.2"));
  check("Zuordnen-Button nach OCR wieder aktiv", !$("screenph-match-btn").disabled);
  fire($("screenph-match-btn"), "click");
  await wait(150);
  check("Erneutes Zuordnen: OCR läuft nicht doppelt (bereits erkannt)", recognizeCalls === 3);
  nav("bilder"); await wait(50);
  check("OCR-Text auch im Register Bilder sichtbar", doc.getElementById("gallery").textContent.includes("Regular Review"));
  nav("editor"); await wait(30);

  // ===================== Excel =====================
  savedFiles.length = 0;
  fire($("screenph-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  check("Excel heruntergeladen (Name aus Quelle + Datum)", /^eingef_gte_Zeilen_Zuordnung_\d{4}-\d{2}-\d{2}\.xlsx$/.test(savedFiles[0] && savedFiles[0].filename));
  const zip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const wb = await zip.file("xl/workbook.xml").async("string");
  check("Drei Blätter: Platzhalter, Zuordnung, Fehlende Screens", /name="Platzhalter".*name="Zuordnung".*name="Fehlende Screens"/.test(wb));
  const s1 = await sheetRows(zip, 1), s2 = await sheetRows(zip, 2), s3 = await sheetRows(zip, 3);
  check("Blatt Platzhalter: Kopf + 3 Zeilen", s1.length === 4 && s1[0].join("|") === "Nr.|Kapitel|Beschreibung|Status (Quelle)|Status (neu)|Screens (Quelldatei #Nr.)|Trefferquote|Zuordnung");
  const r15 = s1.find((r) => r[0] === "15");
  check("Platzhalter 15: Status neu, Quelldatei #Screen-Nr., Trefferquote", r15[3] === "offen" && r15[4] === "zugeordnet (1)" && r15[5] === "screens.docx #2" && /^\d+ %$/.test(r15[6]) && r15[7] === "Text");
  check("Platzhalter 14 bleibt offen", s1.find((r) => r[0] === "14")[4] === "offen");
  const z15 = s2.find((r) => r[0] === "15");
  check("Blatt Zuordnung: je Screen eine Zeile mit Quelldatei, Screen-Nr., Rolle/Sprache", s2[0][3] === "Quelldatei" && s2[0][4] === "Screen-Nr." && z15 && z15[3] === "screens.docx" && z15[4] === "2" && z15[8] === "Retail" && z15[9] === "DE");
  check("Blatt Fehlende Screens: Platzhalter 14 mit Rolle/Sprache-Filter", s3.length === 2 && s3[1][0] === "14" && s3[1][1].startsWith("10.10.2") && s3[1][3] === "alle" && s3[1][4] === "alle");

  // ===================== Markdown-Aufnahmeliste =====================
  savedFiles.length = 0;
  setVal("screenph-rolle", "Retail");
  fire($("screenph-missing-md-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = savedFiles[0] ? String(savedFiles[0].data instanceof win.Blob ? await savedFiles[0].data.text() : savedFiles[0].data) : "";
  check("Aufnahme-Liste: Markdown-Datei", /_fehlende_Screens_\d{4}-\d{2}-\d{2}\.md$/.test(savedFiles[0] && savedFiles[0].filename));
  check("Aufnahme-Liste: Titel, Filter, Kapitelgruppe, Checkbox je fehlendem Screen", md.startsWith("# Fehlende Screens – Aufnahme-Liste") && md.includes("Rolle: Retail · Sprache: alle") && md.includes("## Kapitel 10") &&
    md.includes("- [ ] **14 · 10.10.2 Rechnungsstatus aus dem Finanzsystem** – Screenshot: Vertragsansicht mit farblich dargestellten Mahnstufen") && !md.includes("10.11 Regelmäßige"));
  setVal("screenph-rolle", "");

  // ===================== Ohne Tesseract =====================
  await upload([new win.File([await screensDocx(["Abbildung 9"], 9)], "nachtrag.docx")]);
  await waitUntil(() => $("editor-screens-count").textContent === "4" && !/Wartet|Wird verarbeitet/.test($("editor-files-tbody").textContent), 8000);
  delete win.Tesseract;
  fire($("screenph-match-btn"), "click");
  await waitUntil(() => /belegt/.test($("screenph-status").textContent) && $("toast").textContent.includes("OCR"), 3000);
  check("Ohne OCR-Bibliothek: Hinweis, Zuordnung läuft trotzdem", $("toast").textContent.includes("OCR nicht verfügbar") && shots("15")[0] === "Abbildung 2" && recognizeCalls === 3);

  // ===================== Sitzung =====================
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sess = JSON.parse(savedFiles[0].data);
  check("Sitzung: OCR-Text der Screens bleibt gespeichert", sess.uploadedImages.some((i) => /Regular Review/.test(i.ocrText || "")));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
