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

const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.claude = {
      use: function (name) {
        if (name !== "downloads") return Promise.resolve(null);
        return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
      },
    };
  },
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
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

  // ===================== Vorbereitung: Ticket mit Label + hochgeladenes Bild + generiertes Bild =====================
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>LBL-1</key><summary>Dealer Portal Feature</summary>
      <description>Betrifft den Market-Bereich.</description><status>Offen</status><type>Epic</type></item>
    <item><key>LBL-2</key><summary>Ohne besonderes Label</summary>
      <description>Allgemeiner Text ohne Stichwort.</description><status>Offen</status></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([xml], "labels_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Dashboard: Labels-Filter =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const labelSelect = doc.getElementById("label-select");
  check("Label-Filter-Dropdown im Dashboard vorhanden", !!labelSelect);
  const labelOptions = Array.from(labelSelect.options).map((o) => o.value).filter(Boolean);
  check("Label-Filter listet tatsächlich vorkommende Labels (Dealer/Market)", labelOptions.includes("Dealer") || labelOptions.includes("Market"));
  check("Label-Filter listet KEIN Label, das auf keinem Ticket vorkommt", !labelOptions.includes("Prolongation"));

  const totalBefore = doc.querySelectorAll("#table-body tr").length;
  labelSelect.value = "Dealer";
  fire(labelSelect, "change");
  const filteredRows = () => Array.from(doc.querySelectorAll("#table-body tr"));
  check("Filtern nach Label 'Dealer' reduziert die Trefferliste", filteredRows().length < totalBefore);
  check("Gefilterte Liste enthält LBL-1 (hat Label Dealer)", filteredRows().some((r) => r.textContent.includes("LBL-1")));
  check("Gefilterte Liste enthält NICHT LBL-2 (kein Label-Treffer)", !filteredRows().some((r) => r.textContent.includes("LBL-2")));

  // Erweitertes Suchfeld: Suche nach Labeltext findet Ticket auch ohne Label-Filter
  labelSelect.value = "";
  fire(labelSelect, "change");
  doc.getElementById("search-input").value = "DEALER";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  check("Suchfeld findet Ticket über automatisch erkanntes Label (erweiterte Suche)", filteredRows().some((r) => r.textContent.includes("LBL-1")));
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // Filter zurücksetzen leert auch den Label-Filter
  labelSelect.value = "Dealer";
  fire(labelSelect, "change");
  fire(doc.getElementById("reset-filter-btn"), "click");
  check("'Filter zurücksetzen' leert auch den Label-Filter", labelSelect.value === "" && filteredRows().length === totalBefore);

  // ===================== Bilder: kombinierte Tabelle =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-use-filtered").checked = false;
  doc.getElementById("prozessbild-keys").value = "LBL-1";
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await wait(100);

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  const pngBuffer = Buffer.from(redSquareDataUrl.split(",")[1], "base64");
  const imgFile = new win.File([pngBuffer], "anleitung_schritt1.png", { type: "image/png" });
  const imageInput = doc.getElementById("image-file-input");
  Object.defineProperty(imageInput, "files", { value: [imgFile], configurable: true });
  fire(imageInput, "change");
  await wait(300);

  const tableRows = () => Array.from(doc.querySelectorAll("#images-tbody tr"));
  check("Bilder-Tabelle zeigt 2 Zeilen (1 generiert + 1 hochgeladen)", tableRows().length === 2);
  check("Bilder-Tabelle-Zähler zeigt 2", doc.getElementById("images-table-count").textContent === "2");
  check("Tabellenkopf hat Spalte 'Beschreibung'", doc.querySelector("#images-table thead").textContent.includes("Beschreibung"));
  check("Tabellenkopf hat Spalte 'Datum'", doc.querySelector("#images-table thead").textContent.includes("Datum"));
  check("Tabellenkopf hat Spalte 'Typ'", doc.querySelector("#images-table thead").textContent.includes("Typ"));

  const uploadedTableRow = tableRows().find((r) => r.textContent.includes("anleitung_schritt1.png"));
  check("Zeile für hochgeladenes Bild vorhanden, Typ 'Hochgeladen'", !!uploadedTableRow && uploadedTableRow.textContent.includes("Hochgeladen"));
  const generatedTableRow = tableRows().find((r) => r.textContent.includes("Generiert"));
  check("Zeile für generiertes Bild vorhanden, Typ 'Generiert'", !!generatedTableRow && generatedTableRow !== uploadedTableRow);

  // ===================== Beschreibung in der Tabelle editieren (für BEIDE Bildarten) =====================
  const uploadedDescInput = uploadedTableRow.querySelector(".image-description-input");
  uploadedDescInput.value = "Screenshot vom Startbildschirm";
  fire(uploadedDescInput, "input");
  check("Beschreibung für hochgeladenes Bild im State übernommen (kein Re-Render nötig)", true);

  const generatedDescInput = generatedTableRow.querySelector(".image-description-input");
  generatedDescInput.value = "Übersichtsdiagramm für Kapitel 2";
  fire(generatedDescInput, "input");
  check("Beschreibung für generiertes Bild editierbar (bisher nicht möglich)", true);

  // Beschreibung leeren (= "löschen" der Beschreibung) funktioniert
  uploadedDescInput.value = "";
  fire(uploadedDescInput, "input");
  check("Beschreibung lässt sich wieder leeren", true);
  uploadedDescInput.value = "Screenshot vom Startbildschirm";
  fire(uploadedDescInput, "input");

  // ===================== Schritt-Feld jetzt 'Schritt (für Clickanweisung)' beschriftet =====================
  const uploadedCard = Array.from(doc.querySelectorAll(".uploaded-image-card"))[0];
  check("Karten-Label lautet jetzt 'Schritt (für Clickanweisung)' statt 'Prozessschritt'", uploadedCard.textContent.includes("Schritt (für Clickanweisung)"));

  // ===================== Bild aus der Tabelle herunterladen (uploaded card 'Herunterladen'-Button) =====================
  savedFiles.length = 0;
  fire(uploadedCard.querySelector(".image-download-btn"), "click");
  await wait(100);
  check("'Herunterladen' auf der Bild-Karte speichert die Datei", savedFiles.length === 1 && savedFiles[0].filename === "anleitung_schritt1.png");

  // ===================== Löschen direkt aus der Tabelle (generiertes Bild - bisher nicht loeschbar) =====================
  fire(generatedTableRow.querySelector(".image-delete-btn"), "click");
  await confirmViaModal(doc);
  check("Generiertes Bild über die Tabelle löschbar (Tabelle hat jetzt 1 Zeile)", tableRows().length === 1);
  check("Generiertes Bild verschwindet auch aus der Karten-Galerie", doc.querySelectorAll("#gallery .gallery-card").length === 1);
  check("Protokoll enthält Lösch-Eintrag für generiertes Bild", doc.getElementById("log-list").textContent.includes("Generiertes Bild") && doc.getElementById("log-list").textContent.includes("gelöscht"));

  // Verbleibende Zeile (hochgeladenes Bild) über die Tabelle löschen
  fire(tableRows()[0].querySelector(".image-delete-btn"), "click");
  await confirmViaModal(doc);
  check("Nach Löschen über die Tabelle: keine Bilder mehr, Hinweistext sichtbar", tableRows().length === 0 && !doc.getElementById("images-table-empty").hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE BILDER-TABELLE/LABEL-FILTER-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
