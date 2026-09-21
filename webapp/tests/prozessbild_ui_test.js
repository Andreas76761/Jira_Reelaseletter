const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const { DOMParser } = require("@xmldom/xmldom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });

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
async function blobToBuffer(blob) { return Buffer.from(await blob.arrayBuffer()); }
function isWellFormedXml(xml) {
  var errs = [];
  new DOMParser({ errorHandler: { warning: () => {}, error: (e) => errs.push(e), fatalError: (e) => errs.push(e) } }).parseFromString(xml, "text/xml");
  return errs.length === 0;
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="prozessbild"]').click();

  // ===================== Selects korrekt befuellt =====================
  const themeSelect = doc.getElementById("prozessbild-theme");
  const layoutSelect = doc.getElementById("prozessbild-layout");
  check("Design-Vorlage-Auswahl hat 10 Optionen", themeSelect.options.length === 10);
  check("Bildformat-Auswahl hat 10 Optionen", layoutSelect.options.length === 10);
  check("Standard-Bildformat ist 'Mermaid klassisch' (Rueckwaertskompatibilitaet)", layoutSelect.value === "mermaid-classic");
  check("Design-Vorlage ist bei Mermaid-Auswahl deaktiviert", themeSelect.disabled === true);

  // ===================== Standardverhalten unveraendert (Mermaid) =====================
  doc.getElementById("prozessbild-keys").value = "ONESCM-8282\nONESCM-NEU-1";
  doc.getElementById("prozessbild-use-filtered").checked = false;
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  const mermaidPre = doc.querySelector("#prozessbild-render pre.mermaid");
  check("Default-Generieren erzeugt weiterhin Mermaid-Diagramm", mermaidPre && mermaidPre.textContent.includes("flowchart TD"));
  check("Galerie-Eintrag als Mermaid gespeichert", doc.querySelector("#gallery pre.mermaid") !== null);

  // ===================== SVG-Layout auswaehlen und generieren =====================
  layoutSelect.value = "card-grid";
  fire(layoutSelect, "change");
  check("Design-Vorlage bei SVG-Layout wieder aktiv", themeSelect.disabled === false);
  check("Beschreibungstext wechselt zum gewaehlten Layout", doc.getElementById("prozessbild-layout-desc").textContent.includes("OnePaper"));

  themeSelect.value = "royal";
  fire(themeSelect, "change");
  doc.getElementById("prozessbild-name").value = "Testprozess";
  fire(doc.getElementById("prozessbild-generate-btn"), "click");

  const svgInPreview = doc.querySelector("#prozessbild-render svg");
  check("SVG wird im Vorschaubereich eingefuegt", !!svgInPreview);
  check("SVG-Quelltext-Details vorhanden (analog Mermaid-Quelltext)", !!doc.querySelector("#prozessbild-render .mermaid-source-details"));
  check("Vorschau-SVG ist wohlgeformtes XML", isWellFormedXml(doc.getElementById("prozessbild-render").innerHTML.match(/<svg[\s\S]*<\/svg>/)[0]));

  const galleryCards = doc.querySelectorAll("#gallery .gallery-card");
  check("Galerie hat jetzt 2 Eintraege (1x Mermaid, 1x SVG)", galleryCards.length === 2);
  check("Neuester Galerie-Eintrag zeigt SVG direkt eingebettet", !!galleryCards[0].querySelector("svg"));
  check("Galerie-Kartentitel nennt das gewaehlte Bildformat", galleryCards[0].querySelector("h3").textContent.includes("Nummerierte Schritt-Karten"));

  // ===================== Download als SVG (Blob) =====================
  savedFiles.length = 0;
  fire(doc.getElementById("prozessbild-download-btn"), "click");
  await wait(100);
  check("Download ausgeloest", savedFiles.length === 1);
  if (savedFiles.length) {
    check("Dateiname endet auf .svg", savedFiles[0].filename.endsWith(".svg"));
    const buf = await blobToBuffer(savedFiles[0].data);
    const text = buf.toString("utf-8");
    check("Heruntergeladene Datei beginnt mit <svg", text.trim().startsWith("<svg"));
    check("Heruntergeladene SVG enthaelt Prozessnamen", text.includes("Testprozess"));
  }

  // ===================== Alle 9 SVG-Layouts einmal durchklicken (Robustheit End-to-End) =====================
  const svgLayoutIds = Array.from(layoutSelect.options).map((o) => o.value).filter((v) => v !== "mermaid-classic");
  check("9 SVG-Bildformate zur Auswahl", svgLayoutIds.length === 9);
  var allOk = true;
  for (const id of svgLayoutIds) {
    layoutSelect.value = id;
    fire(layoutSelect, "change");
    fire(doc.getElementById("prozessbild-generate-btn"), "click");
    const svgEl = doc.querySelector("#prozessbild-render svg");
    if (!svgEl) { allOk = false; console.error("Kein SVG erzeugt fuer Layout:", id); }
  }
  check("Alle 9 SVG-Layouts erzeugen ueber die echte UI ein sichtbares SVG", allOk);

  // ===================== Export ohne Tickets =====================
  doc.getElementById("prozessbild-keys").value = "ONESCM-DOES-NOT-EXIST";
  fire(doc.getElementById("prozessbild-generate-btn"), "click");
  check("Kein Ticket gefunden zeigt Fehlermeldung statt Absturz", doc.getElementById("toast").className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PROZESSBILD-UI-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
