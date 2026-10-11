// Verarbeitung -> 3. Glossar & Abkürzungen extrahieren: zwei Erweiterungen.
// (1) Neue "Synonym-Kandidaten" ("Suche weitere Synonyme") - dieselbe
// Stichwort-Extraktion wie die bestehenden Label-Kandidaten, aber gegen das
// Synonyme-Register (app.synonyms) abgeglichen statt gegen Labels; "In
// Synonyme übernehmen" legt den Begriff als neuen Hauptbegriff an. (2) Die
// bereits bestehenden Abkürzungs-Vorschläge (suggestedDe/suggestedEn)
// bekommen einen "In Abkürzungs-Übersetzungen übernehmen"-Button, der sie
// fest im Register Abkürzungen -> Manuell gepflegte Übersetzungen speichert
// (neue Spalte "Bedeutung (Deutsch)").
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
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// "Vertragsanhang" kommt 3x vor (Mindestschwelle) und ist weder Label noch
// Synonym - erwarteter Synonym-Kandidat. "API" ist ein bekanntes Kürzel mit
// Vorschlag (s. ABBREV_MEANING_SUGGESTIONS).
const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>SYN-1</key><summary>Vertragsanhang pruefen</summary><description>Der Vertragsanhang wird automatisch erzeugt.</description><status>Offen</status><type>Task</type></item>
  <item><key>SYN-2</key><summary>Vertragsanhang aktualisieren</summary><description>Nach Aenderung wird der Vertragsanhang neu erstellt.</description><status>Offen</status><type>Task</type></item>
  <item><key>SYN-3</key><summary>Vertragsanhang archivieren</summary><description>Alte Vertragsanhang-Versionen werden archiviert.</description><status>Offen</status><type>Task</type></item>
  <item><key>SYN-4</key><summary>API Anbindung</summary><description>Die REST API liefert Daten.</description><status>Offen</status><type>Task</type></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "synabbr.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);

  // ===================== (1) Synonym-Kandidaten =====================
  check("'Synonym-Kandidaten'-Bereich vorhanden", !!doc.getElementById("synonym-candidate-table"));
  const synCount = parseInt(doc.getElementById("synonym-candidate-count").textContent, 10);
  check("Mindestens 1 Synonym-Kandidat gefunden", synCount >= 1);
  function synCandidateRow(term) {
    return Array.from(doc.querySelectorAll("#synonym-candidate-tbody tr")).find((tr) => tr.children[0].textContent === term);
  }
  const vaRow = synCandidateRow("Vertragsanhang");
  check("'Vertragsanhang' (3x vorkommend) als Synonym-Kandidat erkannt", !!vaRow);
  if (vaRow) {
    check("Zeigt Ticketanzahl 3", vaRow.children[1].textContent.trim() === "3");
    const addBtn = vaRow.querySelector(".synonym-candidate-add-btn");
    check("'In Synonyme übernehmen'-Button vorhanden", !!addBtn);
    fire(addBtn, "click");
    await wait(30);
  }
  check("'Vertragsanhang' verschwindet aus der Kandidatenliste nach Übernahme", !synCandidateRow("Vertragsanhang"));
  // Nicht fixierte Zeilen rendern "term" als <input value="..."> - der Wert
  // landet nicht in textContent, daher hier innerHTML pruefen (wie bei den
  // bestehenden Terminologie-Tests, s. terminology_translations_test.js).
  check("'Vertragsanhang' jetzt im Synonyme-Register (Hauptbegriff)",
    doc.getElementById("synonyms-tbody").innerHTML.includes("Vertragsanhang"));
  doc.querySelector('.nav-item[data-view="synonyme"]').click();
  await wait(50);
  check("Synonyme-Register (eigene Ansicht) zeigt 'Vertragsanhang' ebenfalls", doc.getElementById("synonyms-tbody").innerHTML.includes("Vertragsanhang"));

  // Erneute Übernahme desselben Begriffs (z. B. nach erneuter Extraktion)
  // darf keinen Duplikat-Eintrag erzeugen.
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);
  check("Nach erneuter Extraktion: 'Vertragsanhang' erscheint NICHT erneut als Kandidat (bereits im Register)",
    !synCandidateRow("Vertragsanhang"));

  // ===================== (2) Abkürzungen: Vorschlag übernehmen =====================
  function abbrevRow(term) {
    return Array.from(doc.querySelectorAll("#abbrev-tbody tr")).find((tr) => tr.children[0].textContent === term);
  }
  const apiRow = abbrevRow("API");
  check("Zeile für 'API' mit Vorschlag vorhanden", !!apiRow);
  const apiAddBtn = apiRow && apiRow.querySelector(".abbrev-suggestion-add-btn");
  check("'In Abkürzungs-Übersetzungen übernehmen'-Button für 'API' vorhanden", !!apiAddBtn);
  fire(apiAddBtn, "click");
  await wait(30);

  doc.querySelector('.nav-item[data-view="abkuerzungen"]').click();
  await wait(50);
  function abbrevTranslationRow(term) {
    // Nicht fixierte Zeilen rendern "term" als <input value="..."> - der
    // Wert landet nicht in textContent, daher per innerHTML suchen.
    return Array.from(doc.querySelectorAll("#abbrev-translations-tbody tr")).find((tr) => tr.innerHTML.includes('value="' + term));
  }
  const apiTransRow = abbrevTranslationRow("API");
  check("'API' jetzt im Register 'Manuell gepflegte Übersetzungen'", !!apiTransRow);
  if (apiTransRow) {
    check("Spalte 'Bedeutung (Deutsch)' zeigt 'Programmierschnittstelle'", apiTransRow.innerHTML.includes("Programmierschnittstelle"));
    check("Spalte 'Englisch' zeigt 'Application Programming Interface'", apiTransRow.innerHTML.includes("Application Programming Interface"));
  }
  check("Tabellenkopf nennt jetzt 'Bedeutung (Deutsch)'", doc.querySelector("#abbrev-translations-table thead").textContent.includes("Bedeutung (Deutsch)"));

  // Erneutes Klicken auf "Übernehmen" nach Fixieren darf den fixierten
  // Eintrag nicht überschreiben.
  const fixBtn = apiTransRow.querySelector('[data-action="fix"]');
  fire(fixBtn, "click");
  await wait(30);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  await wait(50);
  const apiRowAgain = abbrevRow("API");
  fire(apiRowAgain.querySelector(".abbrev-suggestion-add-btn"), "click");
  await wait(30);
  check("Toast/Hinweis bei bereits fixiertem Eintrag statt stillem Überschreiben",
    doc.getElementById("toast").textContent.includes("fixiert"));

  // ===================== Manuelles Anlegen funktioniert weiterhin (neues "de"-Feld optional) =====================
  doc.querySelector('.nav-item[data-view="abkuerzungen"]').click();
  await wait(50);
  const newTermInput = doc.getElementById("abbrev-translations-new-term");
  const newDeInput = doc.getElementById("abbrev-translations-new-de");
  const newEnInput = doc.getElementById("abbrev-translations-new-en");
  newTermInput.value = "VIN";
  newDeInput.value = "Fahrgestellnummer";
  newEnInput.value = "Vehicle Identification Number";
  fire(doc.getElementById("abbrev-translations-add-btn"), "click");
  await wait(30);
  const vinRow = abbrevTranslationRow("VIN");
  check("Manuell angelegter Eintrag 'VIN' mit Bedeutung (Deutsch) vorhanden", !!vinRow && vinRow.innerHTML.includes("Fahrgestellnummer"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE SYNONYM-/ABKUERZUNGS-KANDIDATEN-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
