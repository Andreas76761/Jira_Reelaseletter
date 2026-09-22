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
async function buildMinimalXlsx(sheets) {
  // sheets: array of 2D-arrays (eine pro Arbeitsblatt)
  const zip = new JSZipNode();
  const sharedStrings = []; const sharedIndex = {};
  function sIdx(s) { if (!(s in sharedIndex)) { sharedIndex[s] = sharedStrings.length; sharedStrings.push(s); } return sharedIndex[s]; }
  sheets.forEach((rows, sheetIdx) => {
    const rowsXml = rows.map((row, ri) => {
      const r = ri + 1;
      const cells = row.map((val, ci) => `<c r="${xlsxColLetter(ci)}${r}" t="s"><v>${sIdx(String(val))}</v></c>`).join("");
      return `<row r="${r}">${cells}</row>`;
    }).join("");
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
    zip.file(`xl/worksheets/sheet${sheetIdx + 1}.xml`, sheetXml);
  });
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join("") + `</sst>`;
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
  const fileInput = doc.getElementById("file-input");

  async function paste(text, comment) {
    doc.querySelector('.nav-item[data-view="import"]').click();
    commentInput.value = comment || "";
    pasteTextarea.value = text;
    fire(pasteBtn, "click");
    await wait(150);
  }
  async function findTicket(key) {
    doc.querySelector('.nav-item[data-view="dashboard"]').click();
    doc.getElementById("search-input").value = key;
    fire(doc.getElementById("search-input"), "input");
    await wait(200);
    const row = doc.querySelector("#table-body tr");
    const found = row && row.textContent.includes(key) ? row.textContent : null;
    doc.getElementById("search-input").value = "";
    fire(doc.getElementById("search-input"), "input");
    await wait(200);
    return found;
  }

  // ===================== Toleranter Listen-Import: Bullet/Nummerierung/Kleinschreibung/Ueberschrift =====================
  const messyList = "Meine Tickets zur Pruefung:\n- robust-1\n2) ROBUST-2\n* Robust-3,\n\nrobust-4;\n";
  await paste(messyList, "Robuste Liste");
  check("Dekorierte/gemischte Ticket-Liste wird NICHT als 'Format nicht erkannt' abgelehnt", !doc.getElementById("toast").className.includes("error"));
  const toastMessy = doc.getElementById("toast").textContent;
  check("Toast bestaetigt Speicherung als Liste trotz Dekorationen", toastMessy.includes("Robuste Liste"));
  check("ROBUST-1 (aus '- robust-1', kleingeschrieben) wurde erkannt und normalisiert", !!(await findTicket("ROBUST-1")));
  check("ROBUST-2 (aus '2) ROBUST-2', Nummerierung) wurde erkannt", !!(await findTicket("ROBUST-2")));
  check("ROBUST-3 (aus '* Robust-3,', Bullet + Komma) wurde erkannt", !!(await findTicket("ROBUST-3")));
  check("ROBUST-4 (aus 'robust-4;', Semikolon) wurde erkannt", !!(await findTicket("ROBUST-4")));

  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  const listRow = Array.from(doc.querySelectorAll("#listenauswahl-tbody tr")).find((r) => r.textContent.includes("Robuste Liste"));
  check("Liste 'Robuste Liste' zeigt genau 4 Tickets (Ueberschriftszeile korrekt uebersprungen, nicht mitgezaehlt)", !!listRow && listRow.textContent.includes("4"));

  // ===================== Regression: reine Prosa weiterhin abgelehnt =====================
  await paste("Dies ist irgendein Text ohne jede Ticketstruktur oder Trennzeichen und ohne Aufzaehlung.", "");
  check("Reine Prosa (kein Schluessel enthalten) weiterhin als Fehler erkannt", doc.getElementById("toast").className.includes("error"));

  // ===================== CSV mit mehrzeiligem quotierten Feld =====================
  const csvMultiline = 'Key,Status,Summary\nMLCSV-1,Offen,"Erste Zeile der Beschreibung\nZweite Zeile der Beschreibung"\nMLCSV-2,Fertig,Normaler einzeiliger Text';
  await paste(csvMultiline, "");
  check("CSV mit mehrzeiligem quotierten Feld wird nicht als Fehler abgelehnt", !doc.getElementById("toast").className.includes("error"));
  const mlText1 = await findTicket("MLCSV-1");
  check("MLCSV-1 (mehrzeiliges Feld) korrekt importiert, nicht in zwei Zeilen zerrissen", !!mlText1);
  check("MLCSV-1 Beschreibung enthaelt BEIDE Zeilen des quotierten Feldes", !!mlText1 && mlText1.includes("Erste Zeile") && mlText1.includes("Zweite Zeile"));
  const mlText2 = await findTicket("MLCSV-2");
  check("MLCSV-2 (Zeile NACH dem mehrzeiligen Feld) korrekt als eigenes Ticket erkannt (nicht mit vorheriger Zeile verschmolzen)", !!mlText2 && mlText2.includes("Normaler einzeiliger Text"));

  // ===================== XLSX mit mehreren Arbeitsblaettern =====================
  const xlsxMultiBuf = await buildMinimalXlsx([
    [["Key", "Status", "Summary"], ["SHEET1-1", "Offen", "Ticket vom ersten Blatt"]],
    [["Key", "Status", "Summary"], ["SHEET2-1", "Fertig", "Ticket vom zweiten Blatt"]]
  ]);
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="andere"]').click();
  Object.defineProperty(fileInput, "files", { value: [new win.File([xlsxMultiBuf], "multisheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  check("Ticket vom ERSTEN Arbeitsblatt (SHEET1-1) importiert", !!(await findTicket("SHEET1-1")));
  check("Ticket vom ZWEITEN Arbeitsblatt (SHEET2-1) ebenfalls importiert", !!(await findTicket("SHEET2-1")));

  // ===================== ZIP mit reiner Ticket-Nummern-Liste als Eintrag =====================
  const zip = new JSZipNode();
  zip.file("keys.txt", "ZIPLIST-1\nZIPLIST-2\nZIPLIST-3\n");
  zip.file("normal.xml", `<?xml version="1.0"?><rss><channel><item><key>ZIPXML-1</key><summary>Normales ZIP-Ticket</summary><description>D</description><status>Offen</status><type>Task</type></item></channel></rss>`);
  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="zip"]').click();
  commentInput.value = "ZIP-Ticketliste";
  Object.defineProperty(fileInput, "files", { value: [new win.File([zipBuf], "archiv.zip", { type: "application/zip" })], configurable: true });
  fire(fileInput, "change");
  await wait(400);
  const zipToast = doc.getElementById("toast").textContent;
  console.log("ZIP-Import-Toast:", zipToast);
  check("ZIP-Import-Toast bestaetigt Speicherung der enthaltenen Ticket-Liste als neue Liste", zipToast.includes("ZIP-Ticketliste"));
  check("ZIPXML-1 (normale Datei im ZIP) importiert", !!(await findTicket("ZIPXML-1")));
  check("ZIPLIST-1 (aus der reinen Ticket-Liste im ZIP) als Platzhalter-Ticket importiert", !!(await findTicket("ZIPLIST-1")));

  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  const zipListRow = Array.from(doc.querySelectorAll("#listenauswahl-tbody tr")).find((r) => r.textContent.includes("ZIP-Ticketliste"));
  check("Liste 'ZIP-Ticketliste' unter Listenauswahl gespeichert (3 Tickets)", !!zipListRow && zipListRow.textContent.includes("3"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE IMPORT-ROBUSTHEITS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
