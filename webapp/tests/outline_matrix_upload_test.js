// Einstellungen -> Benutzerhandbuch-Gliederung: "Gliederung + Steuerung/KPI
// aus Excel-Matrix hochladen (.xlsx)". Liest ein mehrblaettriges Workbook
// (wie die oneSCM-Matrix-Vorlage) mit den Arbeitsblaettern "Matrix"
// (Kapitel/Thema/Ebene + Steuerungsspalten) und optional "KPI_Kapitel"
// (Kapitel-KPI-Basiswerte) und ersetzt die Gliederung komplett (wie beim
// bestehenden .docx-Upload), zusaetzlich mit Steuerung/KPI-Basiswerten je
// Kapitel (neuer Bereich "Steuerung & KPI" + Status-Spalte bei
// Massenverarbeitung).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const XLSX = require("xlsx");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = { use: function () { return Promise.resolve(null); } };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// Baut eine minimale, aber strukturell echte Matrix-Datei (2 Kapitel, je 1
// Unterkapitel + 1 Feinthema) mit Steuerungsspalten (Praefix "N " wie im
// echten Workbook, s. xlsxHeaderIndexMap) sowie ein KPI_Kapitel-Blatt mit
// Basiswerten fuer Kapitel 2 - Kapitel 1 bleibt dort bewusst ohne Zeile,
// um den Standardwert-Fallback (ensureChapterSteuerung) mitzuprüfen.
function buildMatrixXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  const matrixAoa = [
    ["Kapitel", "Thema", "Ebene", "Alte Kapitel-ID", "8 Bearbeitungsstatus", "38 Genehmigungsstatus", "42 Publikationsstatus"],
    ["1", "Einführung und Überblick", 1, "1", "In Bearbeitung", "Beantragt", "Nicht veröffentlicht"],
    ["1.1", "Ziele und Nutzen", 2, "1.1", "Offen", "Nicht beantragt", "Nicht veröffentlicht"],
    ["1.1.1", "Fachlicher Zweck", 3, "1.1.1", "Offen", "Nicht beantragt", "Nicht veröffentlicht"],
    ["2", "Zugang und Rollen", 1, "2", "Offen", "Nicht beantragt", "Nicht veröffentlicht"],
    ["2.1", "Login und SSO", 2, "2.1", "Offen", "Nicht beantragt", "Nicht veröffentlicht"],
  ];
  const kpiAoa = [
    ["Kapitel", "Kapitelname", "Aussagen gesamt", "Aussagen belegt", "Pflichtkriterien gesamt", "Pflichtkriterien bestanden",
      "Prüfumfang vollständig", "Kritische Befunde (eindeutig)", "Quellenabdeckung", "Prüf-Erfüllungsquote", "Gate"],
    [2, "Zugang und Rollen", 10, 8, 5, 4, "Teilweise geprüft", 2, 80, 75, "Erfüllt"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa), "Matrix");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiAoa), "KPI_Kapitel");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);

  check("Button 'Gliederung + Steuerung/KPI aus Excel-Matrix hochladen' vorhanden", !!doc.getElementById("outline-matrix-upload-btn"));
  check("'Steuerung & KPI'-Tabelle initial mit 23 Standard-Kapitel-Zeilen (Ausgangsgliederung) vorhanden",
    doc.querySelectorAll("#outline-steuerung-tbody tr").length === 23);
  const firstRowCellsBefore = doc.querySelector("#outline-steuerung-tbody tr").querySelectorAll("select,input");
  check("Jede Zeile zeigt Standardwerte (Bearbeitung 'Offen') vor jedem Upload",
    Array.from(firstRowCellsBefore).some((el) => el.tagName === "SELECT" && el.value === "Offen"));

  const buf = buildMatrixXlsxBuffer();
  const input = doc.getElementById("outline-matrix-upload-input");
  Object.defineProperty(input, "files", { value: [new win.File([buf], "oneSCM_Matrix_test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(input, "change");
  await confirmViaModal(doc);

  check("Bestätigungsdialog-Ersatz übernommen: genau 2 Kapitel in der Gliederung", doc.querySelectorAll(".outline-chapter-row").length === 2);
  check("Kapitel 1 korrekt benannt ('Kapitel 1: Einführung und Überblick')",
    doc.getElementById("outline-tbody").textContent.includes("Kapitel 1: Einführung und Überblick"));
  check("Kapitel 2 korrekt benannt ('Kapitel 2: Zugang und Rollen')",
    doc.getElementById("outline-tbody").textContent.includes("Kapitel 2: Zugang und Rollen"));
  check("Unterkapitel '1.1 Ziele und Nutzen' übernommen", doc.getElementById("outline-tbody").textContent.includes("1.1 Ziele und Nutzen"));
  check("Feinthema '1.1.1 Fachlicher Zweck' ebenfalls als Unterkapitel übernommen (Ebene 2+3 beide)",
    doc.getElementById("outline-tbody").textContent.includes("1.1.1 Fachlicher Zweck"));
  check("Protokoll vermerkt den Ersatz samt Steuerung/KPI-Hinweis", doc.getElementById("log-list").textContent.includes("KPI_Kapitel"));

  check("'Steuerung & KPI'-Tabelle zeigt jetzt genau 2 Zeilen (eine je Kapitel)",
    doc.querySelectorAll("#outline-steuerung-tbody tr").length === 2);
  const rows = Array.from(doc.querySelectorAll("#outline-steuerung-tbody tr"));
  const row1 = rows.find((tr) => tr.textContent.includes("Kapitel 1"));
  const row2 = rows.find((tr) => tr.textContent.includes("Kapitel 2"));
  check("Kapitel-1-Zeile vorhanden", !!row1);
  check("Kapitel-2-Zeile vorhanden", !!row2);
  if (row1) {
    const bearbSel = row1.querySelector('select[data-field="bearbeitungsstatus"]');
    const genSel = row1.querySelector('select[data-field="genehmigungsstatus"]');
    check("Kapitel 1: Bearbeitungsstatus 'In Bearbeitung' aus der Matrix-Zeile übernommen", bearbSel && bearbSel.value === "In Bearbeitung");
    check("Kapitel 1: Genehmigungsstatus 'Beantragt' übernommen", genSel && genSel.value === "Beantragt");
    const gateSel = row1.querySelector('select[data-field="gate"]');
    check("Kapitel 1 (keine KPI_Kapitel-Zeile): Gate bleibt Standardwert 'Nicht geprüft'", gateSel && gateSel.value === "Nicht geprüft");
    const qaInput = row1.querySelector('input[data-field="quellenabdeckung"]');
    check("Kapitel 1 (keine KPI_Kapitel-Zeile): Quellenabdeckung bleibt leer", qaInput && qaInput.value === "");
  }
  if (row2) {
    const gateSel = row2.querySelector('select[data-field="gate"]');
    check("Kapitel 2: Gate 'Erfüllt' aus KPI_Kapitel übernommen", gateSel && gateSel.value === "Erfüllt");
    const qaInput = row2.querySelector('input[data-field="quellenabdeckung"]');
    const peInput = row2.querySelector('input[data-field="pruefErfuellungsquote"]');
    const kbInput = row2.querySelector('input[data-field="kritischeBefunde"]');
    check("Kapitel 2: Quellenabdeckung 80 übernommen", qaInput && qaInput.value === "80");
    check("Kapitel 2: Prüf-Erfüllungsquote 75 übernommen", peInput && peInput.value === "75");
    check("Kapitel 2: Kritische Befunde 2 übernommen", kbInput && kbInput.value === "2");
  }

  // ===================== Steuerung & KPI direkt editierbar =====================
  if (row1) {
    const bearbSel = row1.querySelector('select[data-field="bearbeitungsstatus"]');
    bearbSel.value = "Fertig";
    fire(bearbSel, "change");
    await wait(30);
    check("Bearbeitung von Kapitel 1 auf 'Fertig' geändert und im Protokoll vermerkt", doc.getElementById("log-list").textContent.includes("Fertig"));
  }

  // ===================== Status-Spalte bei Massenverarbeitung =====================
  // Braucht mindestens 1 Textschnipsel, damit renderMassFiles() ueberhaupt
  // eine Tabelle (statt der Leer-Meldung) rendert - dafuer genuegt ein
  // beliebiges importiertes Ticket samt "Tickets uebernehmen"; die Domaene
  // muss dabei keinem Kapitel entsprechen (Matrix-Upload liefert bewusst
  // keine Domaenen-Zuordnung), der Status-Spalten-Check prueft nur den
  // Tabellenkopf, nicht eine konkrete Kapitel-Zuordnung.
  const massXml = `<?xml version="1.0"?><rss><channel>
    <item><key>MX-1</key><summary>Testticket</summary><description>Beschreibung.</description><status>Offen</status><type>Task</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const massFileInput = doc.getElementById("file-input");
  Object.defineProperty(massFileInput, "files", { value: [new win.File([massXml], "mx.xml", { type: "application/xml" })], configurable: true });
  fire(massFileInput, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(100);
  check("Massenverarbeitung-Tabelle zeigt eine 'Status'-Spalte", doc.getElementById("mass-groups").innerHTML.includes("<th>Status</th>"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  // ===================== 'Alle Daten löschen' lässt Steuerung & KPI unberührt (Konfiguration wie Gliederung) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("Nach 'Alle Daten löschen': Steuerung & KPI (2 Kapitel) bleibt erhalten (Konfiguration, kein Sitzungsdatensatz)",
    doc.querySelectorAll("#outline-steuerung-tbody tr").length === 2);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE EXCEL-MATRIX-GLIEDERUNGS-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
