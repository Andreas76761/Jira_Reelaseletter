// Gliederung aus Word-Dokument hochladen (Einstellungen -> Benutzerhandbuch-
// Gliederung): ersetzt app.outline komplett anhand der Word-Formatvorlagen
// ("Überschrift 1"/Heading1 = Kapitel, "Überschrift 2"/Heading2 =
// Unterkapitel) - mit Sicherheitsabfrage (Vorschau der erkannten Kapitel,
// abbrechbar) und automatischer Bereinigung aller an die ALTEN Kapiteltitel
// gebundenen Datensätze (Benutzerhandbuch-Kapitel-Generator-Ergebnisse).
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

let sampleImpl = async () => ({ text: "Generierter Kapiteltext.", truncated: false, modelTierApplied: "default" });
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
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
async function cancelViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-cancel-btn"), "click");
  await wait(50);
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
  <item><key>OUT-1</key><summary>Vertrag anlegen</summary><description>Beschreibung OUT-1.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
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

  // ===================== (1) Ausgangszustand: Standard-Gliederung, Upload-Button vorhanden =====================
  check("(1) Upload-Button vorhanden", !!doc.getElementById("outline-upload-btn"));
  check("(1) Standard-Gliederung enthält 'Kapitel 1: Einführung und Überblick'",
    doc.getElementById("outline-tbody").textContent.includes("Kapitel 1: Einführung und Überblick"));

  // ===================== (2) Vorbereitung: 1 Ticket importieren + 1 Benutzerhandbuch-Kapitel erzeugen,
  // damit sich spaeter zeigen laesst, dass ein Gliederungs-Ersatz es wieder leert =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const fileInput = doc.getElementById("file-input");
  Object.defineProperty(fileInput, "files", { value: [new win.File([xml], "outtest.xml", { type: "application/xml" })], configurable: true });
  fire(fileInput, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 3000);
  await wait(50);
  check("(2) Benutzerhandbuch-Kapitel wurde vor dem Gliederungs-Ersatz erzeugt",
    !doc.getElementById("manual-chapters-empty").hidden === false);

  // ===================== (3) Upload OHNE jegliche Überschrift: wird mit Hinweis abgelehnt, kein Dialog =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const noHeadingBuf = await buildDocxBuffer(paragraphXml(null, "Nur Fließtext ohne jede Überschrift."));
  const noHeadingFile = new win.File([noHeadingBuf], "ohne_ueberschrift.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const outlineInput = doc.getElementById("outline-upload-input");
  Object.defineProperty(outlineInput, "files", { value: [noHeadingFile], configurable: true });
  fire(outlineInput, "change");
  await wait(200);
  check("(3) Ohne Überschriften: Hinweistoast statt Bestätigungsdialog", doc.getElementById("confirm-modal-overlay").hidden &&
    doc.getElementById("toast").textContent.includes("Keine Kapitel erkannt"));

  // ===================== (4) Upload MIT Kapiteln: Bestätigungsdialog zeigt Vorschau, ABBRECHEN lässt Gliederung unverändert =====================
  const bodyXml =
    paragraphXml("Heading1", "Kapitel A: Testkapitel") +
    paragraphXml(null, "Fließtext zu Kapitel A.") +
    paragraphXml("Heading2", "A.1 Unterkapitel Eins") +
    paragraphXml("Heading1", "Kapitel B: Zweites Testkapitel");
  const buf = await buildDocxBuffer(bodyXml);
  const file = new win.File([buf], "Neue_Gliederung.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  Object.defineProperty(outlineInput, "files", { value: [file], configurable: true });
  fire(outlineInput, "change");
  await wait(200);
  check("(4) Bestätigungsdialog zeigt Anzahl '2 Kapitel (1 Unterkapitel)'",
    doc.getElementById("confirm-modal-message").textContent.includes("2 Kapitel (1 Unterkapitel)"));
  check("(4) Bestätigungsdialog listet 'Kapitel A: Testkapitel' in der Vorschau",
    doc.getElementById("confirm-modal-message").textContent.includes("Kapitel A: Testkapitel"));
  await cancelViaModal(doc);
  check("(4) Nach Abbrechen: Standard-Gliederung weiterhin unverändert ('Kapitel 1' noch vorhanden)",
    doc.getElementById("outline-tbody").textContent.includes("Kapitel 1: Einführung und Überblick"));

  // ===================== (5) Erneuter Upload, diesmal BESTÄTIGT: Gliederung komplett ersetzt =====================
  Object.defineProperty(outlineInput, "files", { value: [file], configurable: true });
  fire(outlineInput, "change");
  await confirmViaModal(doc);
  check("(5) Neue Gliederung zeigt 'Kapitel A: Testkapitel'", doc.getElementById("outline-tbody").textContent.includes("Kapitel A: Testkapitel"));
  check("(5) Neue Gliederung zeigt Unterkapitel 'A.1 Unterkapitel Eins'", doc.getElementById("outline-tbody").textContent.includes("A.1 Unterkapitel Eins"));
  check("(5) Neue Gliederung zeigt 'Kapitel B: Zweites Testkapitel'", doc.getElementById("outline-tbody").textContent.includes("Kapitel B: Zweites Testkapitel"));
  check("(5) ALTE Standard-Gliederung ('Kapitel 1: Einführung und Überblick') ist verschwunden",
    !doc.getElementById("outline-tbody").textContent.includes("Kapitel 1: Einführung und Überblick"));
  check("(5) Protokoll vermerkt den Ersatz", doc.getElementById("log-list").textContent.includes("Gliederung aus"));
  check("(5) Erfolgstoast", !doc.getElementById("toast").className.includes("error") && doc.getElementById("toast").textContent.includes("Gliederung ersetzt"));

  // ===================== (6) Vorher erzeugtes Benutzerhandbuch-Kapitel wurde geleert (alter Titel ungültig) =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  check("(6) Benutzerhandbuch-Kapitel-Liste nach Gliederungs-Ersatz wieder leer",
    doc.getElementById("manual-chapters-empty").hidden === false);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE GLIEDERUNGS-UPLOAD-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
