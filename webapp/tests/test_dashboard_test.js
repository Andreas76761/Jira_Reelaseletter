// Einstellungen -> Dokumentation -> Testing: eingebettetes Testdashboard
// (webapp/tests/test-results.json, ueber __TEST_RESULTS__ zum Build-
// Zeitpunkt eingebettet). Testet die Anzeige gegen die tatsaechlich in
// diesem Build eingebetteten Daten (aus einem echten run-all.js-Lauf).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // In diesem Build eingebettete Rohdaten direkt gegenlesen (Ground Truth).
  const raw = JSON.parse(doc.getElementById("test-results-data").textContent) || {};
  const rawFiles = raw.files || [];

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);

  // ===================== Zusammenfassung-Chips zeigen die eingebetteten Zahlen =====================
  check("Testdateien-Chip zeigt Anzahl Dateien", doc.getElementById("test-results-suites").textContent === String(rawFiles.length));
  const expectedFilesPassed = rawFiles.filter((f) => f.status === "pass").length;
  check("'Dateien bestanden'-Chip stimmt", doc.getElementById("test-results-files-passed").textContent === String(expectedFilesPassed));
  const expectedChecksTotal = rawFiles.reduce((s, f) => s + (f.checks || []).length, 0);
  check("Checks-gesamt-Chip stimmt", doc.getElementById("test-results-total").textContent === String(expectedChecksTotal));
  check("Laufzeit-Chip zeigt eine Zeitangabe (s/ms)", /\d+(\.\d+)?\s*(s|ms)/.test(doc.getElementById("test-results-duration").textContent));
  check("Stand-Datum ist gesetzt (nicht '–')", doc.getElementById("test-results-date").textContent !== "–");

  // ===================== Pro Datei: Zeile mit Status + Dauer, granular je Testfall aufklappbar =====================
  const tbodyText = doc.getElementById("test-results-tbody").textContent;
  check("Mind. eine bekannte Testdatei (z.B. rag_test.js) ist gelistet", tbodyText.includes("rag_test.js"));
  check("Aufklapp-Button je Testdatei vorhanden", !!doc.querySelector(".test-group-toggle"));

  // Fuer die Auf-/Zuklapp-Interaktion gezielt eine BESTANDENE Datei waehlen
  // (nicht einfach "die erste") - eine fehlgeschlagene Datei ist bewusst
  // immer initial aufgeklappt (siehe renderTestResults()), waere hier also
  // ein falsch-negativer Check, wenn zufaellig die erste gelistete Datei in
  // den eingebetteten Rohdaten fehlgeschlagen ist.
  const passingFile = rawFiles.find((f) => f.status === "pass");
  check("Mind. eine bestandene Testdatei fuer die Interaktions-Pruefung vorhanden", !!passingFile);
  function passingGroupRow() {
    return Array.from(doc.querySelectorAll(".test-group-row:not(.test-group-row-failed)"))
      .find((row) => row.textContent.includes(passingFile.name));
  }
  function checkRowsOfGroup(groupRow) {
    var rows = []; var el = groupRow && groupRow.nextElementSibling;
    while (el && el.classList.contains("test-check-row")) { rows.push(el); el = el.nextElementSibling; }
    return rows;
  }
  if (passingFile) {
    check("Testfall-Zeilen einer bestandenen Datei initial eingeklappt", checkRowsOfGroup(passingGroupRow()).every((r) => r.hidden));
    // Jeder renderTestResults()-Aufruf ersetzt tbody.innerHTML komplett - eine
    // vor dem Klick abgefragte Button-Referenz wird danach vom Dokument
    // getrennt und bubbelt keine weiteren Klicks mehr zum delegierten
    // Listener. Daher nach jedem Render frisch abfragen (gleiches Muster wie
    // im Ticket-Graph-Mehrfachauswahl-Test).
    fire(passingGroupRow().querySelector(".test-group-toggle"), "click");
    await wait(50);
    check("Nach Klick: Testfall-Zeilen (Schritte) dieser Datei sichtbar", checkRowsOfGroup(passingGroupRow()).every((r) => !r.hidden));
    fire(passingGroupRow().querySelector(".test-group-toggle"), "click");
    await wait(50);
    check("Erneuter Klick klappt wieder ein", checkRowsOfGroup(passingGroupRow()).every((r) => r.hidden));
  }

  // ===================== Tabellenstruktur: Header/Zeilen konsistent 3 Spalten (kein colspan-Bug) =====================
  const headerCells = doc.querySelectorAll("#test-results-table thead th");
  check("Tabellenkopf hat 3 Spalten (Testfall / Status / Dauer)", headerCells.length === 3);
  const firstGroupRow = doc.querySelector(".test-group-row");
  check("Erste Datei-Zeile hat 3 Zellen (Name, Status, Dauer)", !!firstGroupRow && firstGroupRow.querySelectorAll("td").length === 3);

  // ===================== Optimierungen-Abschnitt =====================
  const optTbodyText = doc.getElementById("test-optimizations-tbody").textContent;
  check("Optimierungen: Parallelisierung genannt", optTbodyText.includes("parallel"));
  check("Optimierungen: JSDOM-Boot-Erkenntnis genannt", optTbodyText.includes("JSDOM") || optTbodyText.includes("Boot"));
  check("Optimierungen-Tabelle nicht leer (kein 'keine Daten'-Hinweis sichtbar)", doc.getElementById("test-optimizations-empty").hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TESTDASHBOARD-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
