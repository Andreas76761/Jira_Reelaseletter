// Benutzerhandbuch: Icons/abgetrennte Boxen fuer Rollen-Abschnitte und die
// Hinweiskategorien [Warnung]/[Hinweis]/[Tipp]/[Verweis] (zusaetzlich zu den
// bereits bestehenden Scope-Tags [Nur PKW]/[Nur Van]/[Nur Markt]). Prueft
// alle 3 Ausgabeflaechen: Lese-Vorschau (HTML), DOCX-Export (<w:shd>-
// Schattierung) und PDF-Export (kein Absturz - Fuellrechtecke lassen sich
// aus dem jsPDF-Objekt nicht direkt als Text auslesen).
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

let sampleCalls = [];
let sampleImpl = async (input, opts) => {
  sampleCalls.push({ input, opts });
  return {
    text: "Einleitungssatz zum Kapitel.\n\n## Retail\nDer Retail legt den Vertrag an.\n[Warnung] Pruefe immer die Fahrgestellnummer vor dem Speichern.\n[Hinweis] Diese Information findet sich zusaetzlich im Serviceportal.\n[Tipp] Nutze die Schnellsuche fuer wiederkehrende Faelle.\n\n## HQ\nDas HQ genehmigt den Antrag.\n[Verweis] Siehe Kapitel 3 fuer die Freigabe-Details.",
    truncated: false, modelTierApplied: "default",
  };
};
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>BOX-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
    <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
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

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "manual_chapters_callout_boxes_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);

  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);
  await wait(50);

  const card = doc.getElementById("manual-chapters-list").querySelector("[data-manual-chapter]");
  check("Kapitel-Karte erzeugt", !!card);
  const chapterTitle = card ? card.getAttribute("data-manual-chapter") : null;

  // ===================== Vorschau (Icons): Rollen-Box + Hinweiskategorien =====================
  const previewBtn = card.querySelector('[data-manual-lang="preview"]');
  fire(previewBtn, "click");
  const cardAfterPreview = doc.getElementById("manual-chapters-list").querySelector('[data-manual-chapter="' + chapterTitle + '"]');
  const previewHtml = cardAfterPreview.innerHTML;

  check("Vorschau zeigt Rollen-Icon vor 'Retail'-Überschrift", previewHtml.includes("🚗 Retail</h4>"));
  check("Vorschau zeigt Rollen-Icon vor 'HQ'-Überschrift", previewHtml.includes("🏢 HQ</h4>"));
  check("Retail-Rollenabschnitt ist als eigene .callout-Box mit Rollen-Randfarbe gerahmt",
    /<div class="callout" style="border-left-color:var\(--progress\);[^"]*">\s*<p[^>]*>Der Retail legt/.test(previewHtml));
  check("[Warnung] wird als eigene Box mit Icon/Randfarbe dargestellt",
    previewHtml.includes('border-left-color:var(--blocked)') && previewHtml.includes("⚠️ Warnung:"));
  check("[Hinweis] wird als eigene Box mit Icon/Randfarbe dargestellt",
    previewHtml.includes('border-left-color:var(--accent)') && previewHtml.includes("ℹ️ Hinweis:"));
  check("[Tipp] wird als eigene Box mit Icon/Randfarbe dargestellt",
    previewHtml.includes('border-left-color:var(--done)') && previewHtml.includes("💡 Tipp:"));
  check("[Verweis] wird als eigene Box mit Icon/Randfarbe dargestellt",
    previewHtml.includes('border-left-color:var(--backlog)') && previewHtml.includes("🔗 Verweis:"));
  check("Rohe Tags erscheinen nicht mehr unveraendert im Fließtext",
    !previewHtml.includes("[Warnung] Pruefe") && !previewHtml.includes("[Hinweis] Diese") &&
    !previewHtml.includes("[Tipp] Nutze") && !previewHtml.includes("[Verweis] Siehe"));
  // Rollen-Box muss sich bei der naechsten Überschrift schließen, nicht alle
  // Abschnitte in einer einzigen Box verschmelzen - zaehlt die Anzahl
  // geoeffneter .callout-Rollenboxen (border-left-color:var(--progress) fuer
  // Retail, var(--backlog) fuer HQ - exakt je 1x als Rollen-Box, zusaetzlich
  // zu den Tag-Boxen oben).
  check("HQ-Rollenabschnitt ist ebenfalls als eigene .callout-Box gerahmt",
    /<div class="callout" style="border-left-color:var\(--backlog\);[^"]*">\s*<p[^>]*>Das HQ genehmigt/.test(previewHtml));

  fire(cardAfterPreview.querySelector('[data-manual-lang="de"]'), "click");

  // ===================== DOCX-Export: Absatzschattierung je Tag/Rollen-Abschnitt =====================
  const errCountBefore = errors.length;
  const docxBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="export-docx"]');
  fire(docxBtn, "click");
  await wait(300);
  check("DOCX-Export löst keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);
  const docxSaved = savedFiles.find((f) => f.filename.endsWith(".docx"));
  check("DOCX-Datei gespeichert", !!docxSaved);
  if (docxSaved) {
    const zip = await JSZipNode.loadAsync(docxSaved.data);
    const xml2 = await zip.file("word/document.xml").async("string");
    check("DOCX: [Warnung]-Absatz ist farbig schattiert (w:fill)", /\[Warnung\][^<]*<\/w:t><\/w:r><\/w:p>/.test(xml2) && xml2.includes('w:fill="FBE4E2"'));
    check("DOCX: [Hinweis]-Absatz nutzt Accent-Schattierung", xml2.includes('w:fill="E1F1F4"'));
    check("DOCX: [Tipp]-Absatz nutzt Done-Schattierung", xml2.includes('w:fill="E3F5E9"'));
    check("DOCX: [Verweis]-Absatz nutzt Backlog-Schattierung", xml2.includes('w:fill="EAE8FB"'));
    check("DOCX: Retail-Rollenabschnitt (Fließtext ohne eigenen Tag) ist ebenfalls schattiert (Progress-Ton)", xml2.includes('w:fill="FBEDD9"'));
    check("DOCX enthält weiterhin die fett/rote Hervorhebung der Tag-Zeilen (bestehendes Verhalten)", xml2.includes("C0392B"));
  }

  // ===================== PDF-Export: kein Absturz mit den neuen Tags =====================
  savedFiles.length = 0;
  const pdfBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="export-pdf"]');
  fire(pdfBtn, "click");
  await wait(200);
  check("PDF-Export löst keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);
  const pdfSaved = savedFiles.find((f) => f.filename.endsWith(".pdf"));
  check("PDF-Datei gespeichert", !!pdfSaved);
  if (pdfSaved) {
    const pdfBuf = Buffer.from(await pdfSaved.data.arrayBuffer());
    check("PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");
  }

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE ICONS/ABGETRENNTE-BOXEN-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
