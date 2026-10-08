// Stammdaten-Label-Erweiterung beim Einlesen (Jira-Einzelticket + Massenupload):
// je Ticket werden zusätzliche Labels gespeichert - Status/Typ/Domäne/
// Anlagemonat+Jahr (deterministisch aus Ticket-Feldern) sowie Sparte (Pkw/
// Van/Markt)/Rolle (Retail/Markt/MO/HQ)/Sonderthemen (Reifen/Reporting/
// Testing/Schnittstellen/Templates/Migration/Rollout) als neue, inhaltsbasiert
// erkannte Kategorien in den bestehenden Labels-Stammdaten (Einstellungen ->
// Labels) - erscheinen automatisch im Dashboard-Label-Filter/der Suche, ohne
// eigene UI. Sparte-/Rollen-Filter (Verarbeitung/Massenverarbeitung) erkennen
// diese Werte jetzt zusätzlich inhaltsbasiert, nicht mehr nur aus wörtlichen
// Jira-Labels. "Suche weitere Labels" (Verarbeitung -> 3) schlägt zusätzlich
// wiederkehrende, noch nicht erfasste Begriffe als Label-Kandidaten vor, die
// der Nutzer per Klick dauerhaft in die Stammdaten übernehmen kann.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
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

// SD-2 ohne woertliches Label, aber mit "Van" im Freitext (Fallback-Erkennung).
// SD-3 ohne woertliches Label, mit "Reifen"+"Reporting" im Freitext (Sonderthemen).
// SD-4/5/6 teilen den wiederkehrenden, noch unbekannten Begriff "Flottenkarte".
const xmlMassenupload = `<?xml version="1.0"?><rss><channel>
  <item><key>SD-1</key><summary>Pkw Ticket mit woertlichem Label</summary><description>Standardfall.</description><status>Erledigt</status><type>Epic</type>
    <labels><label>Pkw</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields>
    <created>15/Mar/24 10:00 AM</created></item>
  <item><key>SD-2</key><summary>Van-relevante Anpassung</summary><description>Die Van-Flotte benoetigt ein neues Vorgehen.</description><status>Offen</status><type>Bug</type></item>
  <item><key>SD-3</key><summary>Reifenwechsel-Prozess</summary><description>Reporting zu Reifen wird ergaenzt.</description><status>Offen</status><type>Task</type></item>
  <item><key>SD-4</key><summary>Flottenkarte beantragen</summary><description>Antrag fuer eine neue Flottenkarte.</description><status>Offen</status><type>Task</type></item>
  <item><key>SD-5</key><summary>Flottenkarte sperren</summary><description>Flottenkarte wurde verloren.</description><status>Offen</status><type>Task</type></item>
  <item><key>SD-6</key><summary>Flottenkarte abrechnen</summary><description>Monatliche Abrechnung der Flottenkarte.</description><status>Offen</status><type>Task</type></item>
  <item><key>SD-7</key><summary>Monitoring der Systemverfuegbarkeit</summary><description>Diese Anpassung ist relevant fuer alle Nutzer, ohne Bezug zu Fahrzeugen oder Rollen.</description><status>Offen</status><type>Task</type></item>
  <item><key>SD-8</key><summary>Allgemeine Wartungsarbeit</summary><description>Routinecheck ohne inhaltlichen Bezug.</description><status>Offen</status><type>Task</type>
    <labels><label>Testing</label></labels></item>
</channel></rss>`;


(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Vorbereitung =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== (1) Massenupload: 6 Tickets =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlMassenupload], "stammdaten.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("(1) 8 Tickets aus Massenupload geladen", doc.getElementById("stat-tickets").textContent === "8");

  // ===================== (2) Jira-Einzelticket-Import: dasselbe Verfahren greift auch hier =====================
  // Nutzt denselben ingestTickets()/refreshDashboard()-Pfad wie Massenupload,
  // daher reicht hier der Nachweis, dass Status/Typ als Stammdaten-Label
  // ebenfalls ankommen (Sparte-/Rollen-/Sonderthemen-Fallback ist bereits
  // ueber die Massenupload-Tickets oben nachgewiesen, derselbe Code).
  doc.querySelector('.import-tab[data-mode="einzelticket"]').click();
  const singleInput = doc.getElementById("file-input");
  const singleHtml = fs.readFileSync(path.join(FIXTURES, "single_ticket_sample.html"), "utf-8");
  Object.defineProperty(singleInput, "files", { value: [new win.File([singleHtml], "ONESCM-50123.html", { type: "text/html" })], configurable: true });
  fire(singleInput, "change");
  await wait(400);
  check("(2) 9 Tickets nach Einzelticket-Import", doc.getElementById("stat-tickets").textContent === "9");

  // ===================== (3) Einstellungen -> Labels: neue Stammdaten-Kategorien vorhanden =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const labelRows = () => Array.from(doc.querySelectorAll("#labels-tbody tr"));
  check("(3) Kategorie 'Sparte' mit 'Pkw' vorhanden", labelRows().some((r) => r.textContent.includes("Sparte") && r.textContent.includes("Pkw")));
  check("(3) Kategorie 'Rolle' mit 'HQ' vorhanden", labelRows().some((r) => r.textContent.includes("Rolle") && r.textContent.includes("HQ")));
  check("(3) Kategorie 'Sonderthemen' mit 'Reifen' vorhanden", labelRows().some((r) => r.textContent.includes("Sonderthemen") && r.textContent.includes("Reifen")));

  // ===================== (4) Job 4 (Verarbeitung): Stammdaten-Labels je Ticket sichtbar =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(50);
  function rowFor(key) { return Array.from(doc.querySelectorAll("#releaseversion-tbody tr")).find((tr) => tr.textContent.includes(key)); }

  const sd1 = rowFor("SD-1");
  check("(4) SD-1: woertliches Label 'Pkw' weiterhin als Sparte-Label sichtbar", !!sd1 && sd1.children[6].textContent.includes("Pkw"));
  check("(4) SD-1: Status 'Erledigt' als Stammdaten-Label sichtbar", !!sd1 && sd1.children[6].textContent.includes("Erledigt"));
  check("(4) SD-1: Typ 'Epic' als Stammdaten-Label sichtbar", !!sd1 && sd1.children[6].textContent.includes("Epic"));
  check("(4) SD-1: Domäne 'Contract Management' als Stammdaten-Label sichtbar", !!sd1 && sd1.children[6].textContent.includes("Contract Management"));
  check("(4) SD-1: Anlagemonat 'März 2024' als Stammdaten-Label sichtbar", !!sd1 && sd1.children[6].textContent.includes("März 2024"));

  const sd2 = rowFor("SD-2");
  check("(4) SD-2: 'Van' OHNE wörtliches Jira-Label, nur über Freitext erkannt (Sparte-Fallback)", !!sd2 && sd2.children[6].textContent.includes("Van"));

  const sd3 = rowFor("SD-3");
  check("(4) SD-3: Sonderthema 'Reifen' aus Freitext erkannt", !!sd3 && sd3.children[6].textContent.includes("Reifen"));
  check("(4) SD-3: Sonderthema 'Reporting' aus Freitext erkannt", !!sd3 && sd3.children[6].textContent.includes("Reporting"));

  const onescm = rowFor("ONESCM-50123");
  check("(4) ONESCM-50123 (Einzelticket-Import): Typ 'Bug' als Stammdaten-Label sichtbar", !!onescm && onescm.children[6].textContent.includes("Bug"));
  check("(4) ONESCM-50123 (Einzelticket-Import): Status 'In Bearbeitung' als Stammdaten-Label sichtbar", !!onescm && onescm.children[6].textContent.includes("In Bearbeitung"));

  // Regression: kurze Begriffe ("MO"/"Van", s. labelSeedData() Rolle/Sparte)
  // duerfen NICHT als Substring in unverwandten Woertern treffen (SD-7 enthaelt
  // "Monitoring" und "relevant", beide mit "mo"/"van" als Teilstring, aber
  // ohne inhaltlichen Bezug zu Rolle MO oder Sparte Van).
  const sd7 = rowFor("SD-7");
  check("(4) SD-7: 'MO' NICHT faelschlich aus 'Monitoring' erkannt (Wortgrenzen-Fix)", !!sd7 && !sd7.children[6].textContent.split(/\s*,\s*/).includes("MO"));
  check("(4) SD-7: 'Van' NICHT faelschlich aus 'relevant' erkannt (Wortgrenzen-Fix)", !!sd7 && !sd7.children[6].textContent.split(/\s*,\s*/).includes("Van"));

  // Regression: woertliches Jira-Label fuer eine Sonderthemen-Kategorie muss
  // auch dann als Label erscheinen, wenn der Begriff im Freitext gar nicht
  // vorkommt (SD-8 hat das Label "Testing", aber keinen Text-Treffer).
  const sd8 = rowFor("SD-8");
  check("(4) SD-8: woertliches Jira-Label 'Testing' ohne Freitext-Treffer als Label sichtbar", !!sd8 && sd8.children[6].textContent.includes("Testing"));

  // ===================== (5) Dashboard-Label-Filter: neue Werte waehlbar =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const labelSelect = doc.getElementById("label-select");
  const labelOptionValues = Array.from(labelSelect.options).map((o) => o.value);
  check("(5) Dashboard-Label-Filter enthält 'Van' (inhaltsbasiert erkannt)", labelOptionValues.indexOf("Van") !== -1);
  labelSelect.value = "Van";
  fire(labelSelect, "change");
  await wait(50);
  const visibleKeys = Array.from(doc.querySelectorAll("#table-body tr td.key")).map((td) => td.textContent.trim());
  check("(5) Filter 'Van' zeigt genau SD-2", visibleKeys.length === 1 && visibleKeys[0] === "SD-2");
  labelSelect.value = "";
  fire(labelSelect, "change");
  await wait(50);

  // ===================== (6) Sparte-/Rollen-Filter (Verarbeitung) erkennt den Fallback ebenfalls =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(50);
  const toggleBtn = doc.querySelector("#steps-job-4 .step-toggle");
  fire(toggleBtn, "click");
  await wait(30);
  const vanSparteCb = doc.querySelector('#steps-job-4 input[name="active-scope-filter-4"][value="sparte:Van"]');
  check("(6) Sparte-Filter-Checkbox 'Van' vorhanden", !!vanSparteCb);
  vanSparteCb.checked = true;
  fire(vanSparteCb, "change");
  await wait(50);
  check("(6) Sparte-Filter 'Van' (inhaltsbasiert) liefert genau SD-2", doc.getElementById("releaseversion-total").textContent === "1" &&
    doc.getElementById("releaseversion-tbody").textContent.includes("SD-2"));
  vanSparteCb.checked = false;
  fire(vanSparteCb, "change");
  await wait(30);

  // ===================== (7) "Suche weitere Labels" (Job 3): Label-Kandidaten =====================
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  await wait(50);
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);
  const candidateTbodyText = doc.getElementById("label-candidate-tbody").textContent;
  check("(7) 'Flottenkarte' erscheint als Label-Kandidat (3 Tickets)", candidateTbodyText.includes("Flottenkarte"));
  check("(7) Bereits bekannte Begriffe (z.B. 'Pkw') erscheinen NICHT als Kandidat", !candidateTbodyText.includes("Pkw"));
  // Regression: der automatische Stammdaten-Wert "Offen" (Status, teilen sich
  // 7 der 9 Tickets) ist bereits bekannt und darf trotz der +2-Gewichtung in
  // glExtractKeywords() NICHT als "neuer" Kandidat erscheinen.
  check("(7) Stammdaten-Wert 'Offen' (Status) erscheint NICHT als Kandidat", !candidateTbodyText.includes("Offen"));

  const candidateRow = Array.from(doc.querySelectorAll("#label-candidate-tbody tr")).find((tr) => tr.textContent.includes("Flottenkarte"));
  check("(7) Kandidat zeigt Trefferanzahl 3", !!candidateRow && candidateRow.children[1].textContent.trim() === "3");
  const categorySelect = candidateRow.querySelector(".label-candidate-category-select");
  categorySelect.value = "Sonderthemen";
  const addBtn = candidateRow.querySelector(".label-candidate-add-btn");
  fire(addBtn, "click");
  await wait(50);
  check("(7) Nach Übernahme: 'Flottenkarte' verschwindet aus der Kandidatenliste", !doc.getElementById("label-candidate-tbody").textContent.includes("Flottenkarte"));

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  check("(7) 'Flottenkarte' jetzt dauerhaft in den Labels-Stammdaten (Kategorie Sonderthemen)",
    labelRows().some((r) => r.textContent.includes("Sonderthemen") && r.textContent.includes("Flottenkarte")));

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  await wait(50);
  const sd4 = rowFor("SD-4");
  check("(7) SD-4 zeigt das neu übernommene Label 'Flottenkarte' sofort (ohne Neuimport)", !!sd4 && sd4.children[6].textContent.includes("Flottenkarte"));

  // ===================== (8) Migration: Sitzungsdatei aus einer AELTEREN Version
  // (vor den Sparte/Rolle/Sonderthemen-Kategorien) laden - die neuen Kategorien
  // muessen automatisch ergaenzt werden, eine vom Nutzer selbst angelegte
  // eigene Kategorie bleibt dabei unverändert erhalten. =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  const oldSession = {
    sessionFileFormat: 1, savedAt: new Date().toISOString(), appVersion: "2.50.0",
    ticketStoreEntries: [], imports: [], changes: [], log: [],
    labels: [
      { category: "Fahrzeuge & Fahrzeugdaten", de: "Flotte", en: "Fleet" },
      { category: "Eigene Kategorie", de: "MeinBegriff", en: "MyTerm" }
    ]
  };
  const oldSessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(oldSessionInput, "files", {
    value: [new win.File([JSON.stringify(oldSession)], "alte-sitzung.json", { type: "application/json" })],
    configurable: true
  });
  fire(oldSessionInput, "change");
  await wait(200);
  check("(8) Alte Kategorie 'Fahrzeuge & Fahrzeugdaten'/'Flotte' bleibt erhalten", labelRows().some((r) => r.textContent.includes("Flotte")));
  check("(8) Eigene, nicht-Standard-Kategorie 'Eigene Kategorie' bleibt erhalten", labelRows().some((r) => r.textContent.includes("Eigene Kategorie") && r.textContent.includes("MeinBegriff")));
  check("(8) Fehlende Kategorie 'Sparte' wurde nachtraeglich ergaenzt (Migration)", labelRows().some((r) => r.textContent.includes("Sparte") && r.textContent.includes("Pkw")));
  check("(8) Fehlende Kategorie 'Rolle' wurde nachtraeglich ergaenzt (Migration)", labelRows().some((r) => r.textContent.includes("Rolle") && r.textContent.includes("HQ")));
  check("(8) Fehlende Kategorie 'Sonderthemen' wurde nachtraeglich ergaenzt (Migration)", labelRows().some((r) => r.textContent.includes("Sonderthemen") && r.textContent.includes("Reifen")));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE STAMMDATEN-LABEL-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
