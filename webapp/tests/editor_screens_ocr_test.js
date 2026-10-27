// Register "Screens-Import" (data-view="editor"): neuer Button "OCR: Alle
// Screens interpretieren" (zusätzlich zum bestehenden, rein auf dem
// Bildtext basierenden "KI-Vorschlag für Kapitel-Zuordnung"). Prüft:
// erkennt per OCR (Tesseract.js, gemockt) den auf dem Screenshot
// sichtbaren Text, lässt Claude (gemockt) daraus Kapitel, Unterkapitel UND
// Kurzbeschreibung vorschlagen (dieselben Prompt-/Parse-Funktionen wie im
// Register "Bilder", s. bilder_ocr_batch_test.js), überschreibt dabei NIE
// ein bereits gesetztes Feld, läuft mit mehreren parallelen Worker-Spuren
// (Performance: nicht strikt sequenziell), zielt NUR auf Screens
// (sourceFile vorhanden) statt auf alle hochgeladenen Bilder, und
// Fehlerbehandlung ohne Tesseract/ohne Screens.
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

// Claude liest aus dem Prompt die angebotene Kapitel-/Unterkapitelliste und
// schlägt immer das ERSTE dort aufgeführte Kapitel samt dessen erstem
// Unterkapitel vor - robust gegenüber der tatsächlich hinterlegten
// Gliederung (gleiches Muster wie bilder_ocr_batch_test.js).
var ocrMockText = "Mocked Screen OCR Text";
function sampleImplFactory() {
  return async function (promptText) {
    var m = /Verfügbare Gliederungskapitel[^\n]*\n((?:- .+\n?)+)/.exec(promptText || "");
    var firstChapter = "keines", firstSub = "keines";
    if (m) {
      var firstLine = m[1].split("\n")[0].replace(/^- /, "").trim();
      var parts = firstLine.split(" | Unterkapitel: ");
      firstChapter = parts[0];
      if (parts[1]) firstSub = parts[1].split("; ")[0];
    }
    return { text: "Kapitel: " + firstChapter + "\nUnterkapitel: " + firstSub + "\nKurzbeschreibung: Zeigt die Startseite des Moduls.", truncated: false, modelTierApplied: "default" };
  };
}
let sampleImpl = sampleImplFactory();
var ocrDelayQueue = [];
var ocrDelayIndex = 0;
var createWorkerCallCount = 0;
var IMAGES_OCR_CONCURRENCY_EXPECTED = 4;
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.Tesseract = {
      createWorker: function () {
        createWorkerCallCount++;
        return Promise.resolve({
          recognize: function () {
            var delay = ocrDelayQueue[ocrDelayIndex++] || 0;
            return new Promise(function (resolve) { setTimeout(function () { resolve({ data: { text: ocrMockText } }); }, delay); });
          },
        });
      },
    };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(15);
  }
  return false;
}
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
// "Alle Daten löschen" ist ein No-Op (nur Hinweis-Toast statt echtem
// Löschen), solange 0 Tickets/0 Imports vorliegen (Guard unabhängig von
// diesem Feature, s. els.deleteAllDataBtn-Handler) - dieser Dummy-Import
// sorgt dafür, dass der Reset weiter unten im Test auch wirklich greift.
const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>SCR-1</key><summary>Testticket für Reset-Guard</summary>
    <description>Dummy-Ticket, nur damit "Alle Daten löschen" nicht wegen 0 Tickets no-opt.</description>
    <status>Offen</status><type>Task</type></item>
</channel></rss>`;
const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

// Verallgemeinerte Fassung der Fixture aus editor_screens_test.js: N Screens
// mit je einer Ueberschrift als Bildtext (Standard: 2, wie dort).
async function buildDocxWithScreens(n) {
  n = n || 2;
  var zip = new JSZipNode();
  var body = "", rels = "";
  for (var i = 1; i <= n; i++) {
    body += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Screen ' + i + '</w:t></w:r></w:p>' +
      '<w:p><w:r><w:drawing><a:blip r:embed="rId' + i + '"/></w:drawing></w:r></w:p>';
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG_1X1);
  }
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' + body + "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  global.__t0 = Date.now();
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
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "editor_screens_ocr_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);

  check("OCR-Button (Screens-Import) vorhanden", !!doc.getElementById("editor-ocr-batch-btn"));
  check("OCR-Spinner vorhanden (anfangs versteckt)", doc.getElementById("editor-ocr-batch-spinner").hidden === true);

  // ===================== Ohne Screens: verständlicher Hinweis =====================
  fire(doc.getElementById("editor-ocr-batch-btn"), "click");
  await wait(50);
  check("OCR ohne Screens zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("keine extrahierten Screens vorhanden"));

  // ===================== .docx mit 2 Screens hochladen =====================
  const docxBuf = await buildDocxWithScreens();
  const docxFile = new win.File([docxBuf], "screens.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const editorFileInput = doc.getElementById("editor-file-input");
  Object.defineProperty(editorFileInput, "files", { value: [docxFile], configurable: true });
  fire(editorFileInput, "change");
  await waitUntil(() => doc.querySelectorAll("#editor-screens-tbody tr").length === 2, 2000);
  check("2 Screens extrahiert", doc.querySelectorAll("#editor-screens-tbody tr").length === 2);

  // Zweiten Screen bereits VORAB manuell einem (zweiten) Kapitel zuordnen,
  // um die "nie ueberschreiben"-Regel zu pruefen.
  const chapterSelects = doc.querySelectorAll(".editor-screen-chapter-select");
  const manualChapterValue = chapterSelects[1].options[2] ? chapterSelects[1].options[2].value : chapterSelects[1].options[1].value;
  chapterSelects[1].value = manualChapterValue;
  fire(chapterSelects[1], "change");
  await wait(50);

  // ===================== OCR-Stapel ausführen =====================
  fire(doc.getElementById("editor-ocr-batch-btn"), "click");
  const done = await waitUntil(() => doc.getElementById("editor-ocr-batch-spinner").hidden === true, 3000);
  check("OCR-Lauf abgeschlossen (Spinner wieder versteckt)", done);

  const rows = Array.from(doc.querySelectorAll("#editor-screens-tbody tr"));
  const chapterSelAfter = rows.map((r) => r.querySelector(".editor-screen-chapter-select"));
  check("Screen 1 (zuvor ohne Kapitel): jetzt per OCR+KI zugeordnet", !!chapterSelAfter[0].value);
  check("Screen 2 (bereits manuell zugeordnet): Kapitel NICHT überschrieben", chapterSelAfter[1].value === manualChapterValue);
  check("Statuszeile vermerkt Abschluss", doc.getElementById("editor-ocr-batch-status-note").textContent.includes("per OCR verarbeitet"));
  check("Protokoll vermerkt die OCR-Stapelverarbeitung", doc.getElementById("log-list").textContent.includes("Screens-Import: OCR-Stapelverarbeitung"));
  check("Bilder-Register zeigt denselben (nicht duplizierten) Bestand", doc.querySelectorAll("#images-tbody tr").length === 2);

  // ===================== Ohne Tesseract: verständlicher Hinweis =====================
  const realTesseract = win.Tesseract;
  win.Tesseract = undefined;
  fire(doc.getElementById("editor-ocr-batch-btn"), "click");
  await wait(50);
  check("Ohne Tesseract: verständlicher Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Internetzugriff erforderlich"));
  win.Tesseract = realTesseract;

  // ===================== Parallelität: Gesamtlaufzeit nahe der laengsten Einzelverzoegerung =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);
  const docxBuf2 = await buildDocxWithScreens(3);
  const docxFile2 = new win.File([docxBuf2], "screens2.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const editorFileInput2 = doc.getElementById("editor-file-input");
  Object.defineProperty(editorFileInput2, "files", { value: [docxFile2], configurable: true });
  fire(editorFileInput2, "change");
  await waitUntil(() => doc.querySelectorAll("#editor-screens-tbody tr").length === 3, 2000);
  check("Nach Reset + Upload genau 3 Screens (keine Reste aus vorherigem Durchlauf)", doc.querySelectorAll("#editor-screens-tbody tr").length === 3);

  // Dieselben drei Verzögerungen und dieselbe Mittelwert-Schwelle wie
  // bilder_ocr_batch_test.js (s. dort) - bei nur 2 Bildern/kleinem
  // Delay-Abstand verschwimmt das Signal zu stark mit dem (nicht
  // parallelitätsabhängigen) Dekodier-Overhead von downscaleDataUrlForOcr.
  const DELAYS = [220, 140, 60];
  const sumDelays = DELAYS.reduce((a, b) => a + b, 0);
  const maxDelay = Math.max.apply(null, DELAYS);
  ocrDelayQueue = DELAYS.slice();
  ocrDelayIndex = 0;
  const startedAt = Date.now();
  fire(doc.getElementById("editor-ocr-batch-btn"), "click");
  await wait(50);
  check("Spinner während eines messbar langen Laufs sichtbar", doc.getElementById("editor-ocr-batch-spinner").hidden === false);
  await waitUntil(() => doc.getElementById("editor-ocr-batch-spinner").hidden === true, 3000);
  const elapsedMs = Date.now() - startedAt;
  check("Gesamtlaufzeit liegt nahe der LÄNGSTEN Einzelverzögerung (" + maxDelay + "ms), nicht nahe der SUMME (" + sumDelays + "ms) – Beweis für echte Parallelität statt sequenzieller Verarbeitung",
    elapsedMs < (maxDelay + sumDelays) / 2);
  check("Wiederverwendeter Worker-Pool: nicht mehr als IMAGES_OCR_CONCURRENCY Worker insgesamt erzeugt", createWorkerCallCount <= IMAGES_OCR_CONCURRENCY_EXPECTED);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE SCREENS-IMPORT-OCR-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
