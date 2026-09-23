// Benutzerhandbuch: Kapitel-Generator (KI-Fließtext je Gliederungskapitel).
// Analog zu RAG (Verarbeitung), aber mit Domäne/Label-Themengebiet/Kapitel
// als Filter, editierbarem/persistiertem Ergebnis je Kapitel, Übersetzung
// und PDF/DOCX-Export mit einfacher "Icon"-Kennzeichnung ([Nur PKW]/[Nur
// Van]/[Nur Markt]) sowie Rollentrennung (## Dealer/Markt/HQ/Sparte/MO).
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
    text: "Dieses Kapitel führt in den Prozess ein.\n\n## Dealer\nDer Dealer legt den Servicevertrag an. [Nur PKW] Für PKW gilt eine Sonderregel.\n\n## HQ\nDas HQ prüft die Freigabe. Dieses Feature steht dem Dealer nicht zur Verfügung.",
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
  <item><key>MAN-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
    <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
  <item><key>MAN-2</key><summary>Freigabeprozess durch HQ</summary>
    <description>Das HQ prüft und gibt den Vertrag frei.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
  <item><key>MAN-3</key><summary>Rechnungsstellung</summary>
    <description>Die Rechnung wird nach Vertragsabschluss erzeugt.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Revenue Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Erst alle Demo-Tickets loeschen - fuer vorhersagbare Domaenen-/
  // Kapitel-Listen und Match-Zahlen.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "manual_chapters_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  check("Kapitel-Generator-Bereich sichtbar", !!doc.getElementById("manual-chapters-section"));
  check("Domäne-Auswahl listet 'Contract Management' und 'Revenue Management'",
    Array.from(doc.getElementById("manual-domain-select").options).map((o) => o.value).sort().join(",") === "Contract Management,Revenue Management");
  check("Kapitel-Auswahl listet 'Kapitel 7: Verträge im Alltag verwalten' (Contract Management)",
    Array.from(doc.getElementById("manual-chapter-select").options).some((o) => o.value.includes("Kapitel 7")));

  // ===================== "Alle auswählen"/"Auswahl aufheben" (generischer Mechanismus) =====================
  const selectAllBtn = doc.querySelector('[data-select-all="manual-domain-select"]');
  check("'Alle auswählen'-Button für Domäne vorhanden", !!selectAllBtn);
  fire(selectAllBtn, "click");
  await wait(50);
  check("Match-Anzahl aktualisiert sich nach Auswahl", doc.getElementById("manual-match-count").textContent.includes("3 Ticket"));
  const clearBtn = doc.querySelector('[data-select-clear="manual-domain-select"]');
  fire(clearBtn, "click");
  await wait(50);

  // ===================== Ohne Auswahl: Fehlermeldung statt stillem Nichtstun =====================
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(100);
  check("Ohne Domäne/Kapitel-Auswahl: Fehlermeldung statt Absturz", doc.getElementById("toast").textContent.includes("Bitte mindestens ein Kapitel oder eine Domäne"));

  // ===================== Kapitel für eine Domäne erstellen (alle Kapitel dieser Domäne) =====================
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  sampleCalls = [];
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);

  check("sample() wurde für die Kapitel-Erstellung aufgerufen", sampleCalls.length >= 1);
  check("Prompt enthält die Ticket-Rohdaten (Fahrzeugdaten)", sampleCalls[0].input.includes("Fahrzeugdaten"));
  check("Prompt enthält Typ-Angabe (reichhaltiger als bei RAG)", sampleCalls[0].input.includes("Typ: Feature"));
  check("Prompt nennt das Kapitel", sampleCalls[0].input.includes("Kapitel 7"));
  check("Mindestens 1 Kapitel-Karte erzeugt", doc.getElementById("manual-chapters-list").children.length >= 1);
  check("'Noch keine Kapitel erzeugt'-Hinweis jetzt versteckt", doc.getElementById("manual-chapters-empty").hidden === true);

  const card = doc.querySelector('[data-manual-chapter="Kapitel 7: Verträge im Alltag verwalten"]');
  check("Karte für 'Kapitel 7: Verträge im Alltag verwalten' vorhanden", !!card);
  if (card) {
    const textarea = card.querySelector(".manual-chapter-textarea");
    check("Generierter Text im Textfeld sichtbar", textarea.value.includes("führt in den Prozess ein"));
    check("Rollentrennung '## Dealer' im Text enthalten", textarea.value.includes("## Dealer"));
    check("Rollentrennung '## HQ' im Text enthalten", textarea.value.includes("## HQ"));
    check("Scope-Tag '[Nur PKW]' im Text enthalten", textarea.value.includes("[Nur PKW]"));
    check("Hinweis auf fehlendes Dealer-Feature im Text enthalten", textarea.value.includes("nicht zur Verfügung"));

    // ===================== Text ist editierbar und wird persistiert (app.manualChapters) =====================
    textarea.value = textarea.value + "\n\nManuell ergänzter Satz.";
    fire(textarea, "input");
    await wait(50);
    doc.querySelector('.nav-item[data-view="dashboard"]').click();
    await wait(50);
    doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
    await wait(50);
    const cardAfterNav = doc.querySelector('[data-manual-chapter="Kapitel 7: Verträge im Alltag verwalten"]');
    check("Bearbeiteter Text bleibt nach Navigation erhalten (persistiert in app.manualChapters)",
      cardAfterNav.querySelector(".manual-chapter-textarea").value.includes("Manuell ergänzter Satz."));
  }

  // ===================== Übersetzung =====================
  sampleCalls = [];
  const translateBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="translate"]');
  check("'Ins Englische übersetzen'-Button vorhanden", !!translateBtn);
  fire(translateBtn, "click");
  for (let waited = 0; waited < 5000; waited += 100) {
    const btn = doc.querySelector('[data-manual-lang="en"]');
    if (btn && !btn.disabled) break;
    await wait(100);
  }
  check("Übersetzungs-Prompt wurde aufgerufen", sampleCalls.length === 1);
  const enBtn = doc.querySelector('[data-manual-lang="en"]');
  check("'English'-Umschalter nach Übersetzung aktiviert", !!enBtn && enBtn.disabled === false);

  // ===================== PDF/DOCX-Export (kein Absturz, echtes ZIP/PDF) =====================
  const errCountBefore = errors.length;
  const pdfBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="export-pdf"]');
  fire(pdfBtn, "click");
  await wait(200);
  const docxBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="export-docx"]');
  fire(docxBtn, "click");
  await wait(300);
  check("PDF-/DOCX-Export lösen keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);
  check("Genau 2 Dateien über die Downloads-Capability gespeichert (PDF + DOCX)", savedFiles.length === 2);
  const docxSaved = savedFiles.find((f) => f.filename.endsWith(".docx"));
  check("DOCX-Dateiname endet auf .docx", !!docxSaved);
  if (docxSaved) {
    const zip = await JSZipNode.loadAsync(docxSaved.data);
    check("Exportiertes DOCX enthält word/document.xml", !!zip.file("word/document.xml"));
    const xml2 = await zip.file("word/document.xml").async("string");
    check("DOCX enthält den Kapiteltitel", xml2.includes("Kapitel 7"));
    check("DOCX enthält die Rollentrennung 'Dealer' als Überschrift", xml2.includes("Dealer"));
    check("DOCX hebt den Scope-Tag '[Nur PKW]' farbig/fett hervor", xml2.includes("[Nur PKW]") && xml2.includes("C0392B"));
  }
  const pdfSaved = savedFiles.find((f) => f.filename.endsWith(".pdf"));
  check("PDF-Dateiname endet auf .pdf", !!pdfSaved);
  if (pdfSaved) {
    const pdfBuf = Buffer.from(await pdfSaved.data.arrayBuffer());
    check("PDF beginnt mit %PDF-Signatur", pdfBuf.slice(0, 4).toString() === "%PDF");
  }

  // ===================== Kapitel löschen =====================
  const deleteBtn = doc.getElementById("manual-chapters-list").querySelector('[data-manual-action="delete"]');
  fire(deleteBtn, "click");
  await wait(50);
  check("Nach Löschen: Karte verschwunden", !doc.querySelector('[data-manual-chapter="Kapitel 7: Verträge im Alltag verwalten"]'));
  check("Nach Löschen aller Kapitel: 'Noch keine Kapitel erzeugt'-Hinweis wieder sichtbar", doc.getElementById("manual-chapters-empty").hidden === false);

  // ===================== Reset (Alle Daten löschen) leert app.manualChapters =====================
  const domainSelect2 = doc.getElementById("manual-domain-select");
  Array.from(domainSelect2.options).forEach((o) => { o.selected = o.value === "Revenue Management"; });
  fire(domainSelect2, "change");
  await wait(50);
  sampleCalls = [];
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);
  check("Vor Reset: mindestens 1 Kapitel vorhanden", doc.getElementById("manual-chapters-list").children.length >= 1);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Nach 'Alle Daten löschen': Kapitel-Liste wieder leer", doc.getElementById("manual-chapters-list").children.length === 0);
  check("Nach 'Alle Daten löschen': Leer-Hinweis wieder sichtbar", doc.getElementById("manual-chapters-empty").hidden === false);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE BENUTZERHANDBUCH-KAPITEL-GENERATOR-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
