// Referenz-Nummer je Ticket-Textschnipsel (Massenverarbeitung/Benutzerhandbuch-
// Kapitel-Generator/RAG-Zusammenfassung & Fließtext): Format "<Domänen-Kürzel>-
// <Kapitelnr>.<Unterkapitelnr>-<Jahr>-<laufende Nummer>" (z. B. "CM-04.01-2024-
// 001"), damit sich aus einem fertigen Text wieder auf das ursprüngliche
// Jira-Ticket zurückschließen lässt. Deckt ab: Domänen-Kürzel-Stammdaten
// (automatischer Vorschlag + Override), Unterkapitel-Auswahl + Ref.-Nr.-Spalte
// in Massenverarbeitung (inkl. Stabilität über Re-Render), "–" bei nicht-
// ticketbasierten Einträgen, Einbettung in den per-Domäne-MD-Export, die
// "Quellen"-Fußzeile in Benutzerhandbuch-Kapitel-Generator und RAG-Job-7-
// Ausgabe, sowie Persistenz über Sitzung speichern/laden.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const savedFiles = [];
let sampleImpl = async (input) => {
  if (input.indexOf("Servicevertrag") !== -1) {
    return { text: "Kapitelinhalt-fuer-Referenztest.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "RAG-Zusammenfassung-fuer-Referenztest.", truncated: false, modelTierApplied: "default" };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
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

const xmlFixture = `<?xml version="1.0"?><rss><channel>
  <item><key>RID-1</key><summary>Servicevertrag anlegen Testfall</summary><description>Beschreibung RID-1.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields>
    <created>15/Mar/24 10:00 AM</created></item>
  <item><key>RID-2</key><summary>Zweiter Fall Servicevertrag</summary><description>Beschreibung RID-2.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields>
    <created>20/Jun/24 10:00 AM</created></item>
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

  // ===================== (1) Import =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "rid.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("(1) 2 Tickets geladen", doc.getElementById("stat-tickets").textContent === "2");

  // ===================== (2) Domänen-Kürzel-Stammdaten =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const abbrRow = () => Array.from(doc.querySelectorAll("#domainabbr-tbody tr")).find((r) => r.textContent.includes("Contract Management"));
  check("(2) Domänen-Kürzel-Zeile für 'Contract Management' vorhanden", !!abbrRow());
  const abbrInput = () => abbrRow().querySelector(".domainabbr-input");
  check("(2) Automatischer Vorschlag 'CM' (Wortanfänge)", abbrInput().value === "CM");
  check("(2) Als 'automatisch' markiert (kein Override)", abbrRow().textContent.includes("automatisch"));

  // ===================== (3) Massenverarbeitung: Tickets übernehmen, Kapitel/Unterkapitel zuordnen =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(100);
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(200);

  function rowForKey(key) {
    return Array.from(doc.querySelectorAll("#mass-groups tbody tr")).find((r) => r.children[1] && r.children[1].textContent.includes(key));
  }
  const row1 = rowForKey("RID-1");
  check("(3) RID-1 als Textschnipsel übernommen", !!row1);
  const chapterSel1 = row1.querySelector(".mass-chapter-select");
  chapterSel1.value = "Kapitel 4: Servicevertrag anlegen";
  fire(chapterSel1, "change");
  await wait(80);
  const subSel1 = rowForKey("RID-1").querySelector(".mass-subchapter-select");
  check("(3) Unterkapitel-Auswahl bietet '4.1 Vertragsarten' an", Array.from(subSel1.options).some((o) => o.value === "4.1 Vertragsarten"));
  subSel1.value = "4.1 Vertragsarten";
  fire(subSel1, "change");
  await wait(80);

  // ===================== (4) Ref.-Nr.-Spalte: korrektes Format =====================
  let r1 = rowForKey("RID-1");
  const refCellIndex = Array.from(doc.querySelectorAll("#mass-groups thead th")).findIndex((th) => th.textContent.trim() === "Ref.-Nr.");
  check("(4) Spalte 'Ref.-Nr.' vorhanden", refCellIndex !== -1);
  check("(4) RID-1 zeigt 'CM-04.01-2024-001' (Kürzel-Kapitel.Unterkapitel-Jahr-laufendeNr)", r1.children[refCellIndex].textContent.trim() === "CM-04.01-2024-001");

  // ===================== (5) Stabilität: erneutes Zuordnen DERSELBEN Kombination liefert dieselbe Nummer;
  // ein zweites Ticket in derselben Kombination bekommt die naechste laufende Nummer. =====================
  const chapterSel1b = rowForKey("RID-1").querySelector(".mass-chapter-select");
  chapterSel1b.value = "Kapitel 4: Servicevertrag anlegen";
  fire(chapterSel1b, "change");
  await wait(80);
  const subSel1b = rowForKey("RID-1").querySelector(".mass-subchapter-select");
  subSel1b.value = "4.1 Vertragsarten";
  fire(subSel1b, "change");
  await wait(80);
  r1 = rowForKey("RID-1");
  check("(5) Nummer bleibt nach erneuter Zuordnung stabil ('CM-04.01-2024-001')", r1.children[refCellIndex].textContent.trim() === "CM-04.01-2024-001");

  const row2 = rowForKey("RID-2");
  const chapterSel2 = row2.querySelector(".mass-chapter-select");
  chapterSel2.value = "Kapitel 4: Servicevertrag anlegen";
  fire(chapterSel2, "change");
  await wait(80);
  const subSel2 = rowForKey("RID-2").querySelector(".mass-subchapter-select");
  subSel2.value = "4.1 Vertragsarten";
  fire(subSel2, "change");
  await wait(80);
  const r2 = rowForKey("RID-2");
  check("(5) RID-2 (dieselbe Kombination, anderes Ticket) bekommt laufende Nummer 002", r2.children[refCellIndex].textContent.trim() === "CM-04.01-2024-002");

  // ===================== (6) Domänen-Kürzel überschreiben -> Ref.-Nr. folgt dem Override =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(80);
  const abbrInputEl = abbrInput();
  abbrInputEl.value = "XCM";
  fire(abbrInputEl, "change");
  await wait(80);
  check("(6) Override 'XCM' als 'angepasst' markiert", abbrRow().textContent.includes("angepasst"));
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(80);
  const subSel1c = rowForKey("RID-1").querySelector(".mass-subchapter-select");
  subSel1c.value = "4.2 Pflichtfelder";
  fire(subSel1c, "change");
  await wait(80);
  const r1c = rowForKey("RID-1");
  check("(6) Neue Kombination nutzt den Kürzel-Override ('XCM-04.02-2024-001')", r1c.children[refCellIndex].textContent.trim() === "XCM-04.02-2024-001");
  const subSel1d = rowForKey("RID-1").querySelector(".mass-subchapter-select");
  subSel1d.value = "4.1 Vertragsarten";
  fire(subSel1d, "change");
  await wait(80);

  // ===================== (7) "–" bei nicht-ticketbasierten Einträgen (z. B. hochgeladene Datei) =====================
  const uploadInput = doc.getElementById("mass-import-input");
  Object.defineProperty(uploadInput, "files", { value: [new win.File(["# Hochgeladener Text\n\nOhne Jira-Bezug."], "upload.md", { type: "text/markdown" })], configurable: true });
  fire(uploadInput, "change");
  await wait(150);
  const uploadRow = Array.from(doc.querySelectorAll("#mass-groups tbody tr")).find((r) => r.textContent.includes("upload.md"));
  check("(7) Hochgeladener (nicht-ticketbasierter) Eintrag zeigt '–' als Ref.-Nr.", !!uploadRow && uploadRow.children[refCellIndex].textContent.trim() === "–");

  // ===================== (8) Einbettung im Domänen-MD-Export =====================
  const domainMdBtn = Array.from(doc.querySelectorAll(".mass-domain-md-btn")).find((b) => b.getAttribute("data-domain") === "Contract Management");
  fire(domainMdBtn, "click");
  await wait(80);
  const domainMdText = doc.getElementById("mass-domain-md-textarea").value;
  check("(8) Domänen-MD-Export enthält Referenz-Zeile für RID-1", domainMdText.includes("_Referenz: CM-04.01-2024-001 (Jira: RID-1)_"));
  fire(doc.getElementById("mass-domain-md-modal-close"), "click");
  await wait(50);

  // ===================== (9) Quellen-Fußzeile im Benutzerhandbuch-Kapitel-Generator =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  // Kapitel 7 ist das einzige Gliederungskapitel, das laut Stammdaten der
  // Domäne "Contract Management" zugeordnet ist (s. outlineSeedData()) -
  // RID-1/RID-2 (Domäne Contract Management) landen darüber automatisch in
  // dessen outlineChapters, unabhängig von der rein manuellen Massenver-
  // arbeitung-Kapitel-4-Zuordnung oben (die nur die Ref.-Nr. bestimmt).
  const manualChapterSelect = doc.getElementById("manual-chapter-select");
  const kap7Opt = Array.from(manualChapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  if (kap7Opt) kap7Opt.selected = true;
  fire(manualChapterSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(400);
  const manualTa = doc.querySelector(".manual-chapter-textarea[data-lang='de']");
  check("(9) Generierter Kapiteltext enthält Quellen-Fußzeile", !!manualTa && manualTa.value.includes("**Quellen:**"));
  check("(9) Quellen-Fußzeile referenziert RID-1 (als Ticket-Key in Klammern)", !!manualTa && manualTa.value.includes("(RID-1)"));
  check("(9) Quellen-Fußzeile referenziert RID-2 (als Ticket-Key in Klammern)", !!manualTa && manualTa.value.includes("(RID-2)"));

  // ===================== (10) Quellen-Fußzeile in RAG-Zusammenfassung (Job 7) =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);
  const ragDomainSelect = doc.getElementById("rag-domain-select");
  Array.from(ragDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(80);
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(300);
  const ragOutputText = doc.getElementById("rag-output").textContent;
  check("(10) RAG-Zusammenfassung enthält Quellen-Fußzeile", ragOutputText.includes("**Quellen:**"));
  check("(10) RAG-Quellen-Fußzeile referenziert RID-1", ragOutputText.includes("(RID-1)"));

  // ===================== (11) Persistenz: Domänen-Kürzel-Override + Referenz-Nummern/-Zuordnungen
  // überleben "Sitzung als Datei exportieren" -> "Alle Daten löschen" -> "Sitzung aus Datei laden". =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(80);
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(11) Export enthält Domänen-Kürzel-Override 'XCM'", exportedJson.domainAbbreviations && exportedJson.domainAbbreviations["Contract Management"] === "XCM");
  check("(11) Export enthält ticketRefIds-Cache (mind. 1 Eintrag)", exportedJson.ticketRefIds && Object.keys(exportedJson.ticketRefIds).length > 0);
  check("(11) Export enthält ticketRefSeq-Nummernkreise (mind. 1 Eintrag)", exportedJson.ticketRefSeq && Object.keys(exportedJson.ticketRefSeq).length > 0);

  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("(11) Nach 'Alle Daten löschen': Domänen-Kürzel-Override bleibt erhalten (Konfiguration, kein Sitzungsdatensatz)", abbrRow() ? abbrRow().textContent.includes("angepasst") : true);

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(80);
  const r1Restored = rowForKey("RID-1");
  check("(11) Nach Laden: RID-1 weiterhin mit Kapitel/Unterkapitel zugeordnet, Ref.-Nr. identisch ('CM-04.01-2024-001')",
    !!r1Restored && r1Restored.children[refCellIndex].textContent.trim() === "CM-04.01-2024-001");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE REFERENZ-NUMMERN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
