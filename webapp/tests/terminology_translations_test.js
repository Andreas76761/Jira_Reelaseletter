// Terminologie: neues Register "Synonyme" + manuell gepflegte
// Übersetzungstabellen in "Glossar" und "Abkürzungen" (app.synonyms/
// app.glossaryTranslations/app.abbrevTranslations). Je Eintrag ein
// deutscher Begriff (bei Synonymen zusätzlich alternative Begriffe) mit
// Übersetzung in Englisch/Slowakisch/Hindi/Französisch sowie ein
// "Fixiert"-Status (sperrt die Felder gegen versehentliches Ändern, über
// "Entsperren" wieder editierbar). Alle drei Listen teilen sich dieselbe
// generische Render-/Event-Logik (TERMINOLOGY_LISTS). `app` ist eine
// lokale Variable innerhalb der App-IIFE (nicht auf `window` sichtbar,
// wie überall in dieser App) - der Zustand wird daher ausschließlich über
// das DOM bzw. den JSON-Export von "Sitzung speichern" geprüft.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function setValue(el, v) { el.value = v; fire(el, "input"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Ein Ticket importieren, damit "Sitzung speichern" (weiter unten) nicht
  // mit "Nichts zu exportieren" abbricht (der Export-Button setzt mind.
  // ein geladenes Ticket/einen Import voraus).
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>TERM-1</key><summary>Terminologie-Test-Ticket</summary>
      <description>Dient nur dem Terminologie-Test.</description>
      <status>Fertig</status><type>Feature</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const fileInput = doc.getElementById("file-input");
  Object.defineProperty(fileInput, "files", { value: [new win.File([xml], "terminology_test.xml", { type: "application/xml" })], configurable: true });
  fire(fileInput, "change");
  await wait(400);

  // ===================== Nav "Synonyme" =====================
  const synonymeNav = doc.querySelector('.nav-item[data-view="synonyme"]');
  check("Nav-Punkt 'Synonyme' vorhanden", !!synonymeNav);
  fire(synonymeNav, "click");
  await wait(50);
  check("Synonyme-Panel sichtbar", doc.querySelector('[data-view-panel="synonyme"]').hidden === false);
  check("Synonyme-Panel zunächst leer (Hinweistext sichtbar)", doc.getElementById("synonyms-empty").hidden === false);

  // ===================== Synonyme: Validierung =====================
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Ohne Begriff: kein Eintrag angelegt", doc.querySelectorAll("#synonyms-tbody tr").length === 0);

  setValue(doc.getElementById("synonyms-new-term"), "Vertrag");
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Ohne jede Übersetzung: kein Eintrag angelegt", doc.querySelectorAll("#synonyms-tbody tr").length === 0);

  // ===================== Synonyme: Eintrag anlegen =====================
  setValue(doc.getElementById("synonyms-new-synonyms"), "Kontrakt, Abschluss");
  setValue(doc.getElementById("synonyms-new-en"), "contract");
  setValue(doc.getElementById("synonyms-new-sk"), "zmluva");
  setValue(doc.getElementById("synonyms-new-hi"), "अनुबंध");
  setValue(doc.getElementById("synonyms-new-fr"), "contrat");
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Eintrag 'Vertrag' angelegt", doc.querySelectorAll("#synonyms-tbody tr").length === 1);
  check("Hinweistext nach erstem Eintrag verborgen", doc.getElementById("synonyms-empty").hidden === true);
  let rowHtml = doc.getElementById("synonyms-tbody").innerHTML;
  check("Zeile enthält 'Kontrakt, Abschluss'", rowHtml.includes("Kontrakt, Abschluss"));
  check("Zeile enthält Englisch 'contract'", rowHtml.includes("contract"));
  check("Zeile enthält Slowakisch 'zmluva'", rowHtml.includes("zmluva"));
  check("Zeile enthält Hindi 'अनुबंध'", rowHtml.includes("अनुबंध"));
  check("Zeile enthält Französisch 'contrat'", rowHtml.includes("contrat"));
  check("Eingabefelder nach Hinzufügen geleert", doc.getElementById("synonyms-new-term").value === "");

  // ===================== Synonyme: Duplikat abgewiesen =====================
  setValue(doc.getElementById("synonyms-new-term"), "Vertrag");
  setValue(doc.getElementById("synonyms-new-en"), "agreement");
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Duplikat 'Vertrag' nicht erneut angelegt", doc.querySelectorAll("#synonyms-tbody tr").length === 1);

  // ===================== Synonyme: Inline-Bearbeitung =====================
  let enInput = doc.querySelector('#synonyms-tbody input[data-field="en"]');
  setValue(enInput, "agreement");
  fire(enInput, "change");
  await wait(20);
  // Zweiten Eintrag anlegen (loest renderTerminologyList() aus) - bestaetigt,
  // dass die Inline-Aenderung tatsaechlich im Zustand uebernommen wurde und
  // nicht nur im (gleich neu aufgebauten) DOM-Element stehen blieb.
  setValue(doc.getElementById("synonyms-new-term"), "Zweiter Begriff");
  setValue(doc.getElementById("synonyms-new-en"), "second term");
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Inline-Änderung 'agreement' bleibt nach Neu-Rendern erhalten", doc.getElementById("synonyms-tbody").innerHTML.includes("agreement"));
  check("Zweiter Eintrag zusätzlich vorhanden (2 Zeilen)", doc.querySelectorAll("#synonyms-tbody tr").length === 2);

  // Zweiten Eintrag wieder entfernen, um mit genau 1 Eintrag weiterzumachen.
  // (Nicht-fixierte Zeilen rendern den Begriff als <input value="...">, der
  // Wert zaehlt nicht zu textContent - daher ueber das Eingabefeld suchen.)
  const secondTermInput = Array.from(doc.querySelectorAll('#synonyms-tbody input[data-field="term"]')).find((i) => i.value === "Zweiter Begriff");
  const secondRow = secondTermInput.closest("tr");
  fire(secondRow.querySelector('button[data-action="delete"]'), "click");
  await wait(20);
  check("Nach Entfernen des zweiten Eintrags: wieder 1 Zeile", doc.querySelectorAll("#synonyms-tbody tr").length === 1);

  // ===================== Synonyme: Fixieren/Entsperren =====================
  let fixBtn = doc.querySelector('#synonyms-tbody button[data-action="fix"]');
  fire(fixBtn, "click");
  await wait(20);
  rowHtml = doc.getElementById("synonyms-tbody").innerHTML;
  check("Nach Fixieren: 'Fixiert'-Badge sichtbar", rowHtml.includes("Fixiert"));
  check("Nach Fixieren: kein editierbares Eingabefeld mehr in der Zeile", !doc.querySelector('#synonyms-tbody input[data-field="en"]'));
  check("Nach Fixieren: Begriff weiterhin als Text sichtbar", rowHtml.includes("Vertrag"));
  check("Nach Fixieren: 'Entsperren'-Button vorhanden", !!doc.querySelector('#synonyms-tbody button[data-action="unfix"]'));

  const unfixBtn = doc.querySelector('#synonyms-tbody button[data-action="unfix"]');
  fire(unfixBtn, "click");
  await wait(20);
  check("Nach Entsperren: Eingabefeld wieder vorhanden", !!doc.querySelector('#synonyms-tbody input[data-field="en"]'));
  check("Nach Entsperren: 'Fixieren'-Button wieder vorhanden", !!doc.querySelector('#synonyms-tbody button[data-action="fix"]'));

  // ===================== Synonyme: Löschen =====================
  const delBtn = doc.querySelector('#synonyms-tbody button[data-action="delete"]');
  fire(delBtn, "click");
  await wait(20);
  check("Nach Löschen: keine Zeile mehr vorhanden", doc.querySelectorAll("#synonyms-tbody tr").length === 0);
  check("Nach Löschen: Hinweistext wieder sichtbar", doc.getElementById("synonyms-empty").hidden === false);

  // ===================== Glossar: manuell gepflegte Übersetzungen =====================
  fire(doc.querySelector('.nav-item[data-view="glossar"]'), "click");
  await wait(50);
  check("Glossar: Abschnitt 'Manuell gepflegte Übersetzungen' vorhanden", !!doc.getElementById("glossary-translations-tbody"));
  check("Glossar: statische Begriffstabelle weiterhin vorhanden (unverändert)", doc.body.textContent.includes("Pseudonymisierung"));
  setValue(doc.getElementById("glossary-translations-new-term"), "Rohgerüst");
  setValue(doc.getElementById("glossary-translations-new-en"), "draft skeleton");
  fire(doc.getElementById("glossary-translations-add-btn"), "click");
  await wait(20);
  check("Glossar-Übersetzung 'Rohgerüst' angelegt", doc.querySelectorAll("#glossary-translations-tbody tr").length === 1);
  check("Glossar-Übersetzung enthält 'draft skeleton'", doc.getElementById("glossary-translations-tbody").innerHTML.includes("draft skeleton"));
  fire(doc.querySelector('#glossary-translations-tbody button[data-action="fix"]'), "click");
  await wait(20);
  check("Glossar-Übersetzung nach Fixieren zeigt Badge", doc.getElementById("glossary-translations-tbody").innerHTML.includes("Fixiert"));
  fire(doc.querySelector('#glossary-translations-tbody button[data-action="unfix"]'), "click");
  await wait(20);
  fire(doc.querySelector('#glossary-translations-tbody button[data-action="delete"]'), "click");
  await wait(20);
  check("Glossar-Übersetzung gelöscht", doc.querySelectorAll("#glossary-translations-tbody tr").length === 0);

  // ===================== Abkürzungen: manuell gepflegte Übersetzungen =====================
  fire(doc.querySelector('.nav-item[data-view="abkuerzungen"]'), "click");
  await wait(50);
  check("Abkürzungen: Abschnitt 'Manuell gepflegte Übersetzungen' vorhanden", !!doc.getElementById("abbrev-translations-tbody"));
  setValue(doc.getElementById("abbrev-translations-new-term"), "VIN");
  setValue(doc.getElementById("abbrev-translations-new-en"), "VIN (Vehicle Identification Number)");
  setValue(doc.getElementById("abbrev-translations-new-fr"), "NIV (numéro d'identification du véhicule)");
  fire(doc.getElementById("abbrev-translations-add-btn"), "click");
  await wait(20);
  check("Abkürzungs-Übersetzung 'VIN' angelegt", doc.querySelectorAll("#abbrev-translations-tbody tr").length === 1);
  check("Abkürzungs-Übersetzung enthält französische Übersetzung", doc.getElementById("abbrev-translations-tbody").innerHTML.includes("numéro d'identification"));

  // ===================== "Alle Daten löschen" lässt Terminologie-Listen unverändert =====================
  // Neuen Synonyme-Eintrag anlegen, damit alle 3 Listen beim Löschen mind. 1 Eintrag haben.
  fire(doc.querySelector('.nav-item[data-view="synonyme"]'), "click");
  await wait(50);
  setValue(doc.getElementById("synonyms-new-term"), "Freigabe");
  setValue(doc.getElementById("synonyms-new-en"), "approval");
  fire(doc.getElementById("synonyms-add-btn"), "click");
  await wait(20);
  check("Vor Reset: Synonyme-Panel zeigt 1 Zeile", doc.querySelectorAll("#synonyms-tbody tr").length === 1);

  fire(doc.querySelector('.nav-item[data-view="einstellungen"]'), "click");
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  fire(doc.querySelector('.nav-item[data-view="synonyme"]'), "click");
  await wait(50);
  check("Nach 'Alle Daten löschen': Synonyme bleiben erhalten (Konfiguration, kein Sitzungsdatensatz)",
    doc.querySelectorAll("#synonyms-tbody tr").length === 1 && doc.getElementById("synonyms-tbody").innerHTML.includes("Freigabe"));
  fire(doc.querySelector('.nav-item[data-view="abkuerzungen"]'), "click");
  await wait(50);
  check("Nach 'Alle Daten löschen': Abkürzungs-Übersetzungen bleiben erhalten",
    doc.querySelectorAll("#abbrev-translations-tbody tr").length === 1);

  // "Alle Daten löschen" leert auch Tickets/Importe - erneut importieren,
  // damit der Export-Button unten nicht mit "Nichts zu exportieren" abbricht.
  doc.querySelector('.nav-item[data-view="import"]').click();
  const fileInput2 = doc.getElementById("file-input");
  Object.defineProperty(fileInput2, "files", { value: [new win.File([xml], "terminology_test2.xml", { type: "application/xml" })], configurable: true });
  fire(fileInput2, "change");
  await wait(400);

  // ===================== Sitzung speichern/laden sichert alle 3 Listen =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("Export enthält 'synonyms' mit 1 Eintrag", Array.isArray(exportedJson.synonyms) && exportedJson.synonyms.length === 1 && exportedJson.synonyms[0].term === "Freigabe");
  check("Export enthält 'glossaryTranslations' (leer, da zuvor gelöscht)", Array.isArray(exportedJson.glossaryTranslations) && exportedJson.glossaryTranslations.length === 0);
  check("Export enthält 'abbrevTranslations' mit 1 Eintrag", Array.isArray(exportedJson.abbrevTranslations) && exportedJson.abbrevTranslations.length === 1 && exportedJson.abbrevTranslations[0].term === "VIN");

  // Vorhandene Einträge über die UI entfernen, um den Import eindeutig nachweisen zu können.
  fire(doc.querySelector('.nav-item[data-view="synonyme"]'), "click");
  await wait(50);
  fire(doc.querySelector('#synonyms-tbody button[data-action="delete"]'), "click");
  await wait(20);
  check("Vor Import: Synonyme-Panel wieder leer", doc.querySelectorAll("#synonyms-tbody tr").length === 0);

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await confirmViaModal(doc);
  await wait(300);
  fire(doc.querySelector('.nav-item[data-view="synonyme"]'), "click");
  await wait(50);
  check("Nach Import: Synonyme-Eintrag 'Freigabe' wiederhergestellt",
    doc.querySelectorAll("#synonyms-tbody tr").length === 1 && doc.getElementById("synonyms-tbody").innerHTML.includes("Freigabe"));
  fire(doc.querySelector('.nav-item[data-view="abkuerzungen"]'), "click");
  await wait(50);
  check("Nach Import: Abkürzungs-Übersetzung 'VIN' wiederhergestellt",
    doc.querySelectorAll("#abbrev-translations-tbody tr").length === 1 && doc.getElementById("abbrev-translations-tbody").innerHTML.includes("VIN"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TERMINOLOGIE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
