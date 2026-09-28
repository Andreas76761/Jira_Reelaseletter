// Massenverarbeitung: eigener Navigationspunkt VOR "Verarbeitung", bewusst
// EIGENSTÄNDIG von der RAG-Bibliothek (Verarbeitung -> 7. RAG, Punkte 3-5) -
// eigener Datenbestand (app.massFiles), eigener Datei-Import, eigene
// Domäne/Kapitel-Zuordnung. Besonderheit: "Vorhandene Inhalte einlesen"
// übernimmt zusätzlich zum Datei-Upload bereits an anderer Stelle der App
// erzeugte MD-Inhalte (Benutzerhandbuch-Kapitel, Referenz-Handbuch-Kapitel),
// dedupliziert über sourceKey. Die Anzeige gruppiert je Domäne und sortiert
// innerhalb jeder Domäne nach der Reihenfolge der Gliederung (app.outline) -
// "Nicht zugeordnet" zuletzt. Prüft zusätzlich: die beiden Funktionen
// (Massenverarbeitung vs. RAG-Bibliothek) teilen sich KEINE Daten, und
// hochgeladener/eingelesener Freitext wird durch redactText() geleitet.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Kapitel-Fließtext für Massenverarbeitung-Test.", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
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
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
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
function paragraphXml(styleId, text) {
  var pr = styleId ? "<w:pPr><w:pStyle w:val=\"" + styleId + "\"/></w:pPr>" : "";
  return "<w:p>" + pr + "<w:r><w:t>" + xmlEsc(text) + "</w:t></w:r></w:p>";
}
async function buildDocxBuffer(bodyXml) {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyXml + "</w:body></w:document>";
  zip.file("word/document.xml", docXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>MASS-1</key><summary>Vertrag ändern Testfall</summary><description>Kurzbeschreibung für Massenverarbeitung-Test.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Vorbereitung: Tickets + ein Benutzerhandbuch-Kapitel + ein Referenz-Handbuch-Kapitel erzeugen =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "masstest.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  const manualChapterSelect = doc.getElementById("manual-chapter-select");
  const kap7Opt = Array.from(manualChapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  if (kap7Opt) kap7Opt.selected = true;
  fire(manualChapterSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  const manualDone = await waitUntil(() => {
    const ta = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
    return !!ta && ta.value === "Kapitel-Fließtext für Massenverarbeitung-Test.";
  }, 3000);
  check("Vorbereitung: Benutzerhandbuch-Kapitel 'Kapitel 7' erzeugt", manualDone);

  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);
  const refBodyXml = paragraphXml("Heading1", "Kapitel 4: Servicevertrag anlegen") +
    paragraphXml(null, "Fließtext zu Kapitel 4, Kontakt: max@example.com.");
  const refBuf = await buildDocxBuffer(refBodyXml);
  const refFile = new win.File([refBuf], "Referenzhandbuch.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  doc.getElementById("reference-manual-version-input").value = "Handbuch v1.0";
  const refInput = doc.getElementById("reference-manual-file-input");
  Object.defineProperty(refInput, "files", { value: [refFile], configurable: true });
  fire(refInput, "change");
  await wait(300);
  check("Vorbereitung: Referenz-Handbuch 'Kapitel 4' importiert", doc.getElementById("reference-manual-table-wrap").hidden === false);

  // ===================== Vorbereitung: echte Gliederungs-Stichwörter für Kapitel 7 erzeugen (für Block 5c) =====================
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(100);
  const glSubSelect = doc.getElementById("gl-subchapter-select");
  const glSubOpt = Array.from(glSubSelect.options).find((o) => o.value.indexOf("Kapitel 7") !== -1 && o.value.indexOf("7.1 Änderungen") !== -1);
  check("Vorbereitung: Unterkapitel '7.1 Änderungen' (Kapitel 7) in der Gliederung vorhanden", !!glSubOpt);
  if (glSubOpt) glSubSelect.value = glSubOpt.value;
  fire(doc.getElementById("gl-generate-btn"), "click");
  await wait(50);
  const glRealTermCards = Array.from(doc.querySelectorAll("#gl-keywords-list .manual-chapter-card")).filter((card) => !!card.querySelector(".dq-count-nonzero"));
  const glRealTerms = glRealTermCards.map((card) => card.querySelector(".gl-term-input").value);
  check("Vorbereitung: mindestens 2 echte (ticketbasierte) Gliederungs-Stichwörter erzeugt", glRealTerms.length >= 2);

  // ===================== (1) Navigation: neuer Punkt VOR 'Verarbeitung' =====================
  const navList = Array.from(doc.querySelectorAll(".nav-item[data-view]")).map((b) => b.getAttribute("data-view"));
  check("(1) Navigationspunkt 'massenverarbeitung' vorhanden", navList.includes("massenverarbeitung"));
  check("(1) Steht direkt VOR 'verarbeitung' in der Navigation", navList.indexOf("massenverarbeitung") === navList.indexOf("verarbeitung") - 1);

  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("(1) Panel sichtbar nach Klick", doc.querySelector('[data-view-panel="massenverarbeitung"]').hidden === false);
  check("(1) Zu Beginn leer (eigener, unabhängiger Datenbestand - nichts automatisch übernommen)", doc.getElementById("mass-empty").hidden === false);
  check("(1) Gruppen-Bereich zu Beginn versteckt", doc.getElementById("mass-groups-wrap").hidden === true);

  // ===================== (2) 'Vorhandene Inhalte einlesen' =====================
  fire(doc.getElementById("mass-collect-btn"), "click");
  await wait(50);
  check("(2) Nach Einlesen: Leer-Hinweis versteckt", doc.getElementById("mass-empty").hidden === true);
  check("(2) Gruppen-Bereich jetzt sichtbar", doc.getElementById("mass-groups-wrap").hidden === false);
  const groupsHtml1 = doc.getElementById("mass-groups").innerHTML;
  check("(2) Benutzerhandbuch-Kapitel-Eintrag vorhanden ('Kapitel 7')", groupsHtml1.includes("Kapitel 7"));
  check("(2) Referenz-Handbuch-Eintrag vorhanden ('Handbuch v1.0')", groupsHtml1.includes("Handbuch v1.0"));
  check("(2) Quelle 'Benutzerhandbuch-Kapitel' angezeigt", groupsHtml1.includes("Benutzerhandbuch-Kapitel"));
  check("(2) Quelle 'Referenz-Handbuch' angezeigt", groupsHtml1.includes("Referenz-Handbuch"));
  let toast = doc.getElementById("toast");
  check("(2) Toast meldet 2 eingelesene Inhalte", toast.textContent.includes("2"));

  // ===================== (3) Sortierung innerhalb der Domäne nach Gliederungspunkt =====================
  // Beide Einträge landen (mangels Domänen-Bezug in Titel/Bezeichnung) unter
  // "Ohne Domäne" - dort MUSS "Kapitel 4" (frueher in app.outline) vor
  // "Kapitel 7" erscheinen, nicht alphabetisch und nicht nach Einfügereihenfolge.
  const ohneDomaeneIdx = groupsHtml1.indexOf("Ohne Domäne");
  const kap4Idx = groupsHtml1.indexOf("Kapitel 4");
  const kap7Idx = groupsHtml1.indexOf("Kapitel 7", ohneDomaeneIdx);
  check("(3) Beide Einträge ohne Domänen-Zuordnung (kein Domänen-Bezug im Titel)", ohneDomaeneIdx !== -1);
  check("(3) Innerhalb 'Ohne Domäne': Kapitel 4 erscheint vor Kapitel 7 (Gliederungs-Reihenfolge, nicht alphabetisch/Einfügereihenfolge)",
    kap4Idx !== -1 && kap7Idx !== -1 && kap4Idx < kap7Idx);
  check("(3) Referenz-Handbuch-Kapitel automatisch dem passenden Gliederungskapitel zugeordnet (exakter Titel-Treffer)",
    !!doc.querySelector(".mass-chapter-select") && Array.from(doc.querySelectorAll(".mass-chapter-select")).some((s) => s.value.includes("Kapitel 4")));

  // ===================== (4) Erneutes Einlesen: Dedup über sourceKey, keine Duplikate =====================
  fire(doc.getElementById("mass-collect-btn"), "click");
  await wait(50);
  toast = doc.getElementById("toast");
  check("(4) Zweiter Klick: Hinweis 'nichts Neues' statt Duplikate", toast.textContent.includes("Nichts Neues") || toast.textContent.includes("Keine neuen"));
  check("(4) Weiterhin genau 2 Zeilen (keine Duplikate)", doc.querySelectorAll("#mass-groups tbody tr").length === 2);

  // ===================== (5) Domäne manuell zuordnen: verschiebt Zeile live in eigene Domänen-Gruppe =====================
  const chapterSelects = doc.querySelectorAll(".mass-chapter-select");
  const refRowChapterSelect = Array.from(chapterSelects).find((s) => s.value.includes("Kapitel 4"));
  const refRowId = refRowChapterSelect.getAttribute("data-id");
  const refRowDomainSelect = doc.querySelector('.mass-domain-select[data-id="' + refRowId + '"]');
  refRowDomainSelect.value = "Contract Management";
  fire(refRowDomainSelect, "change");
  await wait(30);
  const groupsHtml2 = doc.getElementById("mass-groups").innerHTML;
  check("(5) Nach Zuordnung: eigene Domänen-Gruppe 'Contract Management' erscheint", groupsHtml2.includes("Contract Management ("));
  check("(5) 'Ohne Domäne'-Gruppe enthält jetzt nur noch den verbleibenden Eintrag", groupsHtml2.includes("Ohne Domäne (1)"));

  // ===================== (5b) Inhaltsbasierte Zuordnung: Domäne/Kapitel aus dem DATEI-INHALT erkannt, nicht nur aus Dateiname/Überschrift =====================
  const massImportInput = doc.getElementById("mass-import-input");
  const domainContentFile = new win.File(
    ["# Notizen\n\nDieser Abschnitt beschreibt Anpassungen im Contract Management für den Alltag."],
    "notizen-generisch.md", { type: "text/markdown" }
  );
  Object.defineProperty(massImportInput, "files", { value: [domainContentFile], configurable: true });
  fire(massImportInput, "change");
  const domainContentDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 3, 2000);
  check("(5b) Datei mit generischem Namen hinzugefügt", domainContentDone);
  const domainContentSel = Array.from(doc.querySelectorAll(".mass-domain-select")).find((s) => {
    const row = s.closest("tr");
    return row && row.textContent.includes("notizen-generisch.md");
  });
  check("(5b) Domäne wird aus dem Datei-INHALT erkannt ('Contract Management' im Fließtext, nicht im Dateinamen)",
    !!domainContentSel && domainContentSel.value === "Contract Management");

  const chapterContentFile = new win.File(
    ["# Interne Notiz\n\nHier wird beschrieben, wie man einen Servicevertrag anlegen kann, Schritt für Schritt."],
    "notiz-2.md", { type: "text/markdown" }
  );
  Object.defineProperty(massImportInput, "files", { value: [chapterContentFile], configurable: true });
  fire(massImportInput, "change");
  const chapterContentDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 4, 2000);
  check("(5b) Zweite Datei mit generischem Namen hinzugefügt", chapterContentDone);
  const chapterContentSel = Array.from(doc.querySelectorAll(".mass-chapter-select")).find((s) => {
    const row = s.closest("tr");
    return row && row.textContent.includes("notiz-2.md");
  });
  check("(5b) Kapitel wird aus dem Datei-INHALT erkannt ('Servicevertrag anlegen' im Fließtext, nicht im Dateinamen)",
    !!chapterContentSel && chapterContentSel.value.includes("Kapitel 4"));

  // ===================== (5c) Konkretes Beispiel: bereits erzeugte Gliederungs-Stichwörter als Zuordnungssignal =====================
  // Datei enthält weder die Kapitel-4-Phrase "Servicevertrag anlegen" noch
  // "Verträge im Alltag verwalten" (Kapitel-7-Titel) noch einen Domänen-
  // namen - nur die in der Vorbereitung ECHT (aus Tickets) erzeugten
  // Gliederungs-Stichwörter für Kapitel 7. Nur ueber massChapterKeywordScore
  // (app.chapterKeywords) kann das ueberhaupt zugeordnet werden.
  const keywordText = "# Sonstige Notiz\n\nStichpunkte: " + glRealTerms.slice(0, 2).join(", ") + ".";
  const keywordFile = new win.File([keywordText], "sonstige-notiz.md", { type: "text/markdown" });
  Object.defineProperty(massImportInput, "files", { value: [keywordFile], configurable: true });
  fire(massImportInput, "change");
  const keywordDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 5, 2000);
  check("(5c) Datei mit Gliederungs-Stichwörtern (ohne Titel-Phrase/Domänenname) hinzugefügt", keywordDone);
  const keywordChapterSel = Array.from(doc.querySelectorAll(".mass-chapter-select")).find((s) => {
    const row = s.closest("tr");
    return row && row.textContent.includes("sonstige-notiz.md");
  });
  check("(5c) Kapitel wird allein über bereits erzeugte Gliederungs-Stichwörter erkannt (Kapitel 7)",
    !!keywordChapterSel && keywordChapterSel.value.includes("Kapitel 7"));

  // ===================== (6) Datei-Upload (.md) mit PII - wird redigiert =====================
  const mdWithPii = "# Hochgeladener Test\n\nKontakt: pii.test@example.com";
  const mdFile = new win.File([mdWithPii], "Hochgeladen.md", { type: "text/markdown" });
  Object.defineProperty(massImportInput, "files", { value: [mdFile], configurable: true });
  fire(massImportInput, "change");
  const uploadDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 6, 2000);
  check("(6) Nach .md-Upload: 6 Zeilen insgesamt", uploadDone);
  check("(6) Hochgeladener Inhalt ist redigiert (keine echte E-Mail-Adresse)", !doc.getElementById("mass-groups").innerHTML.includes("pii.test@example.com"));

  // ===================== (7) ZIP-Upload mit 2 .md-Dateien =====================
  const zip = new JSZipNode();
  zip.file("Teil-Mass-A.md", "# Teil A\n\nFreitext A.");
  zip.file("Teil-Mass-B.md", "# Teil B\n\nFreitext B.");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  const zipFile = new win.File([zipBuf], "MassArchiv.zip", { type: "application/zip" });
  Object.defineProperty(massImportInput, "files", { value: [zipFile], configurable: true });
  fire(massImportInput, "change");
  const zipDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 8, 2000);
  check("(7) Nach ZIP-Upload (2 Dateien): 8 Zeilen insgesamt", zipDone);

  // ===================== (7b) Textschnipsel anzeigen: Vorschau (gekürzt) + "Ganzen Text anzeigen" =====================
  const longTail = "Ende-des-langen-Textes-Markierung";
  const longText = "# Langer Textschnipsel\n\n" + "Lorem ipsum dolor sit amet, ".repeat(20) + longTail;
  const longFile = new win.File([longText], "Langer-Schnipsel.md", { type: "text/markdown" });
  Object.defineProperty(massImportInput, "files", { value: [longFile], configurable: true });
  fire(massImportInput, "change");
  const longDone = await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 9, 2000);
  check("(7b) Langer Textschnipsel hinzugefügt", longDone);
  let groupsHtmlLong = doc.getElementById("mass-groups").innerHTML;
  check("(7b) Vorschau standardmäßig gekürzt (Text-Ende noch nicht sichtbar)", !groupsHtmlLong.includes(longTail));
  check("(7b) Umschalt-Button 'Ganzen Text anzeigen' vorhanden", groupsHtmlLong.includes("Ganzen Text anzeigen"));
  const longToggleBtn = Array.from(doc.querySelectorAll(".mass-toggle-btn")).find((b) => {
    const row = b.closest("tr");
    return row && row.textContent.includes("Langer-Schnipsel.md");
  });
  check("(7b) Umschalt-Button für den langen Textschnipsel gefunden", !!longToggleBtn);
  fire(longToggleBtn, "click");
  await wait(30);
  groupsHtmlLong = doc.getElementById("mass-groups").innerHTML;
  check("(7b) Nach Klick: vollständiger Text sichtbar (Text-Ende jetzt enthalten)", groupsHtmlLong.includes(longTail));
  check("(7b) Button-Beschriftung wechselt zu 'Weniger anzeigen'", groupsHtmlLong.includes("Weniger anzeigen"));
  const longToggleBtn2 = Array.from(doc.querySelectorAll(".mass-toggle-btn")).find((b) => {
    const row = b.closest("tr");
    return row && row.textContent.includes("Langer-Schnipsel.md");
  });
  fire(longToggleBtn2, "click");
  await wait(30);
  check("(7b) Erneuter Klick: wieder gekürzt (Text-Ende wieder verborgen)", !doc.getElementById("mass-groups").innerHTML.includes(longTail));

  // ===================== (7c) KI-Zuordnung: Claude schlägt Domäne/Kapitel für unvollständige Einträge vor =====================
  // Mock antwortet je nach Eintrag unterschiedlich, um drei Faelle konkret
  // nachzuweisen: (a) gueltiger Vorschlag aus der Liste wird uebernommen,
  // (b) ehrliches "keine"/"keines" laesst die Zuordnung leer statt zu raten,
  // (c) eine erfundene, nicht in der Liste vorhandene Antwort wird
  // verworfen (nie eine Option annehmen, die es nicht wirklich gibt).
  const originalSampleImpl = sampleImpl;
  sampleImpl = async (input, opts) => {
    if (typeof input === "string" && input.indexOf("Textschnipsel (Bezeichnung:") !== -1) {
      if (input.indexOf('"Teil-Mass-A.md"') !== -1) {
        return { text: "Domäne: Contract Management\nKapitel: Kapitel 4: Servicevertrag anlegen", truncated: false, modelTierApplied: "default" };
      }
      if (input.indexOf('"Langer-Schnipsel.md"') !== -1) {
        return { text: "Domäne: Erfundene Domäne\nKapitel: Erfundenes Kapitel", truncated: false, modelTierApplied: "default" };
      }
      return { text: "Domäne: keine\nKapitel: keines", truncated: false, modelTierApplied: "default" };
    }
    return originalSampleImpl(input, opts);
  };
  check("(7c) 'KI-Zuordnung'-Button vorhanden", !!doc.getElementById("mass-ai-assign-btn"));
  fire(doc.getElementById("mass-ai-assign-btn"), "click");
  const aiDone = await waitUntil(() => doc.getElementById("mass-ai-status-note").textContent.includes("per KI zugeordnet"), 4000);
  check("(7c) KI-Zuordnung abgeschlossen (Statuszeile aktualisiert)", aiDone);

  function massSelectForRow(cls, filenameFragment) {
    return Array.from(doc.querySelectorAll(cls)).find((s) => {
      const row = s.closest("tr");
      return row && row.textContent.includes(filenameFragment);
    });
  }
  const teilADomainSel = massSelectForRow(".mass-domain-select", "Teil-Mass-A.md");
  check("(7c) Von Claude vorgeschlagene Domäne (wörtlich aus der Liste) übernommen", !!teilADomainSel && teilADomainSel.value === "Contract Management");
  const teilAChapterSel = massSelectForRow(".mass-chapter-select", "Teil-Mass-A.md");
  check("(7c) Von Claude vorgeschlagenes Kapitel (wörtlich aus der Liste) übernommen", !!teilAChapterSel && teilAChapterSel.value.includes("Kapitel 4"));

  const teilBDomainSel = massSelectForRow(".mass-domain-select", "Teil-Mass-B.md");
  check("(7c) Claude-Antwort 'keine' lässt Domäne ehrlich leer statt zu raten", !!teilBDomainSel && teilBDomainSel.value === "");

  const langerDomainSel = massSelectForRow(".mass-domain-select", "Langer-Schnipsel.md");
  check("(7c) Erfundene, nicht in der Liste vorhandene Domäne wird verworfen (nicht übernommen)", !!langerDomainSel && langerDomainSel.value === "");
  const langerChapterSel = massSelectForRow(".mass-chapter-select", "Langer-Schnipsel.md");
  check("(7c) Erfundenes, nicht in der Liste vorhandenes Kapitel wird verworfen (nicht übernommen)", !!langerChapterSel && langerChapterSel.value === "");

  const refDomainSelAfterAi = massSelectForRow(".mass-domain-select", "Handbuch v1.0");
  const refChapterSelAfterAi = massSelectForRow(".mass-chapter-select", "Handbuch v1.0");
  check("(7c) Bereits vorhandene Zuordnung (Referenz-Handbuch) bleibt unverändert (Domäne)", !!refDomainSelAfterAi && refDomainSelAfterAi.value === "Contract Management");
  check("(7c) Bereits vorhandene Zuordnung (Referenz-Handbuch) bleibt unverändert (Kapitel)", !!refChapterSelAfterAi && refChapterSelAfterAi.value.includes("Kapitel 4"));

  sampleImpl = originalSampleImpl;

  // ===================== (7d) Mehrfachauswahl + Massenzuordnung Domäne/Kapitel =====================
  check("(7d) Checkbox je Zeile vorhanden", doc.querySelectorAll(".mass-row-checkbox").length === 9);
  check("(7d) 'Auf Auswahl anwenden' anfangs deaktiviert (nichts ausgewählt)", doc.getElementById("mass-bulk-assign-btn").disabled === true);

  fire(doc.getElementById("mass-select-all-btn"), "click");
  await wait(30);
  check("(7d) 'Alle auswählen' markiert alle Checkboxen", Array.from(doc.querySelectorAll(".mass-row-checkbox")).every((cb) => cb.checked));
  check("(7d) Auswahlzähler zeigt 9", doc.getElementById("mass-selection-count").textContent.startsWith("9"));
  check("(7d) 'Auf Auswahl anwenden' jetzt aktiv", doc.getElementById("mass-bulk-assign-btn").disabled === false);

  fire(doc.getElementById("mass-select-clear-btn"), "click");
  await wait(30);
  check("(7d) 'Auswahl aufheben' entfernt alle Markierungen", Array.from(doc.querySelectorAll(".mass-row-checkbox")).every((cb) => !cb.checked));
  check("(7d) Auswahlzähler zeigt 0", doc.getElementById("mass-selection-count").textContent.startsWith("0"));

  // Muster ohne Treffer: kein Absturz, keine Auswahl.
  doc.getElementById("mass-select-pattern-input").value = "nichts-passt-*";
  fire(doc.getElementById("mass-select-pattern-btn"), "click");
  await wait(30);
  check("(7d) Namensmuster ohne Treffer zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Keine Treffer"));
  check("(7d) Namensmuster ohne Treffer wählt nichts aus", doc.getElementById("mass-selection-count").textContent.startsWith("0"));

  // "Alle auswählen mit Name *": waehlt gezielt die beiden ZIP-Eintraege aus.
  doc.getElementById("mass-select-pattern-input").value = "Teil-Mass-*";
  fire(doc.getElementById("mass-select-pattern-btn"), "click");
  await wait(30);
  check("(7d) Namensmuster 'Teil-Mass-*' wählt genau 2 Einträge aus", doc.getElementById("mass-selection-count").textContent.startsWith("2"));
  const teilACbChecked = Array.from(doc.querySelectorAll(".mass-row-checkbox")).find((cb) => cb.closest("tr").textContent.includes("Teil-Mass-A.md"));
  const teilBCbChecked = Array.from(doc.querySelectorAll(".mass-row-checkbox")).find((cb) => cb.closest("tr").textContent.includes("Teil-Mass-B.md"));
  check("(7d) Beide passenden Einträge tatsächlich markiert", teilACbChecked.checked && teilBCbChecked.checked);
  const hochgeladenCbChecked = Array.from(doc.querySelectorAll(".mass-row-checkbox")).find((cb) => cb.closest("tr").textContent.includes("Hochgeladen.md"));
  check("(7d) Nicht passender Eintrag bleibt unmarkiert", !hochgeladenCbChecked.checked);

  // Massenzuordnung anwenden - ueberschreibt AUCH eine bereits (von der
  // KI-Zuordnung) vorhandene Zuordnung, anders als die vorsichtige
  // heuristische/KI-Zuordnung, die nur leere Felder fuellt.
  doc.getElementById("mass-bulk-domain-select").value = "Contract Management";
  const bulkChapterOpt = Array.from(doc.getElementById("mass-bulk-chapter-select").options).find((o) => o.value.includes("Kapitel 7"));
  doc.getElementById("mass-bulk-chapter-select").value = bulkChapterOpt.value;
  fire(doc.getElementById("mass-bulk-assign-btn"), "click");
  await wait(30);
  const teilADomainAfterBulk = Array.from(doc.querySelectorAll(".mass-domain-select")).find((s) => s.closest("tr").textContent.includes("Teil-Mass-A.md"));
  const teilAChapterAfterBulk = Array.from(doc.querySelectorAll(".mass-chapter-select")).find((s) => s.closest("tr").textContent.includes("Teil-Mass-A.md"));
  check("(7d) Massenzuordnung setzt Domäne bei Teil-Mass-A.md", teilADomainAfterBulk.value === "Contract Management");
  check("(7d) Massenzuordnung überschreibt vorhandenes Kapitel bei Teil-Mass-A.md (Kapitel 4 -> Kapitel 7)", teilAChapterAfterBulk.value.includes("Kapitel 7"));
  const teilBDomainAfterBulk = Array.from(doc.querySelectorAll(".mass-domain-select")).find((s) => s.closest("tr").textContent.includes("Teil-Mass-B.md"));
  const teilBChapterAfterBulk = Array.from(doc.querySelectorAll(".mass-chapter-select")).find((s) => s.closest("tr").textContent.includes("Teil-Mass-B.md"));
  check("(7d) Massenzuordnung setzt Domäne bei Teil-Mass-B.md", teilBDomainAfterBulk.value === "Contract Management");
  check("(7d) Massenzuordnung setzt Kapitel bei Teil-Mass-B.md", teilBChapterAfterBulk.value.includes("Kapitel 7"));
  const hochgeladenDomainAfterBulk = Array.from(doc.querySelectorAll(".mass-domain-select")).find((s) => s.closest("tr").textContent.includes("Hochgeladen.md"));
  check("(7d) Nicht ausgewählter Eintrag bleibt von der Massenzuordnung unberührt", hochgeladenDomainAfterBulk.value === "");

  // ===================== (8) Unabhängigkeit von der RAG-Bibliothek: keine gemeinsamen Daten =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  check("(8) RAG-Bibliothek zeigt KEINEN der Massenverarbeitung-Einträge (unabhängiger Datenbestand)",
    doc.getElementById("rag-library-empty").hidden === false);

  const ragDomainSelect = doc.getElementById("rag-domain-select");
  Array.from(ragDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await waitUntil(() => doc.getElementById("rag-download-btn").disabled === false, 3000);
  fire(doc.getElementById("rag-library-save-btn"), "click");
  await wait(50);
  check("(8) RAG-Bibliothek-Eintrag gespeichert", doc.querySelectorAll("#rag-library-tbody tr").length === 1);

  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("(8) Massenverarbeitung zeigt weiterhin nur ihre eigenen 9 Einträge (kein RAG-Bibliothek-Eintrag mit eingemischt)",
    doc.querySelectorAll("#mass-groups tbody tr").length === 9);

  // ===================== (8a) "Kapitel als MD-Datei erstellen" je Domäne =====================
  const domainMdBtn = doc.querySelector('.mass-domain-md-btn[data-domain="Contract Management"]');
  const domainMdOverlay = doc.getElementById("mass-domain-md-modal-overlay");
  const domainMdKey = doc.getElementById("mass-domain-md-modal-key");
  const domainMdTextarea = doc.getElementById("mass-domain-md-textarea");
  const domainMdStatusNote = doc.getElementById("mass-domain-md-status-note");
  const domainMdSaveBtn = doc.getElementById("mass-domain-md-save-btn");
  const domainMdDownloadBtn = doc.getElementById("mass-domain-md-download-btn");
  check("(8a) Button 'Kapitel als MD-Datei erstellen' hinter der Domäne 'Contract Management' vorhanden", !!domainMdBtn);
  fire(domainMdBtn, "click");
  check("(8a) Dialog öffnet sich", domainMdOverlay.hidden === false);
  check("(8a) Dialog-Titel zeigt Domänenname", domainMdKey.textContent === "Contract Management");
  check("(8a) Text wurde neu erzeugt (Überschrift enthält Domänenname)", domainMdTextarea.value.startsWith("# Contract Management - Kapitel als MD-Datei"));
  check("(8a) Download-Button vor dem ersten Speichern deaktiviert", domainMdDownloadBtn.disabled === true);
  check("(8a) Statuszeile weist auf 'neu erzeugt' hin", domainMdStatusNote.textContent.includes("Neu erzeugt"));

  const domainMdEdited = domainMdTextarea.value + "\n\nManuelle Nacharbeit Domäne.";
  domainMdTextarea.value = domainMdEdited;
  fire(domainMdTextarea, "input");
  check("(8a) Download-Button bleibt nach Bearbeitung ohne Speichern deaktiviert", domainMdDownloadBtn.disabled === true);
  fire(domainMdSaveBtn, "click");
  check("(8a) Download-Button nach 'Speichern' aktiv", domainMdDownloadBtn.disabled === false);
  check("(8a) Statuszeile bestätigt Speicherung", domainMdStatusNote.textContent.includes("Gespeichert"));

  fire(domainMdDownloadBtn, "click");
  await wait(50);
  const domainMdSaved = savedFiles[savedFiles.length - 1];
  check("(8a) Download enthält den gespeicherten (bearbeiteten) Text", !!domainMdSaved && domainMdSaved.data === domainMdEdited);
  check("(8a) Download-Dateiname endet auf .md und enthält Domänennamen", !!domainMdSaved && /Contract_Management\.md$/.test(domainMdSaved.filename || ""));

  fire(doc.getElementById("mass-domain-md-modal-cancel-btn"), "click");
  check("(8a) Dialog schließt sich", domainMdOverlay.hidden === true);

  fire(domainMdBtn, "click");
  check("(8a) Beim erneuten Öffnen: gespeicherter (bearbeiteter) Stand geladen statt neu erzeugt", domainMdTextarea.value === domainMdEdited);
  check("(8a) Download-Button beim erneuten Öffnen bereits aktiv (gespeicherter Stand)", domainMdDownloadBtn.disabled === false);
  fire(doc.getElementById("mass-domain-md-modal-close"), "click");
  check("(8a) Dialog auch über das X schließbar", domainMdOverlay.hidden === true);

  // ===================== (8b) Zusammenfassung je Kapitel (Merge zu einem Textfile) =====================
  const mergeBtn = doc.getElementById("mass-merge-btn");
  const mergeSpinner = doc.getElementById("mass-merge-spinner");
  const mergeOutput = doc.getElementById("mass-merge-output");
  const mergeDownloadBtn = doc.getElementById("mass-merge-download-btn");
  check("(8b) 'Zusammenfassung je Kapitel'-Button vorhanden", !!mergeBtn);
  check("(8b) Sanduhr (Spinner) zunächst verborgen", mergeSpinner.hidden === true);
  check("(8b) Download-Button anfangs deaktiviert (noch nichts zusammengeführt)", mergeDownloadBtn.disabled === true);
  fire(mergeBtn, "click");
  await waitUntil(() => mergeOutput.value.trim().length > 0, 3000);
  check("(8b) Sanduhr nach Abschluss wieder verborgen", mergeSpinner.hidden === true);
  check("(8b) Button nach Abschluss wieder aktiv", mergeBtn.disabled === false);
  check("(8b) Gesamtdokument beginnt mit erwarteter Überschrift", mergeOutput.value.startsWith("# Massenverarbeitung - Zusammenfassung je Kapitel"));
  check("(8b) Gesamtdokument enthält Domäne 'Contract Management' als Abschnitt", mergeOutput.value.includes("## Domäne: Contract Management"));
  check("(8b) Gesamtdokument enthält Kapitel-Abschnitt", mergeOutput.value.includes("### Kapitel:"));
  check("(8b) Statuszeile nennt Anzahl der zusammengeführten Textschnipsel", doc.getElementById("mass-merge-status-note").textContent.includes("9 Textschnipsel"));
  check("(8b) Download-Button nach Zusammenführen aktiv", mergeDownloadBtn.disabled === false);

  const mergeEdited = mergeOutput.value + "\n\nManuelle Nacharbeit.";
  mergeOutput.value = mergeEdited;
  fire(mergeOutput, "input");
  fire(mergeDownloadBtn, "click");
  await wait(50);
  const mergeSaved = savedFiles[savedFiles.length - 1];
  check("(8b) Manuelle Bearbeitung im Textfeld wird beim Download berücksichtigt", !!mergeSaved && mergeSaved.data === mergeEdited);
  check("(8b) Download-Dateiname endet auf .txt", !!mergeSaved && /\.txt$/.test(mergeSaved.filename || ""));

  // ===================== (9) Löschen eines Eintrags =====================
  const delBtn = doc.querySelector(".mass-delete-btn");
  fire(delBtn, "click");
  await confirmViaModal(doc);
  check("(9) Nach Löschen: 8 Zeilen verbleiben", doc.querySelectorAll("#mass-groups tbody tr").length === 8);

  // ===================== (10) Sitzung speichern/laden sichert app.massFiles + massMergedDoc =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(10) Export enthält massFiles mit 8 Einträgen", Array.isArray(exportedJson.massFiles) && exportedJson.massFiles.length === 8);
  check("(10) Export enthält das bearbeitete Zusammenfassung-Gesamtdokument", typeof exportedJson.massMergedDoc === "string" && exportedJson.massMergedDoc.includes("Manuelle Nacharbeit."));
  check("(10) Export enthält die gespeicherte Domänen-MD-Datei", exportedJson.massDomainDocs && exportedJson.massDomainDocs["Contract Management"] === domainMdEdited);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("(10) Nach 'Alle Daten löschen': Massenverarbeitung geleert", doc.getElementById("mass-empty").hidden === false);
  check("(10) Nach 'Alle Daten löschen': Zusammenfassung-Textfeld geleert", doc.getElementById("mass-merge-output").value === "");
  check("(10) Nach 'Alle Daten löschen': Download-Button der Zusammenfassung deaktiviert", doc.getElementById("mass-merge-download-btn").disabled === true);

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("(10) Nach Laden: 8 Einträge wiederhergestellt", doc.querySelectorAll("#mass-groups tbody tr").length === 8);
  check("(10) Nach Laden: Zusammenfassung-Textfeld wiederhergestellt", doc.getElementById("mass-merge-output").value.includes("Manuelle Nacharbeit."));
  check("(10) Nach Laden: Download-Button der Zusammenfassung aktiv", doc.getElementById("mass-merge-download-btn").disabled === false);

  const restoredDomainMdBtn = doc.querySelector('.mass-domain-md-btn[data-domain="Contract Management"]');
  fire(restoredDomainMdBtn, "click");
  check("(10) Nach Laden: gespeicherte Domänen-MD-Datei wiederhergestellt", doc.getElementById("mass-domain-md-textarea").value === domainMdEdited);
  check("(10) Nach Laden: Download-Button der Domänen-MD-Datei aktiv", doc.getElementById("mass-domain-md-download-btn").disabled === false);
  fire(doc.getElementById("mass-domain-md-modal-cancel-btn"), "click");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MASSENVERARBEITUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
