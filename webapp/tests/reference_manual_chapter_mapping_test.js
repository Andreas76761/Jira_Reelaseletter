// Handbuch-Änderung nach Kapitel - Kapitel-Zuordnung (Teil 9c-2): jedes
// Kapitel eines importierten Referenz-Handbuchs (Teil 5b) bekommt einen
// automatischen Zuordnungsvorschlag zu einem App-Kapitel (Titel-Ähnlichkeit),
// der pro Zeile manuell überschreibbar ist. Prüft: sichtbar erst nach einem
// Upload, korrekter Vorschlag bei hoher Ähnlichkeit, bewusst LEERER
// Vorschlag bei zu geringer Ähnlichkeit (kein Raten), manuelle Korrektur
// bleibt erhalten, Umschalten zwischen mehreren Referenz-Handbüchern zeigt
// jeweils die richtige Zuordnungstabelle, Zustand übersteht "Alle Daten
// löschen".
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
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
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
async function uploadReferenceManual(doc, win, version, filename, bodyXml) {
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  const buf = await buildDocxBuffer(bodyXml);
  const file = new win.File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const fileInput = doc.getElementById("reference-manual-file-input");
  doc.getElementById("reference-manual-version-input").value = version;
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fire(fileInput, "change");
  await wait(300);
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

  // ===================== Vor jedem Upload: Bereich noch versteckt =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Zuordnungs-Bereich vor einem Upload versteckt", doc.getElementById("refcompare-controls").hidden === true);
  check("Leer-Hinweis vor einem Upload sichtbar", doc.getElementById("refcompare-empty").hidden === false);
  check("Zuordnungstabelle vor einem Upload versteckt", doc.getElementById("refcompare-mapping-wrap").hidden === true);

  // ===================== Upload mit einem eindeutig passenden und einem unbekannten Kapitel =====================
  // "Kapitel 7: Verträge im Alltag verwalten" ist ein real vorhandenes
  // App-Kapitel (outlineSeedData) - der Titel "Kapitel 99: Verträge im
  // Alltag verwalten" ist nach Entfernen des "Kapitel N:"-Präfixes
  // wortidentisch, sollte also einen zuverlässigen Auto-Vorschlag ergeben.
  const bodyXml =
    paragraphXml("Heading1", "Kapitel 99: Verträge im Alltag verwalten") +
    paragraphXml(null, "Text zum passenden Kapitel.") +
    paragraphXml("Heading1", "Kapitel 50: Voellig Unbekanntes Thema Xyzzy") +
    paragraphXml(null, "Text zu einem im App-Kapitelregister nicht vorhandenen Thema.");
  await uploadReferenceManual(doc, win, "Mapping-Test v1", "mapping_test_v1.docx", bodyXml);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Zuordnungs-Bereich nach Upload sichtbar", doc.getElementById("refcompare-controls").hidden === false);
  check("Leer-Hinweis nach Upload versteckt", doc.getElementById("refcompare-empty").hidden === true);
  check("Zuordnungstabelle nach Upload sichtbar", doc.getElementById("refcompare-mapping-wrap").hidden === false);

  const manualSelect = doc.getElementById("refcompare-manual-select");
  check("Referenz-Handbuch-Auswahl zeigt 1 Eintrag", manualSelect.options.length === 1);
  check("Auswahl nennt Versionsbezeichnung", manualSelect.options[0].textContent.includes("Mapping-Test v1"));

  let rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  check("Zuordnungstabelle zeigt 2 Zeilen (2 erkannte Kapitel)", rows.length === 2);
  check("Zeile 1 zeigt den Referenz-Kapiteltitel", rows[0] && rows[0].querySelectorAll("td")[0].textContent.includes("Kapitel 99: Verträge im Alltag verwalten"));
  const select1 = rows[0] && rows[0].querySelector(".refcompare-mapping-select");
  check("Zeile 1: Auto-Vorschlag trifft das passende App-Kapitel", !!select1 && select1.value === "Kapitel 7: Verträge im Alltag verwalten");

  const select2 = rows[1] && rows[1].querySelector(".refcompare-mapping-select");
  check("Zeile 2 zeigt den Referenz-Kapiteltitel (unbekanntes Thema)", rows[1] && rows[1].querySelectorAll("td")[0].textContent.includes("Xyzzy"));
  check("Zeile 2: KEIN Auto-Vorschlag bei zu geringer Ähnlichkeit (ehrlich, statt zu raten)", !!select2 && select2.value === "");
  check("Zeile 2: Auswahlfeld bietet trotzdem alle App-Kapitel zur manuellen Zuordnung an", !!select2 && select2.options.length > 5);

  // ===================== Manuelle Korrektur bleibt erhalten =====================
  select2.value = "Kapitel 1: Einführung und Überblick";
  fire(select2, "change");
  await wait(50);
  // Nach einem Re-Render (z. B. durch Kapitel-Generator-Aktivität) muss die
  // manuelle Zuordnung erhalten bleiben, statt vom Auto-Vorschlag erneut
  // überschrieben zu werden - Regressionstest gegen versehentliches
  // Re-Matching bei jedem renderRefCompareMapping()-Aufruf.
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  const select2Again = rows[1] && rows[1].querySelector(".refcompare-mapping-select");
  check("Manuelle Zuordnung bleibt nach Re-Render erhalten", !!select2Again && select2Again.value === "Kapitel 1: Einführung und Überblick");

  // ===================== Zweites Referenz-Handbuch: Umschalten zeigt jeweils passende Tabelle =====================
  const bodyXml2 = paragraphXml("Heading1", "Kapitel A: Nur im zweiten Handbuch") + paragraphXml(null, "Text.");
  await uploadReferenceManual(doc, win, "Mapping-Test v2", "mapping_test_v2.docx", bodyXml2);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Auswahl zeigt jetzt 2 Referenz-Handbücher", doc.getElementById("refcompare-manual-select").options.length === 2);
  // Neuester Upload (v2) ist automatisch aktiv ausgewählt.
  rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  check("Nach zweitem Upload: Tabelle zeigt automatisch dessen 1 Kapitel", rows.length === 1 && rows[0].textContent.includes("Nur im zweiten Handbuch"));

  // Zurück zum ersten Handbuch wechseln.
  const firstOption = Array.from(manualSelect.options).find((o) => o.textContent.includes("Mapping-Test v1"));
  manualSelect.value = firstOption.value;
  fire(manualSelect, "change");
  await wait(50);
  rows = Array.from(doc.querySelectorAll("#refcompare-mapping-tbody tr"));
  check("Zurück zu Handbuch v1: wieder 2 Zeilen mit der zuvor gesetzten manuellen Zuordnung", rows.length === 2);
  const select2AfterSwitch = rows[1] && rows[1].querySelector(".refcompare-mapping-select");
  check("Manuelle Zuordnung bleibt auch nach Handbuch-Wechsel hin und zurück erhalten", !!select2AfterSwitch && select2AfterSwitch.value === "Kapitel 1: Einführung und Überblick");

  // ===================== "Alle Daten löschen" leert auch die Zuordnungsansicht =====================
  // Der Löschen-Button lehnt einen Klick ohne jegliche Tickets/Imports ab
  // (reiner Hinweis-Toast statt Bestätigungsdialog, s. einstellungen_delete_test.js)
  // - hier ist der Ticket-Bestand seit dem "Alle Daten löschen" ganz am
  // Anfang weiterhin leer, daher zunächst ein minimales Ticket importieren.
  doc.querySelector('.nav-item[data-view="import"]').click();
  await wait(50);
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const minimalXml = `<?xml version="1.0"?><rss><channel><item><key>MAP-1</key><summary>Nur für Löschen-Test</summary><status>Offen</status><type>Task</type></item></channel></rss>`;
  const mainFileInput = doc.getElementById("file-input");
  Object.defineProperty(mainFileInput, "files", { value: [new win.File([minimalXml], "mapping_delete_helper.xml", { type: "application/xml" })], configurable: true });
  fire(mainFileInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Zuordnungs-Bereich wieder versteckt", doc.getElementById("refcompare-controls").hidden === true);
  check("Nach 'Alle Daten löschen': Leer-Hinweis wieder sichtbar", doc.getElementById("refcompare-empty").hidden === false);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KAPITEL-ZUORDNUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
