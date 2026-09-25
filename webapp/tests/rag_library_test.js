// Regressionstest fuer die RAG-Bibliothek (Verarbeitung -> RAG, Punkte 3-5,
// NACH der eigentlichen Text-Generierung): (3) ein erzeugter Text kann
// bewusst in eine interne, sitzungsuebergreifend gesicherte Bibliothek
// uebernommen ODER aus einer zuvor heruntergeladenen Markdown-Datei/einem
// ZIP-Archiv wieder eingeladen werden, (4) jeder Eintrag bekommt eine
// editierbare Domäne-/Kapitel-Zuordnung, (5) alle Eintraege lassen sich zu
// einem editierbaren Gesamtdokument zusammenfuehren (sortiert nach Domäne,
// darunter nach Kapitel). Prueft zusaetzlich: importierter Freitext wird
// durch redactText() geleitet (PII-Schutz, Projektstandard) und
// app.ragLibrary/app.ragMergedDoc werden - anders als der eigentliche RAG-
// Ausgabebereich - ueber "Sitzung speichern/laden" gesichert.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Test-Zusammenfassung.", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = require("jszip");
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>LIB-1</key><summary>Servicevertrag anlegen Testfall</summary><description>Kurzbeschreibung für Batch A.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>LIB-2</key><summary>Zweiter Testfall</summary><description>Kurzbeschreibung für Batch B.</description><status>Fertig</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "ragliblib.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);

  // ===================== (0) Merge auf leerer Bibliothek zeigt Hinweis, kein Absturz =====================
  fire(doc.getElementById("rag-merge-btn"), "click");
  await wait(50);
  check("(0) Merge-Button auf leerer Bibliothek: Fehlerhinweis statt Absturz", doc.getElementById("toast").textContent.includes("Bibliothek leer"));
  check("(0) 'In Bibliothek speichern' zu Beginn deaktiviert (noch nichts generiert)", doc.getElementById("rag-library-save-btn").disabled === true);
  check("(0) Bibliothekstabelle zu Beginn leer/ausgeblendet", doc.getElementById("rag-library-empty").hidden === false);

  // ===================== (1) Erzeugten Text speichern (Punkt 3) =====================
  const domainSelect = doc.getElementById("rag-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  // Kapitel 7 ("Verträge im Alltag verwalten") ist das einzige Gliederungskapitel,
  // dessen domains-Liste "Contract Management" enthält (s. outlineSeedData) - nur
  // dieses erscheint fuer die importierten Tickets in der Kapitel-Auswahl.
  const chapterSelect = doc.getElementById("rag-outline-select");
  const chapterOpt = Array.from(chapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  if (chapterOpt) chapterOpt.selected = true;
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(100);
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  const done1 = await waitUntil(() => doc.getElementById("rag-download-btn").disabled === false, 3000);
  check("(1) Generierung abgeschlossen (Download-Button aktiv)", done1);
  check("(1) 'In Bibliothek speichern' nach Generierung aktiv", doc.getElementById("rag-library-save-btn").disabled === false);

  fire(doc.getElementById("rag-library-save-btn"), "click");
  await wait(50);
  check("(1) Nach Speichern: Bibliothekstabelle sichtbar", doc.getElementById("rag-library-table-wrap").hidden === false);
  let libRows = doc.querySelectorAll("#rag-library-tbody tr");
  check("(1) Genau 1 Eintrag in der Bibliothek", libRows.length === 1);
  check("(1) Eintrag zeigt Quelle 'Generiert'", libRows[0] && libRows[0].textContent.includes("Generiert"));
  const firstDomainSel = doc.querySelector(".rag-library-domain-select");
  const firstChapterSel = doc.querySelector(".rag-library-chapter-select");
  check("(1) Domäne aus der RAG-Auswahl vorbelegt (genau eine Domäne gewählt)", firstDomainSel && firstDomainSel.value === "Contract Management");
  check("(1) Kapitel aus der RAG-Auswahl vorbelegt (genau ein Kapitel gewählt)", firstChapterSel && firstChapterSel.value.includes("Kapitel 7"));
  check("(1) Toast bestätigt Speichern in Bibliothek", doc.getElementById("toast").textContent.includes("Bibliothek"));

  // ===================== (2) Datei-Import: einzelne .md-Datei mit PII (Punkt 3 + Redaktion) =====================
  const mdWithPii = "# Importierter Test\n\nBitte Kontakt: max.mustermann@example.com aufnehmen.";
  const mdFile = new win.File([mdWithPii], "Import-Schnipsel.md", { type: "text/markdown" });
  const importInput = doc.getElementById("rag-library-import-input");
  Object.defineProperty(importInput, "files", { value: [mdFile], configurable: true });
  fire(importInput, "change");
  const done2 = await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === 2, 2000);
  check("(2) Nach .md-Import: 2 Einträge in der Bibliothek", done2);
  libRows = doc.querySelectorAll("#rag-library-tbody tr");
  check("(2) Neuer Eintrag zeigt Dateinamen als Bezeichnung", libRows[1] && libRows[1].textContent.includes("Import-Schnipsel.md"));
  check("(2) Neuer Eintrag zeigt Quelle 'Importiert'", libRows[1] && libRows[1].textContent.includes("Importiert"));
  check("(2) Neuer Eintrag ohne Domäne/Kapitel-Vorbelegung (unbekannt bei Import)", doc.querySelectorAll(".rag-library-domain-select")[1].value === "");

  // ===================== (3) Datei-Import: .zip mit 2 .md-Dateien =====================
  const JSZipLib = require("jszip");
  const zip = new JSZipLib();
  zip.file("Teil-A.md", "# Teil A\n\nFließtext für Teil A.");
  zip.file("Teil-B.md", "# Teil B\n\nFließtext für Teil B.");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  const zipFile = new win.File([zipBuf], "Archiv.zip", { type: "application/zip" });
  Object.defineProperty(importInput, "files", { value: [zipFile], configurable: true });
  fire(importInput, "change");
  const done3 = await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === 4, 2000);
  check("(3) Nach ZIP-Import (2 .md-Dateien): 4 Einträge insgesamt", done3);
  check("(3) Importhinweis nennt Anzahl importierter Dateien", doc.getElementById("rag-library-import-note").textContent.includes("2"));

  // ===================== (4) Domäne/Kapitel für importierte Einträge zuordnen (Punkt 4) =====================
  const domainSelects = doc.querySelectorAll(".rag-library-domain-select");
  const chapterSelects = doc.querySelectorAll(".rag-library-chapter-select");
  // Eintrag 2 ("Import-Schnipsel.md"): eigene Domäne + Kapitel 4 (die
  // Kapitel-Dropdowns der Bibliothek sind NICHT auf "in der Ticket-Auswahl
  // vorkommende" Kapitel beschränkt wie rag-outline-select, sondern zeigen
  // die volle Gliederung app.outline - freie Zuordnung).
  domainSelects[1].value = "Contract Management";
  fire(domainSelects[1], "change");
  const kap4Option = Array.from(chapterSelects[1].options).find((o) => o.value.includes("Kapitel 4"));
  chapterSelects[1].value = kap4Option.value;
  fire(chapterSelects[1], "change");
  await wait(30);
  check("(4) Zuordnung eines Eintrags aktualisiert sofort (kein extra Speichern-Klick nötig)",
    doc.querySelectorAll(".rag-library-domain-select")[1].value === "Contract Management");

  // ===================== (5) Löschen eines Eintrags =====================
  // Löscht den ersten Eintrag (generierte Zusammenfassung, Kapitel 7) - die
  // verbleibenden 3 sind: Import-Schnipsel.md (Contract Management/Kapitel 4),
  // Teil-A.md + Teil-B.md (beide ohne Zuordnung).
  const delBtnFirst = doc.querySelector(".rag-library-delete-btn");
  fire(delBtnFirst, "click");
  await confirmViaModal(doc);
  check("(5) Nach Löschen: 3 Einträge verbleiben", doc.querySelectorAll("#rag-library-tbody tr").length === 3);

  // ===================== (6) Zusammenführen (Punkt 5): Gruppierung nach Domäne/Kapitel =====================
  fire(doc.getElementById("rag-merge-btn"), "click");
  await wait(50);
  const mergedValue = doc.getElementById("rag-merge-output").value;
  check("(6) Gesamtdokument enthält Domänen-Überschrift für zugeordneten Eintrag", mergedValue.includes("## Domäne: Contract Management"));
  check("(6) Gesamtdokument enthält Kapitel-Überschrift 'Kapitel 4' für zugeordneten Eintrag", /### Kapitel: Kapitel 4/.test(mergedValue));
  check("(6) Gesamtdokument gruppiert nicht zugeordnete Einträge unter 'Nicht zugeordnet'", mergedValue.includes("### Kapitel: Nicht zugeordnet"));
  check("(6) Importierter Text mit PII wurde redigiert (keine echte E-Mail-Adresse im Gesamtdokument)", !mergedValue.includes("max.mustermann@example.com"));
  check("(6) Redaktionsplatzhalter statt E-Mail vorhanden", mergedValue.includes("[E-Mail entfernt]"));
  check("(6) Download-Button nach Zusammenführen aktiv", doc.getElementById("rag-merge-download-btn").disabled === false);
  check("(6) Statuszeile nennt Anzahl zusammengeführter Textschnipsel", doc.getElementById("rag-merge-status-note").textContent.includes("3"));

  // ===================== (7) Gesamtdokument manuell bearbeiten + herunterladen =====================
  const mergeTa = doc.getElementById("rag-merge-output");
  mergeTa.value = mergedValue + "\n\nManuell ergänzter Absatz.";
  fire(mergeTa, "input");
  await wait(30);
  const savedBefore = savedFiles.length;
  fire(doc.getElementById("rag-merge-download-btn"), "click");
  await wait(100);
  check("(7) Herunterladen des (bearbeiteten) Gesamtdokuments ausgelöst", savedFiles.length === savedBefore + 1);
  check("(7) Heruntergeladene Datei enthält die manuelle Ergänzung", savedFiles[savedFiles.length - 1].data.includes("Manuell ergänzter Absatz."));

  // ===================== (8) Prozessschritte (7. RAG) spiegeln den Bibliothek-Fortschritt =====================
  const stepsText = doc.getElementById("steps-job-7").textContent;
  check("(8) Prozessschritte nennen 'In Bibliothek gespeichert / aus Datei importiert'", stepsText.includes("In Bibliothek gespeichert"));
  check("(8) Prozessschritte nennen Zusammenführung als erledigt", stepsText.includes("Alle Textschnipsel zu einem Gesamtdokument zusammengeführt"));

  // ===================== (9) Sitzung speichern/laden sichert Bibliothek + Gesamtdokument =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(9) Export enthält ragLibrary mit 3 Einträgen", Array.isArray(exportedJson.ragLibrary) && exportedJson.ragLibrary.length === 3);
  check("(9) Export enthält das bearbeitete Gesamtdokument", typeof exportedJson.ragMergedDoc === "string" && exportedJson.ragMergedDoc.includes("Manuell ergänzter Absatz."));

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("(9) Nach 'Alle Daten löschen': Bibliothek geleert", doc.querySelectorAll("#rag-library-tbody tr").length === 0);
  check("(9) Nach 'Alle Daten löschen': Gesamtdokument-Textfeld geleert", doc.getElementById("rag-merge-output").value === "");

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  check("(9) Nach Laden: Bibliothek mit 3 Einträgen wiederhergestellt", doc.querySelectorAll("#rag-library-tbody tr").length === 3);
  check("(9) Nach Laden: Gesamtdokument-Textfeld wiederhergestellt", doc.getElementById("rag-merge-output").value.includes("Manuell ergänzter Absatz."));
  check("(9) Nach Laden: Download-Button für Gesamtdokument aktiv", doc.getElementById("rag-merge-download-btn").disabled === false);

  // ===================== (10) Auto-Vorschlag für Domäne/Kapitel bei Import =====================
  // Dateiname/Überschrift-basierte Vorschläge (wortbasierte Ähnlichkeit, wie
  // bei der Referenz-Handbuch-Kapitel-Zuordnung) - nur ab ausreichender
  // Ähnlichkeit, sonst bewusst leer statt geraten.
  let countBeforeSuggest = doc.querySelectorAll("#rag-library-tbody tr").length;

  const mdDomainFile = new win.File(["# Kurzer Text\n\nInhalt ohne Kapitelbezug."], "Contract Management Zusammenfassung.md", { type: "text/markdown" });
  Object.defineProperty(importInput, "files", { value: [mdDomainFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === countBeforeSuggest + 1, 2000);
  let domainSuggestSel = doc.querySelectorAll(".rag-library-domain-select");
  check("(10) Dateiname 'Contract Management Zusammenfassung.md' schlägt passende Domäne vor",
    domainSuggestSel[domainSuggestSel.length - 1].value === "Contract Management");
  check("(10) Importhinweis nennt den automatischen Vorschlag (Dateiname-Treffer)",
    doc.getElementById("rag-library-import-note").textContent.includes("automatisch"));

  const mdChapterFile = new win.File(["Freitext ohne eigene Überschrift."], "Kapitel 4 Servicevertrag anlegen Text.md", { type: "text/markdown" });
  Object.defineProperty(importInput, "files", { value: [mdChapterFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === countBeforeSuggest + 2, 2000);
  let chapterSuggestSel = doc.querySelectorAll(".rag-library-chapter-select");
  check("(10) Dateiname 'Kapitel 4 Servicevertrag anlegen Text.md' schlägt passendes Kapitel vor",
    chapterSuggestSel[chapterSuggestSel.length - 1].value.includes("Kapitel 4"));

  const mdHeadingFile = new win.File(["# Kapitel 7: Verträge im Alltag verwalten\n\nFreitext."], "generischer-dateiname.md", { type: "text/markdown" });
  Object.defineProperty(importInput, "files", { value: [mdHeadingFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === countBeforeSuggest + 3, 2000);
  let chapterSuggestSel2 = doc.querySelectorAll(".rag-library-chapter-select");
  check("(10) Passende Überschrift ('# Kapitel 7: ...') schlägt Kapitel vor, auch bei generischem Dateinamen",
    chapterSuggestSel2[chapterSuggestSel2.length - 1].value.includes("Kapitel 7"));

  const mdNoMatchFile = new win.File(["Beliebiger Text ohne Bezug."], "RAG-Batch-01-von-3.md", { type: "text/markdown" });
  Object.defineProperty(importInput, "files", { value: [mdNoMatchFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === countBeforeSuggest + 4, 2000);
  let domainSuggestSel2 = doc.querySelectorAll(".rag-library-domain-select");
  let chapterSuggestSel3 = doc.querySelectorAll(".rag-library-chapter-select");
  check("(10) Generischer, nicht zuordenbarer Dateiname bleibt ehrlich unzugeordnet (keine geratene Domäne)",
    domainSuggestSel2[domainSuggestSel2.length - 1].value === "");
  check("(10) Generischer, nicht zuordenbarer Dateiname bleibt ehrlich unzugeordnet (kein geratenes Kapitel)",
    chapterSuggestSel3[chapterSuggestSel3.length - 1].value === "");
  check("(10) Importhinweis bei nicht zuordenbarem Dateinamen verweist auf manuelle Zuordnung statt Vorschlag vorzutäuschen",
    doc.getElementById("rag-library-import-note").textContent.includes("Schritt 4"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-BIBLIOTHEK-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
