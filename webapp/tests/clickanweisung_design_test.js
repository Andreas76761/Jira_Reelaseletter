const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");

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
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name !== "downloads") return Promise.resolve(null);
        return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>CA-1</key><summary>Preisberechnung anpassen</summary>
      <description>Rufe das Vertragsmodul auf.
Öffne den Reiter Preise.
Speichere die Änderung.</description>
      <status>Offen</status><type>Epic</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "ca_design.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="clickanweisung"]').click();
  check("Design-Vorlage-Auswahl vorhanden mit 5 Optionen", doc.getElementById("clickanweisung-theme").options.length === 5);
  check("Layout-Export-Buttons initial deaktiviert", doc.getElementById("clickanweisung-download-styled-docx-btn").disabled && doc.getElementById("clickanweisung-download-styled-pdf-btn").disabled);

  doc.getElementById("clickanweisung-use-filtered").checked = false;
  doc.getElementById("clickanweisung-keys").value = "CA-1";
  fire(doc.getElementById("clickanweisung-generate-btn"), "click");
  await wait(100);
  check("Nach Generieren: Layout-Export-Buttons aktiviert", !doc.getElementById("clickanweisung-download-styled-docx-btn").disabled && !doc.getElementById("clickanweisung-download-styled-pdf-btn").disabled);

  // ===================== Visuelles Icon-System (Schritt-Formen) =====================
  const previewText = doc.getElementById("clickanweisung-preview").textContent;
  check("Vorschau zeigt die Icon-Legende", previewText.includes("Legende:"));
  check("Schritt 'Speichere die Änderung' bekommt Bestätigungs-Form (▲)", /3\.\s*▲\s*Speichere die Änderung/.test(previewText));
  check("Mindestens eine Aktions-Form (●) in der Vorschau", previewText.includes("●"));

  // ===================== Alle 5 Designvorlagen: DOCX =====================
  const themeSelect = doc.getElementById("clickanweisung-theme");
  const themeIds = Array.from(themeSelect.options).map((o) => o.value);
  check("5 unterschiedliche Design-Vorlagen-IDs", new Set(themeIds).size === 5);

  for (const themeId of themeIds) {
    themeSelect.value = themeId;
    savedFiles.length = 0;
    fire(doc.getElementById("clickanweisung-download-styled-docx-btn"), "click");
    await wait(150);
    check("DOCX (" + themeId + ") wurde gespeichert und ist ein nicht-leeres ZIP/DOCX", savedFiles.length === 1 && savedFiles[0].filename.includes(themeId));
    const docxBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    const zipCheck = await JSZipNode.loadAsync(docxBuf);
    const docXml = await zipCheck.file("word/document.xml").async("string");
    check("DOCX (" + themeId + ") enthält die Domäne 'Contract Management'", docXml.includes("Contract Management"));
    check("DOCX (" + themeId + ") enthält den ersten Klickschritt-Text", docXml.includes("Vertragsmodul"));
    check("DOCX (" + themeId + ") enthält Schritt-Badges als Tabelle mit Form-Symbol", docXml.includes("<w:tbl>") && docXml.includes("▲"));
    check("DOCX (" + themeId + ") enthält NICHT den Ticket-Key (Clickanweisung-Designprinzip bleibt gewahrt)", !docXml.includes("CA-1"));
  }

  // ===================== Alle 5 Designvorlagen: PDF =====================
  for (const themeId of themeIds) {
    themeSelect.value = themeId;
    savedFiles.length = 0;
    fire(doc.getElementById("clickanweisung-download-styled-pdf-btn"), "click");
    await wait(150);
    check("PDF (" + themeId + ") wurde gespeichert", savedFiles.length === 1 && savedFiles[0].filename.includes(themeId));
    const buf = Buffer.from(await savedFiles[0].data.arrayBuffer());
    check("PDF (" + themeId + ") beginnt mit %PDF-Signatur", buf.slice(0, 4).toString() === "%PDF");
    const parsed = await new PDFParse({ data: buf }).getText();
    const text = parsed.text || (parsed.pages || []).map((p) => p.text).join("\n");
    check("PDF (" + themeId + ") Textinhalt enthält Domäne 'Contract Management'", text.includes("Contract Management"));
    check("PDF (" + themeId + ") Textinhalt enthält Klickschritt-Text", text.includes("Vertragsmodul") || text.includes("Vertrags"));
  }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE CLICKANWEISUNG-DESIGN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
