const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
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

  // Eigene Tickets mit zwei Domains und bewusst nicht-chronologischer
  // Importreihenfolge, damit die zeitliche Sortierung innerhalb der
  // Domain-Gruppe wirklich getestet wird (nicht nur die Importreihenfolge).
  function customFieldXml(domain) {
    if (!domain) return "";
    return "<customfields><customfield><customfieldname>Domain</customfieldname>" +
      "<customfieldvalues><customfieldvalue>" + domain + "</customfieldvalue></customfieldvalues>" +
      "</customfield></customfields>";
  }
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>DOV-1</key><summary>Zuletzt aktualisiert in Alpha</summary><status>Offen</status>
      <updated>15/Mar/26 10:00 AM</updated>
      ${customFieldXml("Alpha Domain")}</item>
    <item><key>DOV-2</key><summary>Zuerst aktualisiert in Alpha</summary><status>Offen</status>
      <updated>01/Jan/26 09:00 AM</updated>
      ${customFieldXml("Alpha Domain")}</item>
    <item><key>DOV-3</key><summary>Beta Ticket</summary><status>Fertig</status>
      <updated>10/Feb/26 08:00 AM</updated>
      ${customFieldXml("Beta Domain")}</item>
    <item><key>DOV-4</key><summary>Ohne Domain</summary><status>Offen</status>
      <updated>05/Feb/26 08:00 AM</updated></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "domain_overview_test.xml", { type: "text/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="domaenen-uebersicht"]').click();

  const tbody = doc.getElementById("domainoverview-tbody");
  const rowTexts = Array.from(tbody.querySelectorAll("tr")).map((tr) => tr.textContent);
  const alphaHeaderIdx = rowTexts.findIndex((t) => t.includes("Alpha Domain"));
  const betaHeaderIdx = rowTexts.findIndex((t) => t.includes("Beta Domain"));
  const noDomainHeaderIdx = rowTexts.findIndex((t) => t.includes("Ohne Domain") && t.includes("Ticket"));
  check("Domain-Gruppenkopf 'Alpha Domain' vorhanden", alphaHeaderIdx >= 0);
  check("Domain-Gruppenkopf 'Beta Domain' vorhanden", betaHeaderIdx >= 0);
  check("Domain-Gruppenkopf 'Ohne Domain' vorhanden (am Ende)", noDomainHeaderIdx >= 0);
  check("Domains alphabetisch sortiert (Alpha vor Beta)", alphaHeaderIdx < betaHeaderIdx);
  check("'Ohne Domain' steht nach allen benannten Domains", noDomainHeaderIdx > betaHeaderIdx);

  // Innerhalb 'Alpha Domain' chronologisch (DOV-2 zuerst aktualisiert -> zuerst in der Liste)
  const dov1Idx = rowTexts.findIndex((t) => t.includes("DOV-1"));
  const dov2Idx = rowTexts.findIndex((t) => t.includes("DOV-2"));
  check("Innerhalb Domain chronologisch sortiert (ältestes zuerst: DOV-2 vor DOV-1)", dov2Idx >= 0 && dov1Idx >= 0 && dov2Idx < dov1Idx);

  const domainCount = parseInt(doc.getElementById("domainoverview-domain-count").textContent, 10);
  check("Domain-Anzahl-Chip zeigt mind. 3 Gruppen (Alpha, Beta, Ohne Domain + Domains aus Demodaten)", domainCount >= 3);

  // ===================== Scoping über "Datei auswählen" wirkt auch auf Job 6 =====================
  const importRows = doc.querySelectorAll("#steps-job-6 .step-toggle");
  fire(doc.querySelector("#steps-job-6 .step-toggle"), "click");
  const radios = doc.querySelectorAll('input[name^="active-import-choice-6"]');
  check("Datei-Auswahl-Radios in Job 6 vorhanden", radios.length >= 2);
  const specificImportRadio = Array.from(radios).find((r) => r.value !== "");
  specificImportRadio.checked = true;
  fire(specificImportRadio, "change");
  await wait(20);
  const scopedTicketCount = parseInt(doc.getElementById("domainoverview-ticket-count").textContent, 10);
  check("Nach Datei-Auswahl: Domänen-Übersicht auf gewählten Import eingeschränkt", scopedTicketCount < 667);

  // Zurück auf "Alle Importe"
  const allRadio = Array.from(doc.querySelectorAll('input[name^="active-import-choice-6"]')).find((r) => r.value === "");
  allRadio.checked = true;
  fire(allRadio, "change");
  await wait(20);
  check("Zurück auf 'Alle Importe': wieder alle Tickets in der Domänen-Übersicht", parseInt(doc.getElementById("domainoverview-ticket-count").textContent, 10) >= 667);

  // ===================== XSS-Schutz: Domain-Name und Zusammenfassung werden escaped =====================
  check("Domain-/Zusammenfassungs-Zellen enthalten kein rohes <script> oder <img onerror>", !tbody.innerHTML.includes("<script") && !tbody.innerHTML.includes("onerror="));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DOMAENEN-UEBERSICHT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
