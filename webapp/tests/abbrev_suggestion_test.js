const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Eigenes Freitext-Ticket mit bekannten und unbekannten Kürzeln importieren
  // (Basisdatensatz hat keine Zusammenfassung, siehe verarbeitung_subtabs_test.js)
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>ABBR-1</key><summary>Neue API und UI Anbindung fuer BRABUS Projekt</summary>
      <description>Die REST API liefert JSON, die UI zeigt PDF Export.</description>
      <status>Offen</status></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "abbrev_test.xml", { type: "text/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);

  const abbrevCount = parseInt(doc.getElementById("abbrev-count").textContent, 10);
  check("Extraktion fand Abkürzungen aus dem neuen Ticket", abbrevCount > 0);

  // ===================== Tabellenkopf =====================
  const headCells = Array.from(doc.querySelectorAll("#abbrev-table thead th")).map((th) => th.textContent);
  check("Job-3-Tabelle hat 6 Spalten inkl. Vorschlag DE/EN + Übernehmen-Aktion", headCells.length === 6);
  check("Spalte 'Vorschlag Deutsch' vorhanden (Job 3)", headCells.includes("Vorschlag Deutsch"));
  check("Spalte 'Vorschlag Englisch' vorhanden (Job 3)", headCells.includes("Vorschlag Englisch"));

  const headCellsRegister = Array.from(doc.querySelectorAll("#abbrev-table-register thead th")).map((th) => th.textContent);
  check("Register-Tabelle hat 6 Spalten inkl. Vorschlag DE/EN + Übernehmen-Aktion", headCellsRegister.length === 6);

  // ===================== Bekannte Kürzel bekommen Vorschlag =====================
  function rowFor(term, tbodyId) {
    return Array.from(doc.querySelectorAll("#" + tbodyId + " tr")).find((tr) => tr.children[0].textContent === term);
  }
  const apiRow = rowFor("API", "abbrev-tbody");
  check("Zeile für 'API' vorhanden", !!apiRow);
  if (apiRow) {
    check("API: Deutsch-Vorschlag nennt 'Programmierschnittstelle'", apiRow.children[3].textContent.includes("Programmierschnittstelle"));
    check("API: Englisch-Vorschlag nennt 'Application Programming Interface'", apiRow.children[4].textContent === "Application Programming Interface");
  }
  const pdfRow = rowFor("PDF", "abbrev-tbody");
  check("Zeile für 'PDF' vorhanden mit Vorschlag", !!pdfRow && pdfRow.children[3].textContent.includes("Dokumentenformat"));
  const jsonRow = rowFor("JSON", "abbrev-tbody");
  check("Zeile für 'JSON' vorhanden mit Vorschlag", !!jsonRow && jsonRow.children[4].textContent.includes("JavaScript Object Notation"));
  const uiRow = rowFor("UI", "abbrev-tbody");
  check("Zeile für 'UI' vorhanden mit Vorschlag", !!uiRow && uiRow.children[3].textContent.includes("Benutzeroberfläche"));

  // ===================== Unbekanntes/firmenspezifisches Kürzel bleibt ehrlich leer =====================
  const brabusRow = rowFor("BRABUS", "abbrev-tbody");
  check("Zeile für 'BRABUS' (firmenspezifisch) vorhanden", !!brabusRow);
  if (brabusRow) {
    check("BRABUS: kein erfundener Deutsch-Vorschlag (zeigt '–')", brabusRow.children[3].textContent.trim() === "–");
    check("BRABUS: kein erfundener Englisch-Vorschlag (zeigt '–')", brabusRow.children[4].textContent.trim() === "–");
  }

  // ===================== Register-Ansicht zeigt dieselben Vorschläge =====================
  const apiRowRegister = rowFor("API", "abbrev-tbody-register");
  check("Register zeigt denselben Vorschlag für 'API'", !!apiRowRegister && apiRowRegister.children[3].textContent.includes("Programmierschnittstelle"));

  // ===================== Hinweistexte klar als Vorschlag gekennzeichnet =====================
  const jobDesc = doc.querySelector('[data-vsub-panel="glossar-extrakt"] .desc').textContent;
  check("Job-3-Beschreibung erwähnt 'unverbindlichen Vorschlag'", jobDesc.includes("unverbindlichen Vorschlag"));
  check("Job-3-Beschreibung erwähnt weiterhin 'keine Bedeutungen erfunden'", jobDesc.includes("keine Bedeutungen erfunden"));
  const registerDesc = doc.querySelector('[data-view-panel="abkuerzungen"] .desc').textContent;
  check("Register-Beschreibung erklärt die Vorschlagsspalten", registerDesc.includes("unverbindliche Vorschläge"));

  // ===================== HTML-Escaping der Vorschlags-Spalten (XSS-Schutz) =====================
  // Nur die ersten 5 (reinen Text-)Zellen jeder Zeile pruefen - die 6.
  // Zelle (neuer "In Abkürzungs-Übersetzungen übernehmen"-Button) enthaelt
  // bewusst echtes Markup und faellt zu Recht nicht unter diesen Schutz.
  const abbrevRows = Array.from(doc.querySelectorAll("#abbrev-tbody tr"));
  const hasUnescapedInTextCells = abbrevRows.some((tr) => Array.from(tr.children).slice(0, 5).some((td) => td.innerHTML.includes("<")));
  check("Keine ungeschützten '<' in den reinen Text-Vorschlagszellen (Kürzel/Häufigkeit/Beispiele/Vorschläge)", !hasUnescapedInTextCells);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ABKUERZUNGS-VORSCHLAG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
