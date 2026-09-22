const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = JSZipNode;
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

function xlsxColLetter(n) {
  let s = "", num = n + 1;
  while (num > 0) { const rem = (num - 1) % 26; s = String.fromCharCode(65 + rem) + s; num = Math.floor((num - 1) / 26); }
  return s;
}
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
// Baut eine minimale .xlsx (nur die beiden Teile, die der eigene Reader in
// ticket_cockpit.html tatsaechlich liest: xl/worksheets/sheet1.xml +
// xl/sharedStrings.xml) - fuer echtes Excel nicht vollstaendig gueltig
// (kein [Content_Types].xml etc.), aber ausreichend um genau den Code-Pfad
// zu testen, den die App beim Lesen einer .xlsx-Datei durchlaeuft.
async function buildMinimalXlsx(rows) {
  const zip = new JSZipNode();
  const sharedStrings = []; const sharedIndex = {};
  function sIdx(s) { if (!(s in sharedIndex)) { sharedIndex[s] = sharedStrings.length; sharedStrings.push(s); } return sharedIndex[s]; }
  const rowsXml = rows.map((row, ri) => {
    const r = ri + 1;
    const cells = row.map((val, ci) => `<c r="${xlsxColLetter(ci)}${r}" t="s"><v>${sIdx(String(val))}</v></c>`).join("");
    return `<row r="${r}">${cells}</row>`;
  }).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join("") + `</sst>`;
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file("xl/sharedStrings.xml", sstXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const pasteTextarea = doc.getElementById("paste-textarea");
  const pasteBtn = doc.getElementById("paste-process-btn");
  const commentInput = doc.getElementById("import-comment-input");

  async function paste(text, comment) {
    doc.querySelector('.nav-item[data-view="import"]').click();
    commentInput.value = comment || "";
    pasteTextarea.value = text;
    fire(pasteBtn, "click");
    await wait(150);
  }

  // ===================== Reine Ticket-Nummern-Liste aus der Zwischenablage =====================
  const keyListText = "FLEX-1\nFLEX-2\nFLEX-3\nFLEX-2\n"; // FLEX-2 doppelt - muss dedupliziert werden
  await paste(keyListText, "Meine erste Liste");
  check("Reine Ticket-Nummern-Liste wird NICHT als 'Format nicht erkannt' abgelehnt", !doc.getElementById("toast").className.includes("error"));
  check("Toast bestaetigt Speicherung als Liste", doc.getElementById("toast").textContent.includes("Meine erste Liste"));

  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  const listRows1 = Array.from(doc.querySelectorAll("#listenauswahl-tbody tr"));
  const myList = listRows1.find((r) => r.textContent.includes("Meine erste Liste"));
  check("Neue Liste 'Meine erste Liste' unter Listenauswahl sichtbar", !!myList);
  check("Liste enthaelt genau 3 Tickets (Duplikat FLEX-2 entfernt)", !!myList && myList.textContent.includes("3"));

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "FLEX-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const flex1Row = doc.querySelector("#table-body tr");
  check("FLEX-1 wurde als Platzhalter-Ticket angelegt (im Dashboard auffindbar)", !!flex1Row && flex1Row.textContent.includes("FLEX-1"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Bereits bekanntes Ticket in Key-Liste: Daten bleiben erhalten =====================
  const xmlRich = `<?xml version="1.0"?><rss><channel><item><key>FLEX-9</key><summary>Reichhaltiges Ticket</summary><description>Ausfuehrliche Beschreibung</description><status>Offen</status><type>Bug</type></item></channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const fileInput = doc.getElementById("file-input");
  Object.defineProperty(fileInput, "files", { value: [new win.File([xmlRich], "flex9.xml", { type: "application/xml" })], configurable: true });
  fire(fileInput, "change");
  await wait(300);

  await paste("FLEX-9\nFLEX-10\n", "Liste mit bekanntem Ticket");
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "FLEX-9";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const flex9Row = doc.querySelector("#table-body tr");
  check("FLEX-9 behaelt seine Zusammenfassung (nicht durch Key-Liste ueberschrieben)", !!flex9Row && flex9Row.textContent.includes("Reichhaltiges Ticket"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  const listRows2 = Array.from(doc.querySelectorAll("#listenauswahl-tbody tr"));
  const knownList = listRows2.find((r) => r.textContent.includes("Liste mit bekanntem Ticket"));
  check("Liste mit gemischt bekannten/neuen Schluesseln gespeichert (2 Tickets)", !!knownList && knownList.textContent.includes("2"));

  // ===================== CSV (Komma-getrennt) aus der Zwischenablage =====================
  const csvComma = 'Key,Status,Summary\nCSV-1,Offen,"Ticket mit, Komma im Text"\nCSV-2,Fertig,Normaler Text';
  await paste(csvComma, "");
  check("CSV (Komma) wird nicht als Fehler abgelehnt", !doc.getElementById("toast").className.includes("error"));
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "CSV-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const csv1Row = doc.querySelector("#table-body tr");
  check("CSV-1 aus Komma-CSV importiert", !!csv1Row && csv1Row.textContent.includes("CSV-1"));
  doc.getElementById("search-input").value = "CSV-2"; fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const csv2Row = doc.querySelector("#table-body tr");
  check("CSV-2 zeigt Status 'Fertig'", !!csv2Row && csv2Row.textContent.includes("Fertig"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== CSV (Semikolon-getrennt, europaeisches Excel-Format) =====================
  const csvSemi = "Schlüssel;Status;Zusammenfassung\nCSVSEMI-1;Offen;Ein Text ohne Komma";
  await paste(csvSemi, "");
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "CSVSEMI-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const csvSemiRow = doc.querySelector("#table-body tr");
  check("CSV (Semikolon) mit deutschen Spaltennamen importiert", !!csvSemiRow && csvSemiRow.textContent.includes("CSVSEMI-1"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== .csv-Datei-Upload (Datei-Endung statt Trennzeichen-Erkennung) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="andere"]').click();
  check("'Andere Importe' akzeptiert .csv", doc.getElementById("file-input").getAttribute("accept").includes(".csv"));
  check("'Andere Importe' akzeptiert .xlsx", doc.getElementById("file-input").getAttribute("accept").includes(".xlsx"));
  const csvFileText = "Key\tStatus\tSummary\nCSVFILE-1\tOffen\tAus Datei importiert";
  Object.defineProperty(fileInput, "files", { value: [new win.File([csvFileText], "export.csv", { type: "text/csv" })], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "CSVFILE-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("CSVFILE-1 aus hochgeladener .csv-Datei importiert", !!doc.querySelector("#table-body tr") && doc.querySelector("#table-body tr").textContent.includes("CSVFILE-1"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== .xlsx-Datei-Upload (echtes OOXML/ZIP, englische Spaltennamen) =====================
  const xlsxBuf = await buildMinimalXlsx([
    ["Key", "Status", "Summary"],
    ["XLSX-1", "Geschlossen", "Aus Excel-Tabelle importiert"],
    ["XLSX-2", "Offen", "Zweites Excel-Ticket"]
  ]);
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  Object.defineProperty(fileInput, "files", { value: [new win.File([xlsxBuf], "export.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "XLSX-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const xlsx1Row = doc.querySelector("#table-body tr");
  check("XLSX-1 aus .xlsx-Datei (Releaseinfo-Modus) importiert", !!xlsx1Row && xlsx1Row.textContent.includes("XLSX-1"));
  check("XLSX-1 zeigt Status 'Geschlossen'", !!xlsx1Row && xlsx1Row.textContent.includes("Geschlossen"));
  doc.getElementById("search-input").value = "XLSX-2"; fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("XLSX-2 ebenfalls importiert (zweite Datenzeile)", !!doc.querySelector("#table-body tr") && doc.querySelector("#table-body tr").textContent.includes("XLSX-2"));
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Regression: unsinniger Text weiterhin abgelehnt =====================
  await paste("Dies ist irgendein Text ohne jede Ticketstruktur oder Trennzeichen.", "");
  check("Unsinniger Text weiterhin als Fehler erkannt (keine Fehlklassifikation als Key-Liste/CSV)", doc.getElementById("toast").className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FLEXIBLE-IMPORT-FORMAT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
