// Neues Register "EDITO": erstellt eine neue Fassung des Benutzerhandbuchs
// je Rolle/Sparte (Wiederverwendung der 6 bestehenden Gliederungsversionen
// Markt/MO/Dealer/IT/Van/Pkw) aus 5 Quellen gleichzeitig: Jira-Tickets,
// RAG-Bibliothek, bestehendem Benutzerhandbuch-Text, Rovo-Knowledge-
// Textschnipseln und Bildband-Bildern. Prüft: Kapitelliste + Quellen-
// Übersicht nach Rolle/Sparte-Auswahl (inkl. Sparte-/Rollen-Tag-Filterung
// NUR bei Tickets), Einzel- und Sammel-Erzeugung (gemockte sample-
// Capability), Export je Kapitel (DOCX/PDF/MD, Wiederverwendung von
// buildManualChapterDocxBlob/PdfDoc), Agent 1 (Inhalt vs. Rovo/Jira) und
// Agent 2 (Grammatik/Sprachstil), Sitzung speichern/laden sowie Reset.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// Unterscheidet die drei EDITO-Prompt-Arten an eindeutigen Textmarkern aus
// den jeweiligen RAG_PROMPT_DEFAULTS-Texten/Prompt-Buildern.
let lastChapterPromptText = "";
async function sampleImpl(promptText) {
  if (/KAPITELTEXT:/.test(promptText || "")) {
    return { text: "### Nicht belegte Aussagen\n- Keine gefunden.\n\n### Widersprüche zu den Quellen\n- Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  if (/Grammatikfehler/.test(promptText || "")) {
    return { text: "### Grammatikfehler\n- Keine gefunden.\n\n### Sprachstil-Unstimmigkeiten\n- Keine gefunden.\n\n### Wiederholungen\n- Keine gefunden.\n\n### Roter Faden\n- Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  lastChapterPromptText = promptText || "";
  return { text: "## Retail\nTestabsatz für die neue EDITO-Fassung.\n[Bild]\n", truncated: false, modelTierApplied: "default" };
}
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
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
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// Dieselben Fixture-Tickets wie outline_versions_test.js: OV-1 (Pkw+Retail,
// Domäne "Contract Management" -> Kapitel 7) matcht die Version "Dealer";
// OV-2 (Van+MO, Domäne "Revenue Management" -> Kapitel 5) matcht "Dealer"
// NICHT (kein Retail-Tag).
const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>OV-1</key><summary>Pkw Dealer Ticket</summary><description>Pkw/Dealer Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>OV-2</key><summary>Van MO Ticket</summary><description>Van/MO Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Van</label><label>MO</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Revenue Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== Tickets importieren =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "edito_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Register umbenannt: "EDITO" -> "Editor" =====================
  check("Nav-Eintrag für EDITO heißt jetzt 'Editor'", doc.querySelector('.nav-item[data-view="edito"]').textContent.trim() === "Editor");
  check("Bestehendes Register 'editor' heißt jetzt 'Screens-Import' (kein Namenskonflikt)", doc.querySelector('.nav-item[data-view="editor"]').textContent.trim() === "Screens-Import");

  // ===================== EDITO vor Rolle/Sparte-Auswahl =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  check("Rolle/Sparte-Auswahl vorhanden mit 6 Versionen", doc.getElementById("edito-version-select").options.length === 7); // 1 Platzhalter + 6 Versionen
  check("Kapitel-Bereich vor Auswahl versteckt", doc.getElementById("edito-chapters-section").hidden === true);
  check("Übersicht aller Dokumente vor jeder Erzeugung leer", doc.getElementById("edito-files-count").textContent === "0" && doc.getElementById("edito-files-empty").hidden === false);

  // ===================== Rolle/Sparte "Dealer" wählen =====================
  const versionSelect = doc.getElementById("edito-version-select");
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(100);
  check("Kapitel-Bereich nach Auswahl sichtbar", doc.getElementById("edito-chapters-section").hidden === false);

  // ===================== Gesamtdokument ohne erzeugte Kapitel =====================
  fire(doc.getElementById("edito-merge-btn"), "click");
  await wait(50);
  check("Gesamtdokument-Button ohne erzeugte Kapitel zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("noch kein Kapitel erzeugt"));
  check("Gesamtdokument-Vorschau bleibt dabei versteckt", doc.getElementById("edito-merge-preview-section").hidden === true);

  function rowFor(chapterTitleSubstring) {
    return Array.from(doc.getElementById("edito-chapters-tbody").querySelectorAll("tr")).find((r) => r.children[1].textContent.includes(chapterTitleSubstring));
  }
  const kap7Row = rowFor("Kapitel 7");
  check("Kapitel 7 (Contract Management, Retail-Ticket) ist in Dealer-Version enthalten", !!kap7Row);
  check("Kapitel 7: genau 1 Ticket gezählt (OV-1, Retail)", !!kap7Row && kap7Row.children[2].textContent.trim() === "1");
  const kap5Row = rowFor("Kapitel 5");
  check("Kapitel 5 (Revenue Management, nur Van/MO-Ticket) ist NICHT in Dealer-Version enthalten", !kap5Row);
  const kap7TitleFull = kap7Row.children[1].textContent;

  // ===================== Rovo-Eintrag für Kapitel 7 anlegen =====================
  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  doc.getElementById("rovo-chat-textarea").value = "Wie lege ich einen Servicevertrag an?";
  doc.getElementById("rovo-answer-textarea").value = "Über den Menüpunkt Vertrag anlegen.";
  fire(doc.getElementById("rovo-add-entry-btn"), "click");
  await wait(50);
  const rovoChapterSel = doc.querySelector(".rovo-chapter-select");
  rovoChapterSel.value = kap7TitleFull;
  fire(rovoChapterSel, "change");
  await wait(30);

  // ===================== RAG-Bibliothek-Eintrag für Kapitel 7 anlegen =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(50);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(50);
  const ragMdFile = new win.File(["# Vertragsübersicht\n\nFließtext zur RAG-Bibliothek."], "RAG-Kapitel7.md", { type: "text/markdown" });
  const ragImportInput = doc.getElementById("rag-library-import-input");
  Object.defineProperty(ragImportInput, "files", { value: [ragMdFile], configurable: true });
  fire(ragImportInput, "change");
  const ragDone = await waitUntil(() => doc.querySelectorAll("#rag-library-tbody tr").length === 1, 2000);
  check("RAG-Bibliothek: Eintrag importiert", ragDone);
  const ragChapterSel = doc.querySelector(".rag-library-chapter-select");
  ragChapterSel.value = kap7TitleFull;
  fire(ragChapterSel, "change");
  await wait(30);

  // ===================== Quellen-Übersicht zeigt alle Quellen =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  const kap7RowAfterSources = rowFor("Kapitel 7");
  check("Kapitel 7: Ticket-Anzahl weiterhin 1", kap7RowAfterSources.children[2].textContent.trim() === "1");
  check("Kapitel 7: RAG-Anzahl jetzt 1", kap7RowAfterSources.children[3].textContent.trim() === "1");
  check("Kapitel 7: bestehender Handbuchtext „–“ (noch keiner erzeugt)", kap7RowAfterSources.children[4].textContent.trim() === "–");
  check("Kapitel 7: Rovo-Anzahl jetzt 1", kap7RowAfterSources.children[5].textContent.trim() === "1");
  check("Kapitel 7: Status „Noch nicht erzeugt“", kap7RowAfterSources.children[7].textContent.includes("Noch nicht erzeugt"));

  // ===================== Einzelnes Kapitel erzeugen =====================
  fire(kap7RowAfterSources.querySelector("[data-edito-generate]"), "click");
  await waitUntil(() => doc.getElementById("edito-preview-section").hidden === false, 2000);
  check("Vorschau-Bereich nach Erzeugen sichtbar", doc.getElementById("edito-preview-section").hidden === false);
  check("Vorschau-Titel nennt das Kapitel", doc.getElementById("edito-preview-title").textContent.includes("Kapitel 7"));
  check("Vorschau zeigt den (gemockten) generierten Text", doc.getElementById("edito-preview-output").value.includes("Testabsatz für die neue EDITO-Fassung"));
  check("Kapitel-Prompt kennzeichnet Rovo-Knowledge (Quelle 4) explizit als vorrangige Quelle", lastChapterPromptText.includes("QUELLE 4") && lastChapterPromptText.includes("VORRANGIGE Quelle"));
  check("Hauptprompt nennt den Vorrang von Quelle 4 bei Widersprüchen", lastChapterPromptText.includes("hat QUELLE 4") && lastChapterPromptText.includes("Vorrang"));
  const kap7RowAfterGen = rowFor("Kapitel 7");
  check("Kapitel 7: Status jetzt „Erzeugt“", kap7RowAfterGen.children[7].textContent.includes("Erzeugt"));
  check("Erzeugen-Button-Beschriftung wechselt zu „Neu erzeugen“", kap7RowAfterGen.querySelector("[data-edito-generate]").textContent.includes("Neu erzeugen"));

  // ===================== Nach Erzeugen: Word+PDF automatisch abgelegt, in Übersicht sichtbar =====================
  const dateStamp = new Date().toISOString().slice(0, 10);
  check("Übersicht aller Dokumente zeigt jetzt genau 1 Datei-Zeile", doc.getElementById("edito-files-count").textContent === "1");
  check("Leer-Hinweis der Dokumenten-Übersicht jetzt ausgeblendet", doc.getElementById("edito-files-empty").hidden === true);
  const filesRow1 = doc.getElementById("edito-files-tbody").querySelector("tr");
  check("Dokumenten-Übersicht nennt das Kapitel", filesRow1.children[0].textContent.includes("Kapitel 7"));
  check("Dokumenten-Übersicht nennt die Rolle/Sparte 'Dealer'", /Dealer/i.test(filesRow1.children[1].textContent));
  check("Dokumenten-Übersicht nennt ein Erzeugungsdatum (nicht leer)", filesRow1.children[2].textContent.trim().length > 0);
  const docxFileBtn = filesRow1.children[3].querySelector("[data-edito-file-download='docx']");
  const pdfFileBtn = filesRow1.children[4].querySelector("[data-edito-file-download='pdf']");
  check("Dokumenten-Übersicht: Word-Dateiname enthält das heutige Datum", !!docxFileBtn && docxFileBtn.textContent.includes(dateStamp) && docxFileBtn.textContent.endsWith(".docx"));
  check("Dokumenten-Übersicht: PDF-Dateiname enthält das heutige Datum", !!pdfFileBtn && pdfFileBtn.textContent.includes(dateStamp) && pdfFileBtn.textContent.endsWith(".pdf"));

  // ===================== Download direkt aus der Dokumenten-Übersicht =====================
  const savedBeforeOverviewDownload = savedFiles.length;
  fire(docxFileBtn, "click");
  await wait(100);
  check("Klick auf Word-Datei in der Übersicht löst Download aus", savedFiles.length === savedBeforeOverviewDownload + 1);
  check("Heruntergeladener Dateiname stimmt mit Anzeige überein", savedFiles[savedBeforeOverviewDownload].filename === docxFileBtn.textContent);
  fire(pdfFileBtn, "click");
  await wait(100);
  check("Klick auf PDF-Datei in der Übersicht löst Download aus", savedFiles.length === savedBeforeOverviewDownload + 2);

  // ===================== Checkbox-Auswahl + Mehrfach-Export (Punkt 2 + 3) =====================
  const chapterCheckbox = (title) => rowFor(title).querySelector(".edito-chapter-select");
  check("Auswahl-Zähler initial '0 Kapitel ausgewählt'", doc.getElementById("edito-selection-count").textContent.trim() === "0 Kapitel ausgewählt");

  chapterCheckbox("Kapitel 7").checked = true;
  fire(chapterCheckbox("Kapitel 7"), "change");
  await wait(30);
  check("Nach Anhaken einer Checkbox: Zähler zeigt '1 Kapitel ausgewählt'", doc.getElementById("edito-selection-count").textContent.trim() === "1 Kapitel ausgewählt");

  const totalDealerChapters = parseInt(doc.getElementById("edito-chapters-count").textContent, 10);
  fire(doc.getElementById("edito-select-all-btn"), "click");
  await wait(30);
  check("'Alle auswählen' setzt Zähler auf Gesamtzahl der Kapitel dieser Version", doc.getElementById("edito-selection-count").textContent.trim() === totalDealerChapters + " Kapitel ausgewählt");
  check("'Alle auswählen' hakt auch die Kapitel-7-Checkbox an", chapterCheckbox("Kapitel 7").checked === true);

  fire(doc.getElementById("edito-select-clear-btn"), "click");
  await wait(30);
  check("'Auswahl aufheben' setzt Zähler zurück auf 0", doc.getElementById("edito-selection-count").textContent.trim() === "0 Kapitel ausgewählt");
  check("'Auswahl aufheben' hakt die Checkboxen wieder ab", chapterCheckbox("Kapitel 7").checked === false);

  fire(doc.getElementById("edito-batch-export-pdf-btn"), "click");
  await wait(100);
  check("Mehrfach-Export ohne Auswahl zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Bitte zuerst oben"));

  // Kapitel 7 (bereits mit Text) + Kapitel 1 (noch ohne Text) auswählen -
  // der Export muss das erzeugte Kapitel exportieren und das andere
  // überspringen, nicht abstürzen.
  check("Kapitel 1 ist in der Dealer-Version vorhanden (Vergleichskapitel ohne Text)", !!rowFor("Kapitel 1"));
  check("Kapitel 1 hat noch keinen erzeugten Text", rowFor("Kapitel 1").children[7].textContent.includes("Noch nicht erzeugt"));
  chapterCheckbox("Kapitel 7").checked = true;
  fire(chapterCheckbox("Kapitel 7"), "change");
  chapterCheckbox("Kapitel 1").checked = true;
  fire(chapterCheckbox("Kapitel 1"), "change");
  await wait(30);
  check("2 Kapitel ausgewählt (1 mit, 1 ohne Text)", doc.getElementById("edito-selection-count").textContent.trim() === "2 Kapitel ausgewählt");

  const logLengthBeforeBatch = doc.getElementById("log-list").textContent.length;
  fire(doc.getElementById("edito-batch-export-pdf-btn"), "click");
  await waitUntil(() => doc.getElementById("log-list").textContent.length > logLengthBeforeBatch, 2000);
  check("Protokoll vermerkt Mehrfach-Export mit 1 erzeugt und 1 übersprungen", /Mehrfach-Export \(PDF\).*1 Dokument\(e\) erzeugt.*1 übersprungen/.test(doc.getElementById("log-list").textContent));
  check("Auswahl bleibt nach dem Export erhalten (Kapitel 7 weiterhin angehakt)", chapterCheckbox("Kapitel 7").checked === true);
  check("Auswahl bleibt nach dem Export erhalten (Kapitel 1 weiterhin angehakt)", chapterCheckbox("Kapitel 1").checked === true);
  check("Kapitel 1 wurde NICHT in die Dokumenten-Übersicht aufgenommen (kein Text vorhanden)", !Array.from(doc.getElementById("edito-files-tbody").querySelectorAll("tr")).some((r) => r.children[0].textContent.includes("Kapitel 1")));

  fire(doc.getElementById("edito-select-clear-btn"), "click");
  await wait(30);

  // ===================== Gesamtdokument (Punkt 6): mehrere Kapitel zusammenführen =====================
  check("Gesamtdokument-Status-Hinweis zunächst leer", doc.getElementById("edito-merge-status-note").textContent.trim() === "");
  check("Gesamtdokument-Vorschau zunächst versteckt", doc.getElementById("edito-merge-preview-section").hidden === true);

  // Kapitel 1 zusätzlich erzeugen (Dealer-Version hat mehr als 2 Kapitel) -
  // Gesamtdokument muss dann 2 zusammengeführte + mindestens 1
  // übersprungenes (noch nicht erzeugtes) Kapitel melden.
  const kap1TitleFull = rowFor("Kapitel 1").children[1].textContent;
  fire(rowFor("Kapitel 1").querySelector("[data-edito-generate]"), "click");
  await waitUntil(() => !!rowFor("Kapitel 1").querySelector("[data-edito-view]"), 2000);
  check("Kapitel 1 zusätzlich erzeugt (für den Gesamtdokument-Test)", !!rowFor("Kapitel 1").querySelector("[data-edito-view]"));

  fire(doc.getElementById("edito-merge-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-merge-preview-section").hidden === false, 3000);
  check("Gesamtdokument-Vorschau nach Zusammenführen sichtbar", doc.getElementById("edito-merge-preview-section").hidden === false);
  check("Gesamtdokument-Status nennt genau 2 zusammengeführte Kapitel", /^2 von \d+ Kapiteln zusammengeführt/.test(doc.getElementById("edito-merge-status-note").textContent));
  check("Gesamtdokument-Status vermerkt übersprungene (noch nicht erzeugte) Kapitel", doc.getElementById("edito-merge-status-note").textContent.includes("übersprungen"));
  check("Vorschau enthält den Text von Kapitel 7", doc.getElementById("edito-merge-preview-output").textContent.includes("Testabsatz für die neue EDITO-Fassung"));
  check("Vorschau nennt beide zusammengeführten Kapitel", doc.getElementById("edito-merge-preview-output").textContent.includes(kap7TitleFull) && doc.getElementById("edito-merge-preview-output").textContent.includes(kap1TitleFull));
  check("Protokoll vermerkt das Zusammenführen zum Gesamtdokument", doc.getElementById("log-list").textContent.includes("Gesamtdokument"));

  const mergeSavedBefore = savedFiles.length;
  fire(doc.getElementById("edito-merge-download-btn"), "click");
  await wait(150);
  check("Gesamtdokument-Download ausgelöst", savedFiles.length === mergeSavedBefore + 1);
  const mergedFile = savedFiles[mergeSavedBefore];
  check("Gesamtdokument-Dateiname endet auf .docx", (mergedFile.filename || "").endsWith(".docx"));
  const mergedZip = await JSZipNode.loadAsync(Buffer.from(await mergedFile.data.arrayBuffer()));
  const mergedXml = await mergedZip.file("word/document.xml").async("string");
  check("Gesamtdokument-DOCX enthält den Titel von Kapitel 7", mergedXml.includes(kap7TitleFull));
  check("Gesamtdokument-DOCX enthält den Titel von Kapitel 1", mergedXml.includes(kap1TitleFull));
  check("Gesamtdokument-DOCX enthält einen Seitenumbruch zwischen den Kapiteln", mergedXml.includes('w:br w:type="page"'));

  // Versionswechsel muss die (zur alten Version gehörende) Vorschau leeren
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(50);
  check("Versionswechsel (Re-Auswahl) leert die Gesamtdokument-Vorschau", doc.getElementById("edito-merge-preview-section").hidden === true);

  fire(doc.getElementById("edito-select-clear-btn"), "click");
  await wait(30);

  // Das Erzeugen von Kapitel 1 oben hat die aktive Vorschau auf Kapitel 1
  // umgeschaltet (editoShowChapter wird nach jedem Erzeugen aufgerufen) -
  // fuer die folgenden Schritte (Bearbeitung/Export/Agenten) wieder auf
  // Kapitel 7 zurueckschalten, wie es der Rest des Tests erwartet.
  fire(rowFor("Kapitel 7").querySelector("[data-edito-view]"), "click");
  await wait(30);

  // ===================== Manuelle Bearbeitung der Vorschau =====================
  const previewTa = doc.getElementById("edito-preview-output");
  previewTa.value = previewTa.value + "\nManuell ergänzter Satz.";
  fire(previewTa, "input");
  await wait(30);

  // ===================== Export (DOCX/PDF/MD) =====================
  const savedBefore = savedFiles.length;
  fire(doc.getElementById("edito-export-docx-btn"), "click");
  await wait(150);
  check("DOCX-Export ausgelöst", savedFiles.length === savedBefore + 1);
  check("DOCX-Dateiname endet auf .docx und enthält EDITO", /_EDITO\.docx$/.test(savedFiles[savedBefore].filename));
  const docxZip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[savedBefore].data.arrayBuffer()));
  check("DOCX enthält word/document.xml", !!docxZip.file("word/document.xml"));
  const docXmlText = await docxZip.file("word/document.xml").async("string");
  check("DOCX-Inhalt enthält den manuell ergänzten Satz", docXmlText.includes("Manuell ergänzter Satz"));

  fire(doc.getElementById("edito-export-pdf-btn"), "click");
  await wait(150);
  check("PDF-Export ausgelöst", savedFiles.length === savedBefore + 2);
  check("PDF-Dateiname endet auf .pdf und enthält EDITO", /_EDITO\.pdf$/.test(savedFiles[savedBefore + 1].filename));

  fire(doc.getElementById("edito-export-md-btn"), "click");
  await wait(100);
  check("MD-Export ausgelöst", savedFiles.length === savedBefore + 3);
  check("MD-Export enthält den manuell ergänzten Satz", savedFiles[savedBefore + 2].data.includes("Manuell ergänzter Satz"));

  // ===================== Agent 1 (Inhalt vs. Rovo/Jira) =====================
  fire(doc.getElementById("edito-agent1-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-agent1-output").textContent.includes("Nicht belegte Aussagen"), 2000);
  check("Agent 1: Ergebnis-Panel sichtbar", doc.getElementById("edito-agent1-result").hidden === false);
  check("Agent 1: Ergebnis zeigt den erwarteten Abschnitt", doc.getElementById("edito-agent1-output").textContent.includes("Nicht belegte Aussagen"));
  check("Protokoll vermerkt Agent-1-Lauf", doc.getElementById("log-list").textContent.includes("Agent 1"));

  // ===================== Agent 2 (Grammatik/Sprachstil) =====================
  fire(doc.getElementById("edito-agent2-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-agent2-output").textContent.includes("Roter Faden"), 2000);
  check("Agent 2: Ergebnis-Panel sichtbar", doc.getElementById("edito-agent2-result").hidden === false);
  check("Agent 2: Ergebnis zeigt den erwarteten Abschnitt", doc.getElementById("edito-agent2-output").textContent.includes("Roter Faden"));
  check("Protokoll vermerkt Agent-2-Lauf", doc.getElementById("log-list").textContent.includes("Agent 2"));

  // ===================== Agent-Ergebnisse bleiben beim erneuten Anzeigen sichtbar =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(30);
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(30);
  fire(rowFor("Kapitel 7").querySelector("[data-edito-view]"), "click");
  await wait(30);
  check("Nach erneutem Anzeigen: Agent-1-Ergebnis weiterhin sichtbar", doc.getElementById("edito-agent1-result").hidden === false);
  check("Nach erneutem Anzeigen: Agent-2-Ergebnis weiterhin sichtbar", doc.getElementById("edito-agent2-result").hidden === false);

  // ===================== Sammel-Lauf "Alle Kapitel erzeugen" =====================
  fire(doc.getElementById("edito-generate-all-btn"), "click");
  await waitUntil(() => doc.getElementById("edito-generate-all-status-note").textContent.includes("erzeugt"), 3000);
  check("Sammel-Lauf-Status vermerkt Abschluss", /von \d+ Kapiteln erzeugt/.test(doc.getElementById("edito-generate-all-status-note").textContent));
  const allChapterRows = Array.from(doc.getElementById("edito-chapters-tbody").querySelectorAll("tr"));
  check("Sammel-Lauf: alle Kapitel der Dealer-Version zeigen Status „Erzeugt“", allChapterRows.every((r) => r.children[7].textContent.includes("Erzeugt")));
  check("Dokumenten-Übersicht enthält nach Sammel-Lauf für jedes erzeugte Kapitel eine Zeile (eine je Kapitel, unabhängig von der Version)", doc.getElementById("edito-files-tbody").querySelectorAll("tr").length === allChapterRows.length);
  check("Dokumenten-Übersicht-Zähler stimmt mit Zeilenanzahl überein", parseInt(doc.getElementById("edito-files-count").textContent, 10) === allChapterRows.length);

  // ===================== Version wechseln: Kapitelliste ändert sich, Auswahl wird geleert =====================
  fire(doc.getElementById("edito-select-all-btn"), "click");
  await wait(30);
  check("Vor Versionswechsel: Auswahl nicht leer (Vorbedingung)", doc.getElementById("edito-selection-count").textContent.trim() !== "0 Kapitel ausgewählt");
  versionSelect.value = "it";
  fire(versionSelect, "change");
  await wait(100);
  check("Nach Wechsel zu „IT“: Kapitel 7 (reines Retail-Ticket) nicht mehr enthalten", !rowFor("Kapitel 7"));
  check("Nach Versionswechsel: Checkbox-Auswahl geleert", doc.getElementById("edito-selection-count").textContent.trim() === "0 Kapitel ausgewählt");

  // ===================== Sitzung speichern/laden =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const sessionSavedBefore = savedFiles.length;
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(100);
  const sessionJson = savedFiles[sessionSavedBefore].data;
  const sessionData = JSON.parse(sessionJson);
  check("Gesicherte Sitzung enthält editoVersionKey", sessionData.editoVersionKey === "it");
  check("Gesicherte Sitzung enthält editoChapters mit erzeugtem Kapitel 7", !!Object.keys(sessionData.editoChapters).find((k) => k.includes("Kapitel 7")));

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(50);
  check("Nach „Alle Daten löschen“: Rolle/Sparte-Auswahl zurückgesetzt", doc.getElementById("edito-version-select").value === "");
  check("Nach „Alle Daten löschen“: Kapitel-Bereich wieder versteckt", doc.getElementById("edito-chapters-section").hidden === true);
  check("Nach „Alle Daten löschen“: Gesamtdokument-Vorschau wieder versteckt", doc.getElementById("edito-merge-preview-section").hidden === true);

  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [new win.File([sessionJson], "sitzung.json", { type: "application/json" })], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(50);
  check("Nach Sitzung-Laden: Rolle/Sparte-Auswahl wiederhergestellt", doc.getElementById("edito-version-select").value === "it");
  check("Nach Sitzung-Laden: Kapitel-Bereich wieder sichtbar", doc.getElementById("edito-chapters-section").hidden === false);

  // ===================== Ohne Rolle/Sparte: Sammel-Lauf zeigt Hinweis =====================
  const versionSelectAfterLoad = doc.getElementById("edito-version-select");
  versionSelectAfterLoad.value = "";
  fire(versionSelectAfterLoad, "change");
  await wait(50);
  fire(doc.getElementById("edito-generate-all-btn"), "click");
  await wait(50);
  check("Sammel-Lauf ohne Rolle/Sparte zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Bitte zuerst oben eine Rolle/Sparte wählen"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE EDITO-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
