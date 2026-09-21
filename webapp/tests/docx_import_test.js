const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = JSZipNode;
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Accept-Attribute zeigen .docx/.doc an =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  check("Releaseinfo-Dropzone akzeptiert .docx/.doc", doc.getElementById("file-input").getAttribute("accept").includes(".docx"));
  doc.querySelector('.import-tab[data-mode="andere"]').click();
  check("'Andere Importe'-Dropzone akzeptiert .docx/.doc", doc.getElementById("file-input").getAttribute("accept").includes(".docx"));
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();

  // ===================== Echte .docx-Datei importieren (reales Confluence/Jira-Releaseinfo-Word-Dokument) =====================
  const docxBuf = fs.readFileSync(path.join(FIXTURES, "releaseinfo_sample.docx"));
  const docxFile = new win.File([docxBuf], "Release_Prod-Deploy-15.09.2026_Major.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [docxFile], configurable: true });
  fire(input, "change");
  await wait(600);

  const toast = doc.getElementById("toast");
  check("Import-Toast zeigt keinen Fehler", !toast.className.includes("error"));
  check("Import-Toast meldet Erfolg", toast.textContent.includes("Import erfolgreich"));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRow = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("Release_Prod-Deploy"));
  check("Import-Zeile für die .docx-Datei vorhanden", !!importRow);
  if (importRow) {
    check("Format-Spalte nennt Releaseinfo", importRow.textContent.includes("Releaseinfo"));
    // 125 Tabellenzeilen in der Datei, aber manche Tickets stehen in mehreren
    // Service-Abschnitten (Komponenten) - dieselbe Dedupe-Logik wie beim
    // .txt-Import verdichtet das auf 111 eindeutige Tickets (siehe unten:
    // identischer Wert beim direkten .txt-Import derselben Inhalte).
    const ticketCountCell = importRow.querySelectorAll("td")[4];
    check("Aus der .docx wurden 111 eindeutige Tickets importiert (dedupliziert über Service-Abschnitte)", ticketCountCell.textContent.trim() === "111");
  }

  // Stichprobe: bekanntes Ticket aus der Datei im Dashboard vorhanden
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-45030";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  const dashboardText = doc.getElementById("table-body").textContent;
  check("Ticket ONESCM-45030 aus der .docx im Dashboard auffindbar", dashboardText.includes("ONESCM-45030"));
  check("Zusammenfassung aus der .docx korrekt übernommen", dashboardText.includes("Change renaming logic for uploaded documents"));

  // Domain aus dem Tabellenkontext (Service-Header-Zeile) korrekt zugeordnet
  const rowEl = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("ONESCM-45030"));
  check("Domain 'Documents & Communications' aus dem Tabellen-Header korrekt erkannt", !!rowEl && rowEl.textContent.includes("Documents"));
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Vergleich mit direktem .txt-Import derselben Inhalte: identisches Ergebnis =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const txtContent = fs.readFileSync(path.join(FIXTURES, "releaseinfo_full.txt"), "utf-8");
  const txtFile = new win.File([txtContent], "release_notes.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [txtFile], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const txtImportRow = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("release_notes.txt"));
  check(".txt-Referenzimport derselben Inhalte ergibt identisch 111 Tickets", !!txtImportRow && txtImportRow.querySelectorAll("td")[4].textContent.trim() === "111");

  // ===================== Legacy .doc (altes Binärformat) wird ehrlich abgelehnt =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  const legacyDocFile = new win.File([oleHeader], "altes_dokument.doc", { type: "application/msword" });
  Object.defineProperty(input, "files", { value: [legacyDocFile], configurable: true });
  fire(input, "change");
  await wait(300);
  const toast2 = doc.getElementById("toast");
  check("Legacy .doc-Datei löst Fehlermeldung statt Absturz aus", toast2.className.includes("error"));
  check("Fehlermeldung erklärt fehlende .doc-Unterstützung verständlich", toast2.textContent.includes(".docx") || toast2.textContent.includes("Word 2007"));

  // ===================== Beschädigte/keine echte .docx-Datei =====================
  const garbageFile = new win.File(["not a real docx file, just plain text"], "kaputt.docx", { type: "application/octet-stream" });
  Object.defineProperty(input, "files", { value: [garbageFile], configurable: true });
  fire(input, "change");
  await wait(300);
  const toast3 = doc.getElementById("toast");
  check("Kaputte .docx-Datei löst Fehlermeldung statt Absturz aus", toast3.className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DOCX-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
