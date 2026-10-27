// Register "Bilder": Klick auf die Vorschau eines hochgeladenen Bildes
// (Galerie-Karte oder Tabellenzeile) öffnet es in einem frei beweglichen,
// größenveränderbaren Vollbild-Fenster (kein blockierendes Modal). Prüft:
// Fenster öffnet mit korrekter Canvas-Größe/Titel, Verschieben per
// Titelleiste (Drag), Verwischen-Werkzeug (Rechteck-Auswahl per Maus ->
// Pixelation des Bereichs), "Letzten Bereich entfernen" (Undo),
// "Speichern" (ersetzt dauerhaft img.dataUrl, Original bleibt unter
// originalDataUrl erhalten), "Original wiederherstellen", Schließen per
// Button und per Escape.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const { createCanvas } = require("canvas");

// 40x40-Testbild: linke Hälfte reines Rot, rechte Hälfte reines Blau - eine
// Auswahl, die über die Farbgrenze hinweg verpixelt wird, macht den Effekt
// eindeutig nachweisbar (zwei vorher unterschiedliche Pixel im selben
// 10x10-Block werden nach der Pixelation zu EXAKT derselben Mischfarbe).
function makeHalfRedHalfBluePng() {
  var c = createCanvas(40, 40);
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 20, 40);
  ctx.fillStyle = "#0000ff"; ctx.fillRect(20, 0, 20, 40);
  return c.toBuffer("image/png");
}

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.claude = { use: function () { return Promise.resolve(null); } };
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
function fire(el, type, props) { el.dispatchEvent(new dom.window.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, props || {}))); }
async function confirmViaModal(doc) {
  await wait(30);
  fire2(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
function fire2(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
const PNG_HALF_RED_BLUE = makeHalfRedHalfBluePng();

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire2(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  await wait(100);

  // ===================== Bild hochladen =====================
  const imageInput = doc.getElementById("image-file-input");
  Object.defineProperty(imageInput, "files", { value: [new win.File([PNG_HALF_RED_BLUE], "halbe_farben.png", { type: "image/png" })], configurable: true });
  fire2(imageInput, "change");
  await wait(300);
  check("Bild hochgeladen", doc.querySelectorAll("#gallery .uploaded-image-card").length === 1);

  // ===================== Vorschau öffnet Vollbild-Fenster =====================
  check("Vollbild-Fenster anfangs versteckt", doc.getElementById("image-viewer-window").hidden === true);
  const thumb = doc.querySelector('#gallery [data-img-view]');
  check("Vorschaubild mit data-img-view vorhanden", !!thumb);
  fire2(thumb, "click");
  await wait(50);
  check("Vollbild-Fenster jetzt sichtbar", doc.getElementById("image-viewer-window").hidden === false);
  check("Fenstertitel nennt den Dateinamen", doc.getElementById("image-viewer-title").textContent === "halbe_farben.png");
  const canvas = doc.getElementById("image-viewer-canvas");
  check("Canvas-Größe entspricht der Bildgröße (40×40)", canvas.width === 40 && canvas.height === 40);
  check("Speichern-/Rückgängig-Button vor jeder Verwischung versteckt", doc.getElementById("image-viewer-save-btn").hidden === true && doc.getElementById("image-viewer-blur-undo-btn").hidden === true);
  check("'Original wiederherstellen' vor jeder Verwischung versteckt (noch kein Original gespeichert)", doc.getElementById("image-viewer-restore-btn").hidden === true);

  // 1:1-Skalierung erzwingen, damit CSS-Pixel == Canvas-Pixel (jsdom liefert
  // sonst width/height 0 bei getBoundingClientRect, da kein echtes Layout).
  canvas.getBoundingClientRect = function () { return { left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }; };

  const ctx = canvas.getContext("2d");
  const beforeLeft = ctx.getImageData(16, 20, 1, 1).data;
  const beforeRight = ctx.getImageData(24, 20, 1, 1).data;
  check("Vor Verwischung: Pixel links ist Rot, rechts ist Blau (unterschiedlich)",
    beforeLeft[0] > 200 && beforeLeft[2] < 50 && beforeRight[2] > 200 && beforeRight[0] < 50);

  // ===================== Rechteck-Auswahl ziehen (15,15) -> (35,35), straddlet die Farbgrenze =====================
  fire(canvas, "mousedown", { clientX: 15, clientY: 15 });
  await wait(10);
  check("Auswahl-Box während des Ziehens sichtbar", doc.getElementById("image-viewer-select-box").hidden === false);
  fire(doc.getElementById("image-viewer-body"), "mousemove", { clientX: 35, clientY: 35 });
  await wait(10);
  fire(doc.getElementById("image-viewer-body"), "mouseup", { clientX: 35, clientY: 35 });
  await wait(10);
  check("Auswahl-Box nach dem Loslassen wieder versteckt", doc.getElementById("image-viewer-select-box").hidden === true);
  check("Nach Verwischung: Speichern-Button sichtbar", doc.getElementById("image-viewer-save-btn").hidden === false);
  check("Nach Verwischung: 'Letzten Bereich entfernen'-Button sichtbar", doc.getElementById("image-viewer-blur-undo-btn").hidden === false);

  const afterLeft = ctx.getImageData(16, 20, 1, 1).data;
  const afterRight = ctx.getImageData(24, 20, 1, 1).data;
  check("Verwischter Bereich: vorher unterschiedliche Pixel (Block 15-24) sind jetzt IDENTISCH (Mischfarbe)",
    afterLeft[0] === afterRight[0] && afterLeft[1] === afterRight[1] && afterLeft[2] === afterRight[2]);
  check("Verwischter Bereich ist weder reines Rot noch reines Blau (echte Mischung, kein No-Op)",
    !(afterLeft[0] > 200 && afterLeft[2] < 50) && !(afterLeft[2] > 200 && afterLeft[0] < 50));
  const outsidePixel = ctx.getImageData(2, 2, 1, 1).data;
  check("Bereich AUSSERHALB der Auswahl bleibt unverändert (weiterhin reines Rot)", outsidePixel[0] > 200 && outsidePixel[2] < 50);

  // ===================== Undo stellt den Bereich wieder her =====================
  fire2(doc.getElementById("image-viewer-blur-undo-btn"), "click");
  await wait(10);
  const undoneLeft = ctx.getImageData(16, 20, 1, 1).data;
  const undoneRight = ctx.getImageData(24, 20, 1, 1).data;
  check("Nach 'Letzten Bereich entfernen': Originalfarben wiederherstellt", undoneLeft[0] > 200 && undoneLeft[2] < 50 && undoneRight[2] > 200 && undoneRight[0] < 50);
  check("Speichern-Button bleibt nach Undo sichtbar (Undo leert nur den Verlauf, ändert den Button-Status nicht)", doc.getElementById("image-viewer-save-btn").hidden === false);

  // ===================== Erneut verwischen und speichern =====================
  fire(canvas, "mousedown", { clientX: 15, clientY: 15 });
  fire(doc.getElementById("image-viewer-body"), "mousemove", { clientX: 35, clientY: 35 });
  fire(doc.getElementById("image-viewer-body"), "mouseup", { clientX: 35, clientY: 35 });
  await wait(10);
  const dataUrlBeforeSave = canvas.toDataURL();
  fire2(doc.getElementById("image-viewer-save-btn"), "click");
  await wait(50);

  check("Protokoll vermerkt das Verwischen", doc.getElementById("log-list").textContent.includes("verwischt"));
  check("Toast bestätigt das Speichern", doc.getElementById("toast").textContent.includes("Gespeichert"));
  check("'Original wiederherstellen' jetzt sichtbar", doc.getElementById("image-viewer-restore-btn").hidden === false);

  // ===================== Fenster schließen + erneut öffnen: Bild bleibt verwischt =====================
  fire2(doc.getElementById("image-viewer-close-btn"), "click");
  await wait(20);
  check("Fenster nach Schließen-Button versteckt", doc.getElementById("image-viewer-window").hidden === true);

  const thumbAfterSave = doc.querySelector('#gallery [data-img-view]');
  fire2(thumbAfterSave, "click");
  await wait(50);
  const canvas2 = doc.getElementById("image-viewer-canvas");
  canvas2.getBoundingClientRect = function () { return { left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }; };
  const reopenedLeft = canvas2.getContext("2d").getImageData(16, 20, 1, 1).data;
  const reopenedRight = canvas2.getContext("2d").getImageData(24, 20, 1, 1).data;
  check("Nach erneutem Öffnen: verwischter Bereich bleibt dauerhaft verwischt (gespeichert)",
    reopenedLeft[0] === reopenedRight[0] && reopenedLeft[1] === reopenedRight[1] && reopenedLeft[2] === reopenedRight[2]);
  check("'Original wiederherstellen' bleibt nach erneutem Öffnen sichtbar", doc.getElementById("image-viewer-restore-btn").hidden === false);

  // ===================== Escape schließt das Fenster =====================
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(20);
  check("Escape schließt das Vollbild-Fenster", doc.getElementById("image-viewer-window").hidden === true);

  // ===================== Original wiederherstellen =====================
  fire2(thumbAfterSave, "click");
  await wait(50);
  fire2(doc.getElementById("image-viewer-restore-btn"), "click");
  await confirmViaModal(doc);
  await wait(50);
  check("Toast bestätigt die Wiederherstellung", doc.getElementById("toast").textContent.includes("Wiederhergestellt"));
  const canvas3 = doc.getElementById("image-viewer-canvas");
  canvas3.getBoundingClientRect = function () { return { left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }; };
  const restoredLeft = canvas3.getContext("2d").getImageData(16, 20, 1, 1).data;
  const restoredRight = canvas3.getContext("2d").getImageData(24, 20, 1, 1).data;
  check("Nach Wiederherstellung: Originalfarben (Rot/Blau) wieder sichtbar", restoredLeft[0] > 200 && restoredLeft[2] < 50 && restoredRight[2] > 200 && restoredRight[0] < 50);
  check("'Original wiederherstellen' nach Wiederherstellung wieder versteckt", doc.getElementById("image-viewer-restore-btn").hidden === true);

  // ===================== Fenster frei verschiebbar (Drag per Titelleiste) =====================
  const windowEl = doc.getElementById("image-viewer-window");
  windowEl.getBoundingClientRect = function () { return { left: 100, top: 80, width: 600, height: 500, right: 700, bottom: 580 }; };
  const titlebar = doc.getElementById("image-viewer-titlebar");
  fire(titlebar, "mousedown", { clientX: 150, clientY: 90 });
  await wait(10);
  fire(doc, "mousemove", { clientX: 200, clientY: 140 });
  await wait(10);
  fire(doc, "mouseup", { clientX: 200, clientY: 140 });
  await wait(10);
  check("Fenster nach Drag an neuer Position (um +50/+50 verschoben)", windowEl.style.left === "150px" && windowEl.style.top === "130px");

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE BILD-VOLLBILD-VERWISCHEN-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
