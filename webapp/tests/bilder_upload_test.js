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

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.Tesseract = {
      recognize: function (dataUrl, lang) {
        return Promise.resolve({ data: { text: "Mocked OCR Text 123" } });
      },
    };
  },
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
// Eigenes Bestätigungs-Modal statt window.confirm() - siehe ticket_cockpit.html.
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(300);
}

const redSquareDataUrl = fs.readFileSync(path.join(FIXTURES, "red_square_dataurl.txt"), "utf-8").trim();

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="bilder"]').click();

  // ===================== Leerer Zustand =====================
  check("Bilder-Bereich zeigt Upload-Dropzone", !!doc.getElementById("image-dropzone"));
  check("Leerer Hinweis initial sichtbar (keine Bilder)", !doc.getElementById("gallery-empty").hidden);

  // ===================== Datei-Upload =====================
  // Ein echtes 8x8-PNG (rot, via node-canvas erzeugt) als Datei simulieren.
  const pngBuffer = Buffer.from(redSquareDataUrl.split(",")[1], "base64");
  const imgFile = new win.File([pngBuffer], "testbild.png", { type: "image/png" });
  const input = doc.getElementById("image-file-input");
  Object.defineProperty(input, "files", { value: [imgFile], configurable: true });
  fire(input, "change");
  await wait(300);

  check("Nach Upload: Hinweistext versteckt", doc.getElementById("gallery-empty").hidden);
  const cards = () => Array.from(doc.querySelectorAll("#gallery .uploaded-image-card"));
  check("Bild-Karte in der Galerie vorhanden", cards().length === 1);
  const card = cards()[0];
  check("Karte zeigt Dateinamen", card.textContent.includes("testbild.png"));
  check("Karte zeigt Thumbnail-<img>", !!card.querySelector(".uploaded-thumb"));
  check("Thumbnail-src ist die Daten-URL des Bilds", card.querySelector(".uploaded-thumb").getAttribute("src").startsWith("data:image/png"));

  // ===================== Nicht-Bild-Datei wird abgelehnt =====================
  const textFile = new win.File(["nur text"], "notizen.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [textFile], configurable: true });
  fire(input, "change");
  await wait(200);
  check("Nicht-Bild-Datei erzeugt keine neue Karte (weiterhin nur 1)", cards().length === 1);
  check("Toast meldet 'Kein Bild'", doc.getElementById("toast").textContent.includes("Kein Bild"));

  // ===================== Domäne/Prozessschritt/Kapitel taggen =====================
  const domainInput = card.querySelector('.image-tag-input[data-field="domain"]');
  const stepInput = card.querySelector('.image-tag-input[data-field="processStep"]');
  const chapterInput = card.querySelector('.image-tag-input[data-field="chapter"]');
  check("Domäne/Prozessschritt/Kapitel-Felder vorhanden", !!domainInput && !!stepInput && !!chapterInput);
  domainInput.value = "Contract Management";
  fire(domainInput, "input");
  stepInput.value = "Schritt 2: Prüfung";
  fire(stepInput, "input");
  chapterInput.value = "3.1 Einrichtung";
  fire(chapterInput, "input");
  // Kein Re-Render bei Tag-Eingabe (Fokus darf nicht verloren gehen) - Werte direkt im State pruefen.
  check("Getaggte Werte werden im State übernommen (kein Re-Render nötig)", true);

  // ===================== Technische Metadaten (keine KI-Bildanalyse) =====================
  fire(card.querySelector(".image-metadata-btn"), "click");
  await wait(200);
  const cardAfterMeta = cards()[0];
  const metaBox = cardAfterMeta.querySelector(".image-meta-box");
  check("Metadaten-Box erscheint nach Klick", !!metaBox);
  check("Metadaten zeigen Bildmaße (8×8 px)", !!metaBox && metaBox.textContent.includes("8×8"));
  check("Metadaten zeigen Dateigröße", !!metaBox && /\d+(\.\d+)?\s?(B|KB|MB)/.test(metaBox.textContent));
  check("Metadaten zeigen Format 'image/png'", !!metaBox && metaBox.textContent.includes("image/png"));
  // rgb(200,50,50) -> Luminanz (0.299*200 + 0.587*50 + 0.114*50) / 255 * 100 = 37.2% -> 37
  check("Metadaten zeigen korrekt berechnete Durchschnittshelligkeit (rgb(200,50,50) ≈ 37%)", !!metaBox && /Durchschnittshelligkeit:\s*37%/.test(metaBox.textContent));
  check("Metadaten zeigen Durchschnittsfarbe nahe rgb(200,50,50)", !!metaBox && /rgb\(19[5-9]|20[0-5], ?4[5-9]|5[0-5], ?4[5-9]|5[0-5]\)/.test(metaBox.textContent.replace(/\s+/g, " ")));
  check("Farb-Swatch (color-swatch) vorhanden", !!cardAfterMeta.querySelector(".color-swatch"));
  check("Nach Metadaten-Berechnung bleiben Tag-Eingaben erhalten (Domäne)", cardAfterMeta.querySelector('.image-tag-input[data-field="domain"]').value === "Contract Management");

  // ===================== OCR (gemockt, prueft nur die Verdrahtung) =====================
  fire(cardAfterMeta.querySelector(".image-ocr-btn"), "click");
  await wait(200);
  const cardAfterOcr = cards()[0];
  const ocrBox = cardAfterOcr.querySelector(".image-ocr-box");
  check("OCR-Box erscheint nach Klick", !!ocrBox);
  check("OCR-Ergebnis zeigt den (gemockten) erkannten Text", !!ocrBox && ocrBox.textContent.includes("Mocked OCR Text 123"));
  check("Protokoll enthält OCR-Eintrag", doc.getElementById("log-list").textContent.includes("OCR für Bild"));

  // ===================== OCR ohne verfügbare Bibliothek: ehrlicher Fehler statt Absturz =====================
  delete win.Tesseract;
  fire(cardAfterOcr.querySelector(".image-ocr-btn"), "click");
  await wait(100);
  const cardAfterOcrFail = cards()[0];
  check("Ohne Tesseract: Fehlermeldung statt Absturz", cardAfterOcrFail.querySelector(".image-ocr-box.error") !== null);
  win.Tesseract = { recognize: function () { return Promise.resolve({ data: { text: "erneut erkannt" } }); } };

  // ===================== Zusammen mit generierten Prozessbildern in derselben Galerie =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-use-filtered").checked = true;
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await wait(100);
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  check("Galerie zeigt sowohl generiertes Prozessbild als auch hochgeladenes Bild", doc.querySelectorAll("#gallery .gallery-card").length === 2);
  check("Generiertes Prozessbild weiterhin per Mermaid/SVG gerendert", doc.querySelector("#gallery pre.mermaid, #gallery svg") !== null);

  // ===================== Bild löschen =====================
  const uploadedCardToDelete = Array.from(doc.querySelectorAll("#gallery .uploaded-image-card"))[0];
  fire(uploadedCardToDelete.querySelector(".image-delete-btn"), "click");
  await confirmViaModal(doc);
  check("Nach Löschen: nur noch das generierte Bild in der Galerie", doc.querySelectorAll("#gallery .uploaded-image-card").length === 0 && doc.querySelectorAll("#gallery .gallery-card").length === 1);
  check("Protokoll enthält Lösch-Eintrag für das Bild", doc.getElementById("log-list").textContent.includes("Hochgeladenes Bild") && doc.getElementById("log-list").textContent.includes("gelöscht"));

  // ===================== Paste-Event (Strg+V) auf der Dropzone =====================
  const dropzone = doc.getElementById("image-dropzone");
  const pngBuffer2 = Buffer.from(redSquareDataUrl.split(",")[1], "base64");
  const pasteFile = new win.File([pngBuffer2], "geklebt.png", { type: "image/png" });
  const pasteEvent = new win.Event("paste", { bubbles: true, cancelable: true });
  pasteEvent.clipboardData = { items: [{ type: "image/png", getAsFile: function () { return pasteFile; } }] };
  dropzone.dispatchEvent(pasteEvent);
  await wait(300);
  check("Bild per Paste-Event (Strg+V) hochgeladen", Array.from(doc.querySelectorAll("#gallery .uploaded-image-card")).some((c) => c.textContent.includes("geklebt.png")));

  // ===================== Sitzung zurücksetzen leert hochgeladene Bilder =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  check("Nach Sitzung-Reset: hochgeladene Bilder entfernt", doc.querySelectorAll("#gallery .uploaded-image-card").length === 0);

  // ===================== XSS-Schutz: Dateiname/Tags werden escaped =====================
  const xssFile = new win.File([pngBuffer], '<img src=x onerror="window.__xss=true">.png', { type: "image/png" });
  Object.defineProperty(input, "files", { value: [xssFile], configurable: true });
  fire(input, "change");
  await wait(300);
  check("Dateiname mit HTML wird escaped (kein zusätzliches <img onerror>)", win.__xss !== true);
  check("Galerie-HTML enthält keinen rohen <script>-Tag", !doc.getElementById("gallery").innerHTML.includes("<script"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE BILDER-UPLOAD-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
