// Einstellungen -> Gliederung + Steuerung/KPI aus Excel-Matrix hochladen:
// zusätzliches Arbeitsblatt "Uebergaenge" (Kapitel-Übergänge/Abgrenzungen,
// z. B. "14 ↔ 15" oder "15.2/15.7 → 14.8") wird beim Upload mit übernommen
// und im Ticket Graph als eigener, vom Textschnipsel-Querverweise-Graph
// unabhängiger SVG-Graph + Detailtabelle angezeigt.
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

// 3 Kapitel (14/15/16, bewusst nicht sequenziell ab 1 - wie im echten
// oneSCM-Workbook) sowie 3 Uebergaenge-Zeilen: ein wechselseitiger Bezug
// (14 <-> 15), ein gerichteter (15 -> 16) und ein zweiter gerichteter
// Bezug mit MEHREREN Unterkapiteln je Seite ("15.2/15.7 -> 14.8"), der auf
// dasselbe Kapitelpaar (15->14) wie der erste Übergang zurückfällt - prüft
// das Zusammenführen zu einer Kante statt zwei sich überdeckenden Linien.
function buildMatrixXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  const matrixAoa = [
    ["Kapitel", "Thema", "Ebene"],
    ["6", "Antrag abschließen", 1],
    ["7", "Zahlungsdaten", 1],
    ["14", "MO Checks", 1],
    ["15", "HQ-Rolle und Blueprint", 1],
    ["16", "Glossar, Checklisten, Anhang", 1],
  ];
  const uebergaengeAoa = [
    ["ID", "Text", "Fehlende Nachweise"],
    ["T14-15", "Text A ueber den Bezug 14/15.", "14 ↔ 15 | Fehlende Nachweise: Evidence A"],
    ["T15-16", "Text B ueber den Bezug 15/16.", "15 → 16 | Fehlende Nachweise: Evidence B"],
    ["T15-14b", "Text C mit Unterkapiteln.", "15.2/15.7 → 14.8 | Fehlende Nachweise: Evidence C"],
    // Regression: EINSTELLIGE Kapitelnummern (6/7) - fing frueher faelschlich
    // nichts, weil ein GLEICHNAMIGES, aber zweistellig nullgepolstertes
    // chapterNumberFromTitle() (Referenz-Nummern-Generator, an anderer
    // Stelle der Datei definiert) die hier noetige Funktion überschrieben
    // hatte (spaetere Funktionsdeklaration gewinnt) - "6"/"7" wurden dabei
    // mit "06"/"07" verglichen und nie gefunden. Mit zweistelligen Test-
    // Kapitelnummern (14/15/16) allein war das nicht aufgefallen, da
    // Nullpolsterung auf 2 Stellen dort wirkungslos blieb.
    ["T6-7", "Text D ueber den einstelligen Bezug 6/7.", "6 → 7 | Fehlende Nachweise: Evidence D"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa), "Matrix");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(uebergaengeAoa), "Uebergaenge");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Leerer Zustand (noch keine Matrix hochgeladen) =====================
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(50);
  check("Button 'Kapitel-Übergänge anzeigen' vorhanden", !!doc.getElementById("outline-transitions-graph-generate-btn"));
  fire(doc.getElementById("outline-transitions-graph-generate-btn"), "click");
  await wait(50);
  check("Leerer Zustand: Graph-Wrap ausgeblendet", doc.getElementById("outline-transitions-graph-wrap").hidden === true);
  check("Leerer Zustand: Tabelle ausgeblendet", doc.getElementById("outline-transitions-table-wrap").hidden === true);
  check("Leerer Zustand: Leer-Meldung sichtbar", doc.getElementById("outline-transitions-graph-empty").hidden === false);

  // ===================== Matrix mit Arbeitsblatt "Uebergaenge" hochladen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const buf = buildMatrixXlsxBuffer();
  const input = doc.getElementById("outline-matrix-upload-input");
  Object.defineProperty(input, "files", { value: [new win.File([buf], "uebergaenge_test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(input, "change");
  await confirmViaModal(doc);

  check("Gliederung ersetzt: genau 5 Kapitel", doc.querySelectorAll(".outline-chapter-row").length === 5);
  check("Protokoll vermerkt 4 übernommene Kapitel-Übergänge", doc.getElementById("log-list").textContent.includes("4 Kapitel-Übergänge"));

  // ===================== Graph + Tabelle nach Upload =====================
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(50);
  fire(doc.getElementById("outline-transitions-graph-generate-btn"), "click");
  await wait(50);

  check("Graph-Wrap jetzt sichtbar", doc.getElementById("outline-transitions-graph-wrap").hidden === false);
  check("Leer-Meldung jetzt ausgeblendet", doc.getElementById("outline-transitions-graph-empty").hidden === true);
  check("Tabelle jetzt sichtbar", doc.getElementById("outline-transitions-table-wrap").hidden === false);

  const tableRows = Array.from(doc.querySelectorAll("#outline-transitions-tbody tr"));
  check("Tabelle zeigt alle 4 rohen Übergangs-Zeilen (unabhängig von der Graph-Zuordnung)", tableRows.length === 4);
  check("Tabelle zeigt ID 'T15-14b'", tableRows.some((tr) => tr.textContent.includes("T15-14b")));
  check("Tabelle zeigt vollen Text von T15-16 ('Text B ueber den Bezug 15/16.')", tableRows.some((tr) => tr.textContent.includes("Text B ueber den Bezug 15/16.")));
  check("Tabelle zeigt 'Fehlende Nachweise' von T14-15 ('Evidence A')", tableRows.some((tr) => tr.textContent.includes("Evidence A")));

  const svg = doc.querySelector("#outline-transitions-graph-svg-container svg");
  check("SVG wurde gerendert", !!svg);
  const circles = svg ? Array.from(svg.querySelectorAll("circle")) : [];
  check("Genau 5 Kapitel-Knoten (6/7/14/15/16)", circles.length === 5);
  const circleTitles = circles.map((c) => c.querySelector("title") && c.querySelector("title").textContent);
  check("Knoten 'Kapitel 6: Antrag abschließen' vorhanden (einstellige Kapitelnummer)", circleTitles.includes("Kapitel 6: Antrag abschließen"));
  check("Knoten 'Kapitel 7: Zahlungsdaten' vorhanden (einstellige Kapitelnummer)", circleTitles.includes("Kapitel 7: Zahlungsdaten"));
  check("Knoten 'Kapitel 14: MO Checks' vorhanden", circleTitles.includes("Kapitel 14: MO Checks"));
  check("Knoten 'Kapitel 15: HQ-Rolle und Blueprint' vorhanden", circleTitles.includes("Kapitel 15: HQ-Rolle und Blueprint"));
  check("Knoten 'Kapitel 16: Glossar, Checklisten, Anhang' vorhanden", circleTitles.includes("Kapitel 16: Glossar, Checklisten, Anhang"));

  const lines = svg ? Array.from(svg.querySelectorAll("line")) : [];
  check("Genau 4 Kanten (14→15, 15→14 [zusammengeführt], 15→16, 6→7) - keine doppelte Linie für denselben Übergang", lines.length === 4);
  const lineTitles = lines.map((l) => l.querySelector("title") && l.querySelector("title").textContent);
  check("Kante 14→15 (aus T14-15, wechselseitig) vorhanden", lineTitles.some((t) => t && t.includes("T14-15") && t.includes("Kapitel 14") && t.includes("Kapitel 15") && t.includes("Text A")));
  check("Kante 15→16 (aus T15-16, gerichtet) vorhanden", lineTitles.some((t) => t && t.includes("T15-16") && t.includes("Kapitel 15") && t.includes("Kapitel 16") && t.includes("Text B")));
  check("Kante 6→7 (aus T6-7, EINSTELLIGE Kapitelnummern) vorhanden - Regressionsschutz gegen die Funktionsnamen-Kollision",
    lineTitles.some((t) => t && t.includes("T6-7") && t.includes("Kapitel 6") && t.includes("Kapitel 7") && t.includes("Text D")));
  const merged15to14 = lineTitles.find((t) => t && t.includes("Kapitel 15") && t.includes("Kapitel 14") && t.indexOf("Kapitel 15") < t.indexOf("Kapitel 14"));
  check("Kante 15→14 führt T14-15 (wechselseitig) UND T15-14b (Unterkapitel-Bezug) in einer Linie zusammen", !!merged15to14 && merged15to14.includes("T14-15") && merged15to14.includes("T15-14b"));
  check("Zusammengeführte Kante 15→14 zeigt den Text des ERSTEN Übergangs (T14-15: 'Text A'), nicht T15-14b", !!merged15to14 && merged15to14.includes("Text A") && !merged15to14.includes("Text C"));

  const statusNote = doc.getElementById("outline-transitions-graph-status-note").textContent;
  check("Status-Hinweis nennt 5 Kapitel und 4 Übergangs-Beziehung(en)", statusNote.includes("5 Kapitel") && statusNote.includes("4 Übergangs-Beziehung"));

  // ===================== Bleibt bei "Alle Daten löschen" erhalten (Konfiguration) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(50);
  fire(doc.getElementById("outline-transitions-graph-generate-btn"), "click");
  await wait(50);
  check("Nach 'Alle Daten löschen': Kapitel-Übergänge bleiben erhalten (Konfiguration, kein Sitzungsdatensatz)",
    doc.querySelectorAll("#outline-transitions-tbody tr").length === 4);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE KAPITEL-UEBERGAENGE-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
