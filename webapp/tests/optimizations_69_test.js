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
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>OPT-1</key><summary>Preisberechnung anpassen</summary>
      <description>Rufe das Vertragsmodul auf.</description>
      <status>Offen</status><type>Epic</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>OPT-2</key><summary>Rechnungsexport</summary>
      <description>Wechsle in den Bereich Finance.</description>
      <status>Geschlossen</status><type>Story</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Finance</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "opt.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Fix #6: "Alle auswählen"/"Auswahl aufheben" fuer RAG-Mehrfachauswahl =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();

  const domainSelect = doc.getElementById("rag-domain-select");
  const selectAllBtn = doc.querySelector('[data-select-all="rag-domain-select"]');
  const clearBtn = doc.querySelector('[data-select-clear="rag-domain-select"]');
  check("'Alle auswählen'-Button für Domäne-Auswahl vorhanden", !!selectAllBtn);
  check("'Auswahl aufheben'-Button für Domäne-Auswahl vorhanden", !!clearBtn);
  check("Vor Klick: keine Domäne ausgewählt", Array.from(domainSelect.selectedOptions).length === 0);

  fire(selectAllBtn, "click");
  check("Nach 'Alle auswählen': alle Domäne-Optionen ausgewählt", Array.from(domainSelect.selectedOptions).length === domainSelect.options.length && domainSelect.options.length > 0);

  fire(clearBtn, "click");
  check("Nach 'Auswahl aufheben': keine Domäne mehr ausgewählt", Array.from(domainSelect.selectedOptions).length === 0);

  const statusSelectAllBtn = doc.querySelector('[data-select-all="rag-status-select"]');
  const statusClearBtn = doc.querySelector('[data-select-clear="rag-status-select"]');
  check("'Alle auswählen'/'Auswahl aufheben' auch für Status-Auswahl vorhanden", !!statusSelectAllBtn && !!statusClearBtn);
  fire(statusSelectAllBtn, "click");
  const statusSelect = doc.getElementById("rag-status-select");
  check("Nach 'Alle auswählen' bei Status: alle ausgewählt", Array.from(statusSelect.selectedOptions).length === statusSelect.options.length);
  fire(statusClearBtn, "click");
  check("Nach 'Auswahl aufheben' bei Status: keine ausgewählt", Array.from(statusSelect.selectedOptions).length === 0);

  // 'Alle auswählen' wirkt tatsaechlich auf die Extraktion: mit genau einer
  // Domäne ausgewaehlt kommen weniger Tickets zurueck als mit allen Domänen.
  Array.prototype.forEach.call(domainSelect.options, function (o) { o.selected = o.value === "Contract Management"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  const countOneDomain = parseInt(doc.getElementById("rag-extract-count").textContent, 10);
  check("Extraktion enthält OPT-1 bei Filter auf 'Contract Management'", doc.getElementById("rag-extract-tbody").textContent.includes("OPT-1"));
  check("Extraktion enthält NICHT OPT-2 bei Filter auf 'Contract Management'", !doc.getElementById("rag-extract-tbody").textContent.includes("OPT-2"));

  fire(selectAllBtn, "click");
  fire(doc.getElementById("rag-extract-btn"), "click");
  const countAllDomains = parseInt(doc.getElementById("rag-extract-count").textContent, 10);
  check("Extraktion nach 'Alle auswählen' liefert mindestens so viele Tickets wie mit einer einzelnen Domäne", countAllDomains >= countOneDomain);
  check("Extraktion nach 'Alle auswählen' enthält jetzt auch OPT-2 (Domäne Finance)", doc.getElementById("rag-extract-tbody").textContent.includes("OPT-2"));
  fire(clearBtn, "click");

  // ===================== Fix #9: alt-Text bei Bild-Thumbnails (Tabelle) =====================
  doc.querySelector('.nav-item[data-view="prozessbild"]').click();
  doc.getElementById("prozessbild-use-filtered").checked = false;
  doc.getElementById("prozessbild-keys").value = "OPT-1";
  doc.getElementById("prozessbild-layout").value = "kanban";
  fire(doc.getElementById("prozessbild-layout"), "change");
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  await wait(100);

  doc.querySelector('.nav-item[data-view="bilder"]').click();
  const generatedImg = doc.querySelector("#images-tbody img.table-thumb");
  check("Generiertes-Bild-Thumbnail in der Tabelle hat NICHT-leeres alt-Attribut", !!generatedImg && generatedImg.getAttribute("alt") && generatedImg.getAttribute("alt").length > 0);
  check("alt-Text des generierten Bildes referenziert den Release-Namen", !!generatedImg && generatedImg.getAttribute("alt").includes("Release"));

  // Hochgeladenes Bild
  const redSquare = fs.readFileSync(path.join(FIXTURES, "red_square_dataurl.txt"), "utf-8").trim();
  const pngBuffer = Buffer.from(redSquare.split(",")[1], "base64");
  const imgFile = new win.File([pngBuffer], "meinbild.png", { type: "image/png" });
  const imageInput = doc.getElementById("image-file-input");
  Object.defineProperty(imageInput, "files", { value: [imgFile], configurable: true });
  fire(imageInput, "change");
  await wait(300);

  const uploadedRow = Array.from(doc.querySelectorAll("#images-tbody tr")).find((r) => r.textContent.includes("meinbild.png"));
  const uploadedImg = uploadedRow ? uploadedRow.querySelector("img.table-thumb") : null;
  check("Hochgeladenes-Bild-Thumbnail hat alt-Text = Dateiname (keine Beschreibung gesetzt)", !!uploadedImg && uploadedImg.getAttribute("alt") === "meinbild.png");

  // Beschreibung setzen -> alt-Text sollte bei naechstem Render die Beschreibung bevorzugen
  const descInput = uploadedRow.querySelector(".image-description-input");
  descInput.value = "Startbildschirm nach Login";
  fire(descInput, "input");
  fire(doc.getElementById("prozessbild-generate-btn"), "click"); // Trigger fuer renderImagesTable ueber renderGallery-Kette; einfacher: Tabelle direkt neu anstossen
  // Direktes Neu-Rendern der Bilder-Tabelle simulieren, falls obiges nicht reicht:
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.querySelector('.nav-item[data-view="bilder"]').click();
  const uploadedRow2 = Array.from(doc.querySelectorAll("#images-tbody tr")).find((r) => r.textContent.includes("meinbild.png"));
  const uploadedImg2 = uploadedRow2 ? uploadedRow2.querySelector("img.table-thumb") : null;
  check("Nach Setzen einer Beschreibung: alt-Text bevorzugt die Beschreibung", !!uploadedImg2 && uploadedImg2.getAttribute("alt") === "Startbildschirm nach Login");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE OPTIMIERUNGS-TESTS (6,9) BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
