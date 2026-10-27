// EDITO (Register "Editor"), Abschnitt "6. Gesamtdokument": Agent 3 prüft
// NACH dem Erzeugen deterministisch (ohne KI-Aufruf, anhand des
// tatsächlich gerenderten Gesamtdokument-PDFs) die reale Seitenanzahl
// sowie, ob alle [Bild]-/[Tabelle]-Platzhalter mit einem zugeordneten
// Screenshot bzw. einer zugeordneten Tabelle eingebettet werden konnten,
// und weist auf ein (noch) fehlendes Inhaltsverzeichnis hin. Prüft:
// Guard ohne Version/ohne erzeugtes Kapitel, korrekte Zählung bei
// Platzhalter-Überschuss (mehr [Bild] als zugeordnete Screenshots) UND bei
// exaktem Treffer ([Tabelle] == zugeordnete Tabellen), Protokoll/Toast,
// sowie Reset des Ergebnisses bei Versionswechsel.
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

async function sampleImpl(promptText) {
  // Liefert bewusst 3x "[Bild]" bei nur 2 zugeordneten Screenshots (1
  // Ueberschuss) und genau 1x "[Tabelle]" bei genau 1 zugeordneten Tabelle
  // (exakter Treffer) - deckt beide Zweige der Struktur-Pruefung ab.
  return { text: "## Retail\nErster Absatz.\n[Bild]\nZweiter Absatz.\n[Bild]\n[Tabelle]\nDritter Absatz.\n[Bild]\n", truncated: false, modelTierApplied: "default" };
}
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
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

const ticketXml = `<?xml version="1.0"?><rss><channel>
  <item><key>OV-1</key><summary>Pkw Dealer Ticket</summary><description>Pkw/Dealer Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

const PNG_1X1 = Buffer.from(
  fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1],
  "base64"
);

// .docx mit 2 eingebetteten Bildern (gleiches Muster wie editor_screens_test.js).
async function buildDocxWithTwoImages() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Screen A</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Screen B</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>' +
    "</w:body></w:document>";
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>' +
    "</Relationships>";
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/media/image1.png", PNG_1X1);
  zip.file("word/media/image2.png", PNG_1X1);
  return zip.generateAsync({ type: "nodebuffer" });
}

// .docx mit 1 Tabelle (gleiches Muster wie edito_table_embed_test.js).
async function buildDocxWithTable() {
  var zip = new JSZipNode();
  var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    "<w:p><w:r><w:t>Chatverlauf: Welche Felder?</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>---</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Antwort: Siehe Tabelle.</w:t></w:r></w:p>" +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pflicht</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "</w:body></w:document>";
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
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const ticketInput = doc.getElementById("file-input");
  Object.defineProperty(ticketInput, "files", { value: [new win.File([ticketXml], "edito_agent3_test.xml", { type: "application/xml" })], configurable: true });
  fire(ticketInput, "change");
  await wait(400);

  // ===================== Guard: ohne Rolle/Sparte =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  fire(doc.getElementById("edito-agent3-btn"), "click");
  await wait(50);
  check("Agent 3 ohne Rolle/Sparte zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("Rolle/Sparte"));
  check("Ergebnis-Bereich bleibt dabei versteckt", doc.getElementById("edito-agent3-result").hidden === true);

  // ===================== Rolle/Sparte wählen, aber noch kein Kapitel erzeugt =====================
  const versionSelect = doc.getElementById("edito-version-select");
  versionSelect.value = "dealer";
  fire(versionSelect, "change");
  await wait(100);
  fire(doc.getElementById("edito-agent3-btn"), "click");
  await wait(50);
  check("Agent 3 ohne erzeugtes Kapitel zeigt Hinweis statt Absturz", doc.getElementById("toast").textContent.includes("noch kein Kapitel erzeugt"));

  function rowFor(chapterTitleSubstring) {
    return Array.from(doc.getElementById("edito-chapters-tbody").querySelectorAll("tr")).find((r) => r.children[1].textContent.includes(chapterTitleSubstring));
  }
  const kap7Row = rowFor("Kapitel 7");
  const kap7TitleFull = kap7Row.children[1].textContent;

  // ===================== 2 Bilder + 1 Tabelle für Kapitel 7 zuordnen =====================
  doc.querySelector('.nav-item[data-view="editor"]').click();
  await wait(100);
  const imagesBuf = await buildDocxWithTwoImages();
  const imagesFile = new win.File([imagesBuf], "screens.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const editorFileInput = doc.getElementById("editor-file-input");
  Object.defineProperty(editorFileInput, "files", { value: [imagesFile], configurable: true });
  fire(editorFileInput, "change");
  await waitUntil(() => doc.querySelectorAll("#editor-screens-tbody tr").length === 2, 2000);
  // Jede Zuordnung loest ein Re-Render der Tabelle aus (innerHTML wird
  // ersetzt) - daher nach jeder Aenderung FRISCH aus dem Dokument abfragen,
  // statt eine zuvor eingefrorene NodeList weiterzuverwenden (deren
  // Elemente nach dem Re-Render vom Dokument abgehaengt waeren und ein
  // "change"-Event auf ihnen nicht mehr zum delegierten Listener
  // hochblubbern wuerde).
  for (let i = 0; i < 2; i++) {
    const sel = doc.querySelectorAll(".editor-screen-chapter-select")[i];
    sel.value = kap7TitleFull;
    fire(sel, "change");
    await wait(30);
  }

  doc.querySelector('.nav-item[data-view="rovoknowledge"]').click();
  await wait(100);
  const tableBuf = await buildDocxWithTable();
  const tableFile = new win.File([tableBuf], "felder.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const rovoFileInput = doc.getElementById("rovo-md-file-input");
  Object.defineProperty(rovoFileInput, "files", { value: [tableFile], configurable: true });
  fire(rovoFileInput, "change");
  await wait(500);
  doc.querySelector('.nav-item[data-view="tabellen"]').click();
  await wait(100);
  const tableChapterSel = doc.querySelector(".rovo-table-chapter-select");
  tableChapterSel.value = kap7TitleFull;
  fire(tableChapterSel, "change");
  await wait(50);

  // ===================== Kapitel 7 erzeugen (Prompt-Mock liefert 3x [Bild], 1x [Tabelle]) =====================
  doc.querySelector('.nav-item[data-view="edito"]').click();
  await wait(100);
  fire(rowFor("Kapitel 7").querySelector("[data-edito-generate]"), "click");
  const genDone = await waitUntil(() => !!rowFor("Kapitel 7").querySelector("[data-edito-view]"), 2000);
  check("Kapitel 7 erzeugt", genDone);

  // ===================== Agent 3 ausführen =====================
  fire(doc.getElementById("edito-agent3-btn"), "click");
  await wait(300);
  check("Ergebnis-Bereich jetzt sichtbar", doc.getElementById("edito-agent3-result").hidden === false);
  const reportText = doc.getElementById("edito-agent3-output").textContent;
  check("Nennt die reale Seitenanzahl des Gesamtdokuments", /Gesamtdokument: \d+ Seite/.test(reportText));
  check("Bilder: 2 von 3 Platzhaltern erfolgreich eingebettet (1 Ueberschuss)", reportText.includes("2 von 3 [Bild]-Platzhaltern erfolgreich mit einem Screenshot eingebettet (2 Screenshot(s) insgesamt zugeordnet)"));
  check("Bilder: fehlende Zuordnung als Warnung ausgewiesen", reportText.includes("⚠ 1 Platzhalter ohne zugeordneten Screenshot."));
  check("Tabellen: 1 von 1 Platzhaltern erfolgreich eingebettet (exakter Treffer)", reportText.includes("1 von 1 [Tabelle]-Platzhaltern erfolgreich mit einer Tabelle eingebettet (1 Tabelle(n) insgesamt zugeordnet)"));
  check("Tabellen: keine fehlende Zuordnung gemeldet", reportText.includes("Keine fehlenden Tabellen-Zuordnungen."));
  check("Kapitel-Liste nennt Kapitel 7 mit dem fehlenden Bild-Platzhalter", new RegExp(kap7TitleFull.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*Bild-Platzhalter ohne zugeordneten Screenshot").test(reportText));
  check("Weist auf fehlendes Inhaltsverzeichnis hin", reportText.includes("Inhaltsverzeichnis") && reportText.includes("Nicht vorhanden"));
  check("Statuszeile vermerkt Abschluss", doc.getElementById("edito-agent3-status-note").textContent.includes("abgeschlossen"));
  check("Protokoll vermerkt Agent-3-Lauf", doc.getElementById("log-list").textContent.includes("Agent 3"));

  // ===================== Versionswechsel setzt Ergebnis zurück =====================
  versionSelect.value = "it";
  fire(versionSelect, "change");
  await wait(100);
  check("Nach Versionswechsel: Agent-3-Ergebnis wieder versteckt", doc.getElementById("edito-agent3-result").hidden === true);
  check("Nach Versionswechsel: Statuszeile geleert", doc.getElementById("edito-agent3-status-note").textContent === "");

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log("  JS-FEHLER:", e));

  const failed = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - failed.length}/${checks.length} bestanden`);
  if (failed.length) {
    console.log("FEHLGESCHLAGEN:", JSON.stringify(failed.map((f) => f[0])));
    process.exit(1);
  } else {
    console.log("ALLE EDITO-AGENT3-STRUKTURPRUEFUNGS-TESTS BESTANDEN");
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
