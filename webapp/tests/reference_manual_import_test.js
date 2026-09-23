// Referenz-Handbuch-Import (Teil 5b): ein bestehendes Word-Benutzerhandbuch
// (mit Versionsangabe) hochladen, OHNE dass daraus Jira-Tickets werden -
// bewusst getrennt vom normalen Ticket-Import (kein ingestTickets()-
// Aufruf, erscheint nicht in Dashboard/Verarbeitung). Prüft: Kapitel-
// Erkennung über Word-Formatvorlagen (Heading1/Heading2), Vorspann-
// Behandlung (Text vor der ersten Überschrift wird nicht verworfen, ein
// LEERER Vorspann aber schon), Pflichtfeld Versionsbezeichnung, mehrere
// gespeicherte Versionen, PII-Bereinigung des erkannten Kapiteltexts,
// Ablehnung von Nicht-.docx-Dateien, Löschen mit Bestätigungsdialog sowie
// Einbindung in Reset/Sitzung-speichern.
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

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
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
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// Baut ein minimales, aber echtes .docx (ZIP mit word/document.xml) - deckt
// Überschriften (w:pStyle Heading1/2), Fließtext und eine einfache Tabelle ab.
function paragraphXml(styleId, text) {
  var pr = styleId ? "<w:pPr><w:pStyle w:val=\"" + styleId + "\"/></w:pPr>" : "";
  return "<w:p>" + pr + "<w:r><w:t>" + xmlEsc(text) + "</w:t></w:r></w:p>";
}
function tableXml(rows) {
  var trs = rows.map(function (cells) {
    return "<w:tr>" + cells.map(function (c) {
      return "<w:tc><w:p><w:r><w:t>" + xmlEsc(c) + "</w:t></w:r></w:p></w:tc>";
    }).join("") + "</w:tr>";
  }).join("");
  return "<w:tbl>" + trs + "</w:tbl>";
}
async function buildDocxBuffer(bodyXml) {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyXml + "</w:body></w:document>";
  zip.file("word/document.xml", docXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

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

  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);

  // ===================== Neuer Bereich vorhanden, getrennt vom Ticket-Import =====================
  check("Referenz-Handbuch-Dropzone vorhanden", !!doc.getElementById("reference-manual-dropzone"));
  check("Versions-Eingabefeld vorhanden", !!doc.getElementById("reference-manual-version-input"));
  check("Leer-Hinweis anfangs sichtbar (noch kein Handbuch hochgeladen)", doc.getElementById("reference-manual-empty").hidden === false);
  check("Tabelle anfangs versteckt", doc.getElementById("reference-manual-table-wrap").hidden === true);

  const fileInput = doc.getElementById("reference-manual-file-input");

  // ===================== Upload ohne Versionsbezeichnung wird abgelehnt =====================
  const bodyXml1 =
    paragraphXml(null, "Vorspann-Text vor der ersten Überschrift.") +
    paragraphXml("Heading1", "Kapitel 7: Vertragsverwaltung") +
    paragraphXml(null, "Fließtext zu Kapitel 7, erster Absatz.") +
    paragraphXml("Heading2", "7.1 Vertragsverlängerung") +
    paragraphXml(null, "Unterkapitel-Text. Kontakt: max@example.com, Tel. +49 176 12345678.") +
    paragraphXml("Heading1", "Kapitel 12: Fuhrpark-Rückgabe") +
    tableXml([["Feld", "Wert"], ["Rückgabeort", "Werkstatt"]]) +
    paragraphXml(null, "Weiterer Text nach der Tabelle.");
  const buf1 = await buildDocxBuffer(bodyXml1);
  const file1 = new win.File([buf1], "Bestehendes_Handbuch_v3.2.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  Object.defineProperty(fileInput, "files", { value: [file1], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  let toast = doc.getElementById("toast");
  check("Upload ohne Versionsbezeichnung wird mit Fehlermeldung abgelehnt", toast.className.includes("error") && toast.textContent.includes("Versionsbezeichnung"));
  check("Ohne Version: weiterhin kein Eintrag in der Tabelle", doc.getElementById("reference-manual-empty").hidden === false);

  // ===================== Upload MIT Versionsbezeichnung: Kapitel-Erkennung inkl. Vorspann =====================
  doc.getElementById("reference-manual-version-input").value = "Handbuch v3.2 (Stand 2026-06)";
  Object.defineProperty(fileInput, "files", { value: [file1], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  toast = doc.getElementById("toast");
  check("Import-Erfolg-Toast (kein Fehler)", !toast.className.includes("error"));
  check("Toast meldet 4 erkannte Kapitel (Vorspann + 2x Heading1 + 1x Heading2)", /4 Kapitel/.test(toast.textContent));
  check("Tabelle jetzt sichtbar", doc.getElementById("reference-manual-table-wrap").hidden === false);
  check("Leer-Hinweis jetzt versteckt", doc.getElementById("reference-manual-empty").hidden === true);

  let row = doc.querySelector("#reference-manual-tbody tr");
  check("Zeile zeigt Versionsbezeichnung", !!row && row.textContent.includes("Handbuch v3.2"));
  check("Zeile zeigt Dateiname", !!row && row.textContent.includes("Bestehendes_Handbuch_v3.2.docx"));
  check("Zeile zeigt Kapitelanzahl 4", !!row && row.querySelectorAll("td")[2].textContent.trim() === "4");
  check("Versions-Eingabefeld nach erfolgreichem Import geleert", doc.getElementById("reference-manual-version-input").value === "");

  // ===================== Kein leeres Vorspann-Kapitel, wenn Dokument direkt mit Überschrift beginnt =====================
  const bodyXml2 = paragraphXml("Heading1", "Kapitel 1: Einführung") + paragraphXml(null, "Text ohne Vorspann.");
  const buf2 = await buildDocxBuffer(bodyXml2);
  const file2 = new win.File([buf2], "Handbuch_v1.0_Alt.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  doc.getElementById("reference-manual-version-input").value = "Handbuch v1.0 (Alt)";
  Object.defineProperty(fileInput, "files", { value: [file2], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  toast = doc.getElementById("toast");
  check("Zweiter Import erfolgreich", !toast.className.includes("error"));
  check("Zweiter Import: genau 1 Kapitel (kein leeres Vorspann-Kapitel gezählt)", /1 Kapitel/.test(toast.textContent));

  // ===================== Mehrere Versionen gleichzeitig gespeichert, neueste zuerst =====================
  const rows = Array.from(doc.querySelectorAll("#reference-manual-tbody tr"));
  check("2 Referenz-Handbücher in der Liste", rows.length === 2);
  check("Neuester Import (v1.0 Alt) steht oben", rows[0] && rows[0].textContent.includes("Handbuch v1.0 (Alt)"));
  check("Älterer Import (v3.2) steht darunter", rows[1] && rows[1].textContent.includes("Handbuch v3.2"));

  // ===================== NICHT im Dashboard/Verarbeitung sichtbar (kein Ticket-Import) =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(100);
  const dashboardText = doc.getElementById("table-body").textContent;
  check("Kapitelinhalt NICHT im Ticket-Dashboard sichtbar (kein Ticket-Import)", !dashboardText.includes("Vertragsverwaltung"));
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  await wait(100);
  const importsText = doc.getElementById("imports-tbody").textContent;
  check("Referenz-Handbuch NICHT in Dateiverwaltung (Ticket-Imports) gelistet", !importsText.includes("Bestehendes_Handbuch"));
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);

  // ===================== PII-Bereinigung greift auf den erkannten Kapiteltext (über Sitzung-Export geprüft) =====================
  // Sitzung-Export lehnt einen Export ohne jegliche Tickets/Imports ab -
  // "Alle Daten löschen" oben hat den Ticket-Bestand geleert, daher hier ein
  // minimales Ticket importieren, nur damit der Export-Button aktiv wird.
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const minimalXml = `<?xml version="1.0"?><rss><channel><item><key>REFMAN-1</key><summary>Nur für Export-Test</summary><status>Offen</status><type>Task</type></item></channel></rss>`;
  const mainFileInput = doc.getElementById("file-input");
  Object.defineProperty(mainFileInput, "files", { value: [new win.File([minimalXml], "refman_export_helper.xml", { type: "application/xml" })], configurable: true });
  fire(mainFileInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(300);
  check("Sitzung wurde exportiert", savedFiles.length >= 1);
  const exported = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("Export enthält referenceManuals", Array.isArray(exported.referenceManuals) && exported.referenceManuals.length === 2);
  const v32 = exported.referenceManuals.find((m) => m.version.includes("v3.2"));
  check("v3.2-Eintrag im Export vorhanden", !!v32);
  if (v32) {
    const allText = v32.chapters.map((c) => c.title + " " + c.text).join("\n");
    check("E-Mail-Adresse wurde aus dem Kapiteltext entfernt", !allText.includes("max@example.com") && allText.includes("[E-Mail entfernt]"));
    check("Telefonnummer wurde aus dem Kapiteltext entfernt", !allText.includes("176 12345678") && allText.includes("[Telefonnummer entfernt]"));
    check("Kapiteltitel 'Kapitel 7: Vertragsverwaltung' korrekt erkannt", v32.chapters.some((c) => c.title === "Kapitel 7: Vertragsverwaltung"));
    check("Unterkapitel-Titel '7.1 Vertragsverlängerung' korrekt erkannt (Heading2)", v32.chapters.some((c) => c.title === "7.1 Vertragsverlängerung"));
    check("Tabellenzeile aus Kapitel 12 als Zeile im Fließtext enthalten", v32.chapters.some((c) => c.text.includes("Rückgabeort\tWerkstatt")));
    check("Vorspann-Kapitel mit eigenem Titel vorhanden", v32.chapters.some((c) => c.title.indexOf("Vorspann") === 0));
  }

  // ===================== Löschen mit Bestätigungsdialog =====================
  const delBtn = doc.querySelector(".reference-manual-delete-btn");
  check("Löschen-Button in der Zeile vorhanden", !!delBtn);
  fire(delBtn, "click");
  await confirmViaModal(doc);
  check("Nach Löschen: nur noch 1 Referenz-Handbuch", doc.querySelectorAll("#reference-manual-tbody tr").length === 1);

  // ===================== Nur echtes .docx akzeptiert (HTML-getarnte .doc wird abgelehnt) =====================
  const htmlDisguised = "<html><body>Kein echtes docx, nur HTML mit .doc-Endung.</body></html>";
  const htmlFile = new win.File([htmlDisguised], "getarnt_als_word.doc", { type: "application/msword" });
  doc.getElementById("reference-manual-version-input").value = "Sollte scheitern";
  Object.defineProperty(fileInput, "files", { value: [htmlFile], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  toast = doc.getElementById("toast");
  check("HTML-getarnte .doc-Datei wird mit verständlicher Fehlermeldung abgelehnt", toast.className.includes("error") && toast.textContent.includes("docx"));
  check("Nach fehlgeschlagenem Import: weiterhin nur 1 Referenz-Handbuch", doc.querySelectorAll("#reference-manual-tbody tr").length === 1);

  // ===================== Legacy .doc (altes Binärformat) wird ehrlich abgelehnt =====================
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  const legacyDocFile = new win.File([oleHeader], "altes_handbuch.doc", { type: "application/msword" });
  doc.getElementById("reference-manual-version-input").value = "Legacy-Test";
  Object.defineProperty(fileInput, "files", { value: [legacyDocFile], configurable: true });
  fire(fileInput, "change");
  await wait(300);
  toast = doc.getElementById("toast");
  check("Altes .doc-Binärformat wird mit verständlicher Fehlermeldung abgelehnt", toast.className.includes("error") && toast.textContent.includes(".doc"));

  // ===================== "Alle Daten löschen" leert auch die Referenz-Handbuch-Liste =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Referenz-Handbuch-Liste leer", doc.getElementById("reference-manual-empty").hidden === false);
  check("Nach 'Alle Daten löschen': Tabelle wieder versteckt", doc.getElementById("reference-manual-table-wrap").hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE REFERENZ-HANDBUCH-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
