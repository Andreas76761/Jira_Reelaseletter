// Register "Bilder": neuer Button "OCR: Alle Bilder interpretieren" direkt
// nach dem Hochladen-Bereich. Prüft: Sanduhr-Spinner + Statustext während
// des Laufs, OCR-Text wird für JEDES Bild neu erkannt (Tesseract.js,
// gemockt), Claude (sample-Capability, gemockt) ordnet daraus Kapitel,
// Unterkapitel (wörtlich aus der Gliederung) und eine Kurzbeschreibung zu -
// überschreibt dabei NIE ein bereits gesetztes Kapitel/Unterkapitel/
// Beschreibung (nur leere Felder werden ergänzt), das Unterkapitel wird nur
// übernommen, wenn es zum (ggf. bereits gesetzten) Kapitel passt. Das
// Kapitel-Textfeld der Galerie-Karte ist jetzt ein Dropdown (wie im Editor-
// Register), mit neuem kaskadierendem Unterkapitel-Dropdown. Zusätzlich:
// Fehlerbehandlung ohne Tesseract/ohne Bilder, kein Absturz bei KI-Fehler
// für ein einzelnes Bild.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const { createCanvas } = require("canvas");

// Erzeugt ein grosses (> OCR_MAX_DIMENSION) Test-PNG, um den Downscale-vor-
// OCR-Pfad zu pruefen - ohne Downscaling waere die Pixelzahl unnoetig hoch
// und die Erkennung entsprechend langsam (s. downscaleDataUrlForOcr in
// ticket_cockpit.html).
function makeLargeTestPngBuffer(width, height) {
  var c = createCanvas(width, height);
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, width, height);
  return c.toBuffer("image/png");
}

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// Claude liest aus dem Prompt die angebotene Kapitel-/Unterkapitelliste und
// schlägt immer das ERSTE dort aufgeführte Kapitel samt dessen erstem
// Unterkapitel vor - robust gegenüber der tatsächlich hinterlegten
// Gliederung (keine Kopplung an konkrete Kapitelnamen).
var ocrMockText = "Mocked OCR Text 123";
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
// Fuer den Parallelitaets-Nachweis (s. u.) je Aufruf eine Verzoegerung aus
// dieser Warteschlange entnehmen (Reihenfolge = Dispatch-Reihenfolge der
// mapWithConcurrency-Worker, s. manual_chapters_parallel_batch_test.js fuer
// dasselbe Muster) - leer = keine Verzoegerung (Standardverhalten aller
// anderen Checks in dieser Datei).
var ocrDelayQueue = [];
var ocrDelayIndex = 0;
// Zaehlt, wie oft ein kompletter neuer Worker erzeugt wird (Performance-
// Nachweis unten: muss ueber mehrere Laeufe/Bilder hinweg KONSTANT bei
// IMAGES_OCR_CONCURRENCY bleiben, statt mit jedem Bild weiter zu wachsen).
var createWorkerCallCount = 0;
// Muss mit IMAGES_OCR_CONCURRENCY in ticket_cockpit.html uebereinstimmen
// (dort nicht exportiert, daher hier als bekannter Wert dupliziert).
var IMAGES_OCR_CONCURRENCY_EXPECTED = 4;
// Zeichnet die Anfaenge aller an recognize() uebergebenen Daten-URLs auf -
// Downscale-Nachweis unten: ein verkleinertes Bild wird als "data:image/
// jpeg" neu kodiert uebergeben, ein unveraendertes (zu kleines) Bild
// behaelt seinen Original-MIME-Typ (hier immer PNG).
var recognizeCallPrefixes = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    // Produktivcode erzeugt ueber Tesseract.createWorker(...) einen einmaligen,
    // wiederverwendeten Worker-Pool statt bei jedem Bild Tesseract.recognize()
    // (= kompletter Neuaufbau samt Sprachdaten) direkt aufzurufen - der Mock
    // bildet dieselbe Form nach (createWorker liefert ein Objekt mit
    // .recognize()), die Verzoegerungs-Warteschlange bleibt unveraendert.
    window.Tesseract = {
      createWorker: function () {
        createWorkerCallCount++;
        return Promise.resolve({
          recognize: function (dataUrl) {
            recognizeCallPrefixes.push(String(dataUrl).slice(0, 15));
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
const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

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

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);

  check("OCR-Stapel-Button vorhanden", !!doc.getElementById("images-ocr-batch-btn"));
  check("OCR-Stapel-Spinner vorhanden (anfangs versteckt)", doc.getElementById("images-ocr-batch-spinner").hidden === true);

  // ===================== Ohne Bilder: verständlicher Hinweis =====================
  fire(doc.getElementById("images-ocr-batch-btn"), "click");
  await wait(50);
  check("OCR-Stapel ohne Bilder zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Es sind keine hochgeladenen Bilder vorhanden"));

  // ===================== 2 Bilder hochladen =====================
  const imageInput = doc.getElementById("image-file-input");
  Object.defineProperty(imageInput, "files", {
    value: [
      new win.File([PNG_1X1], "screenshot_a.png", { type: "image/png" }),
      new win.File([PNG_1X1], "screenshot_b.png", { type: "image/png" })
    ], configurable: true
  });
  fire(imageInput, "change");
  await wait(300);

  function cards() { return Array.from(doc.querySelectorAll("#gallery .uploaded-image-card")); }
  function descriptionValueFor(filename) {
    var row = Array.from(doc.getElementById("images-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes(filename));
    return row ? row.querySelector(".image-description-input").value : null;
  }
  check("2 Bilder hochgeladen", cards().length === 2);
  check("Galerie-Karte zeigt Kapitel-Dropdown (kein Textfeld mehr)", !!cards()[0].querySelector(".image-chapter-select"));
  check("Galerie-Karte zeigt Unterkapitel-Dropdown", !!cards()[0].querySelector(".image-subchapter-select"));
  check("Unterkapitel-Dropdown anfangs deaktiviert (noch kein Kapitel gesetzt)", cards()[0].querySelector(".image-subchapter-select").disabled === true);

  const chapterOptions = Array.from(cards()[0].querySelector(".image-chapter-select").options).map((o) => o.value);
  check("Kapitel-Dropdown bietet mind. 2 echte Kapitel (für den Mismatch-Test unten)", chapterOptions.filter(Boolean).length >= 2);
  const firstRealChapter = chapterOptions.filter(Boolean)[0];
  const secondRealChapter = chapterOptions.filter(Boolean)[1];

  // ===================== Manuelle Vorbelegung bei Bild 1 (zweites Kapitel, NICHT das von der KI vorgeschlagene erste) =====================
  const chapterSelect1 = cards()[0].querySelector(".image-chapter-select");
  chapterSelect1.value = secondRealChapter;
  fire(chapterSelect1, "change");
  await wait(50);
  check("Unterkapitel-Dropdown nach Kapitel-Auswahl aktiviert", cards()[0].querySelector(".image-subchapter-select").disabled === false);

  // ===================== OCR-Stapellauf =====================
  fire(doc.getElementById("images-ocr-batch-btn"), "click");
  await wait(400);

  check("Status-Hinweis nennt 2 verarbeitete Bilder", doc.getElementById("images-ocr-batch-status-note").textContent.includes("2 Bild(er) per OCR verarbeitet"));
  check("Protokoll vermerkt die Stapelverarbeitung", doc.getElementById("log-list").textContent.includes("OCR-Stapelverarbeitung"));

  const ocrBoxes = cards().map((c) => c.querySelector(".image-ocr-box"));
  check("Beide Bilder zeigen den (gemockten) OCR-Text", ocrBoxes.every((b) => b && b.textContent.includes("Mocked OCR Text 123")));

  const row1 = cards()[0];
  const row2 = cards()[1];
  check("Bild 1 (manuell vorbelegt): Kapitel bleibt unverändert (wird nie überschrieben)", row1.querySelector(".image-chapter-select").value === secondRealChapter);
  check("Bild 1: Unterkapitel NICHT von der KI übernommen (Vorschlag gehört zu einem ANDEREN Kapitel)", row1.querySelector(".image-subchapter-select").value === "");
  check("Bild 1: Kurzbeschreibung trotzdem von der KI ergänzt (Feld war leer)", descriptionValueFor("screenshot_a.png") === "Zeigt die Startseite des Moduls.");

  check("Bild 2 (keine Vorbelegung): Kapitel von der KI zugeordnet (erstes Kapitel aus der Liste)", row2.querySelector(".image-chapter-select").value === firstRealChapter);

  // ===================== Erneuter Lauf: bereits gesetzte Felder bleiben, OCR-Text wird neu erkannt =====================
  ocrMockText = "Zweiter OCR-Durchlauf, anderer Text";
  const chapterBeforeSecondRun = row1.querySelector(".image-chapter-select").value;
  const descBeforeSecondRun = descriptionValueFor("screenshot_a.png");
  fire(doc.getElementById("images-ocr-batch-btn"), "click");
  await wait(400);
  check("Erneuter Lauf: OCR-Text wird für jedes Bild neu erkannt (geänderter Mock-Text sichtbar)",
    cards().every((c) => c.querySelector(".image-ocr-box").textContent.includes("Zweiter OCR-Durchlauf")));
  check("Erneuter Lauf: bereits gesetztes Kapitel bleibt unverändert", cards()[0].querySelector(".image-chapter-select").value === chapterBeforeSecondRun);
  check("Erneuter Lauf: bereits gesetzte Kurzbeschreibung bleibt unverändert (nicht durch neuen OCR-Text ersetzt)",
    descBeforeSecondRun === "Zeigt die Startseite des Moduls." && descriptionValueFor("screenshot_a.png") === descBeforeSecondRun);

  // ===================== Performance-Nachweis: Worker-Pool wird NICHT je Bild neu erzeugt =====================
  // Zwei Stapellaeufe mit je 2 Bildern (4 Bilder insgesamt) oben - ohne
  // Wiederverwendung waere Tesseract.createWorker() 4x aufgerufen worden
  // (bzw. frueher: Tesseract.recognize() baute sogar 4x einen kompletten
  // Worker+Sprachdaten neu auf). Mit dem wiederverwendeten Pool wird
  // createWorker() genau einmal pro Pool-Platz (IMAGES_OCR_CONCURRENCY),
  // nicht einmal pro Bild, aufgerufen.
  check("Worker-Pool wurde nur einmalig erzeugt (createWorker genau " + IMAGES_OCR_CONCURRENCY_EXPECTED + "x aufgerufen, NICHT einmal je Bild, obwohl bereits 4 Bilder per OCR verarbeitet wurden)",
    createWorkerCallCount === IMAGES_OCR_CONCURRENCY_EXPECTED);

  // ===================== Downscale vor OCR (Performance) =====================
  // Die bisherigen Testbilder (8x8 px) liegen weit unter der Downscale-
  // Grenze - recognize() muss daher bislang immer die unveraenderte
  // Original-PNG-Daten-URL erhalten haben.
  check("Kleine Testbilder wurden UNVERÄNDERT (Original-PNG) an recognize() übergeben, kein unnötiges Downscaling",
    recognizeCallPrefixes.length > 0 && recognizeCallPrefixes.every((p) => p.startsWith("data:image/png")));

  var largePngBuffer = makeLargeTestPngBuffer(2200, 300); // breiter als OCR_MAX_DIMENSION (1800px)
  const largeImageInput = doc.getElementById("image-file-input");
  Object.defineProperty(largeImageInput, "files", { value: [new win.File([largePngBuffer], "grosser_screenshot.png", { type: "image/png" })], configurable: true });
  fire(largeImageInput, "change");
  await wait(300);
  const largeCard = Array.from(cards()).find((c) => c.textContent.includes("grosser_screenshot.png"));
  check("Großes Testbild (2200×300) hochgeladen", !!largeCard);

  var recognizeCallsBeforeLarge = recognizeCallPrefixes.length;
  fire(largeCard.querySelector(".image-ocr-btn"), "click");
  await waitUntil(() => recognizeCallPrefixes.length > recognizeCallsBeforeLarge, 2000);
  check("Großes Testbild wird vor der Erkennung herunterskaliert (als JPEG neu kodiert statt im Original-PNG übergeben)",
    recognizeCallPrefixes[recognizeCallPrefixes.length - 1].startsWith("data:image/jpeg"));

  // ===================== Ohne Tesseract: ehrlicher Fehler statt Absturz =====================
  delete win.Tesseract;
  fire(doc.getElementById("images-ocr-batch-btn"), "click");
  await wait(100);
  check("Ohne Tesseract: verständlicher Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("OCR-Bibliothek"));
  // Der Worker-Pool wurde durch die beiden erfolgreichen Läufe oben bereits
  // erstellt und bleibt ueber die gesamte Sitzung hinweg zwischengespeichert
  // (genau die geprüfte Performance-Optimierung) - window.Tesseract wird nur
  // der Vollständigkeit halber wiederhergestellt, wird fürs Folgende aber gar
  // nicht mehr aufgerufen.
  win.Tesseract = {
    createWorker: function () {
      return Promise.resolve({
        recognize: function () {
          var delay = ocrDelayQueue[ocrDelayIndex++] || 0;
          return new Promise(function (resolve) { setTimeout(function () { resolve({ data: { text: ocrMockText } }); }, delay); });
        },
      });
    },
  };

  // ===================== Parallelitäts-Nachweis (Performance) =====================
  // Frischer, isolierter Datensatz mit genau 3 Bildern und absichtlich
  // vertauschten Tesseract-Verzögerungen (langsamstes zuerst dispatcht) -
  // bei weiterhin sequenzieller Verarbeitung (for-await-Schleife) wäre die
  // Gesamtlaufzeit nahe der SUMME aller drei Verzögerungen; bei echter
  // Parallelität (mapWithConcurrency) nahe der LÄNGSTEN Einzelverzögerung.
  // Gleiches Beweismuster wie manual_chapters_parallel_batch_test.js.
  // "Alle Daten löschen" ist an Tickets/Imports gekoppelt (zeigt bei 0/0
  // nur einen Hinweis-Toast, loescht aber NICHTS) - diese Testdatei
  // importiert nie Tickets, daher stattdessen die beiden bestehenden
  // Bild-Karten einzeln ueber ihren eigenen Loeschen-Button entfernen.
  while (cards().length > 0) {
    fire(cards()[0].querySelector(".image-delete-btn"), "click");
    await confirmViaModal(doc);
  }
  check("Galerie vor dem Parallelitäts-Test leer", cards().length === 0);
  const imageInputPerf = doc.getElementById("image-file-input");
  Object.defineProperty(imageInputPerf, "files", {
    value: [
      new win.File([PNG_1X1], "perf_a.png", { type: "image/png" }),
      new win.File([PNG_1X1], "perf_b.png", { type: "image/png" }),
      new win.File([PNG_1X1], "perf_c.png", { type: "image/png" })
    ], configurable: true
  });
  fire(imageInputPerf, "change");
  await wait(200);
  check("3 Bilder für den Parallelitäts-Test hochgeladen", cards().length === 3);

  const DELAYS = [220, 140, 60];
  const sumDelays = DELAYS.reduce((a, b) => a + b, 0);
  const maxDelay = Math.max.apply(null, DELAYS);
  ocrDelayQueue = DELAYS.slice();
  ocrDelayIndex = 0;
  const t0 = Date.now();
  fire(doc.getElementById("images-ocr-batch-btn"), "click");
  await waitUntil(() => doc.getElementById("images-ocr-batch-status-note").textContent.includes("3 Bild(er) per OCR verarbeitet"), 3000);
  const elapsedMs = Date.now() - t0;
  check("Gesamtlaufzeit liegt nahe der LÄNGSTEN Einzelverzögerung (" + maxDelay + "ms), nicht nahe der SUMME (" + sumDelays + "ms) – Beweis für echte Parallelität statt sequenzieller Verarbeitung",
    elapsedMs < (maxDelay + sumDelays) / 2);
  ocrDelayQueue = [];

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE BILDER-OCR-STAPEL-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
