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
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

// Drei Tickets mit bewusst UNTERSCHIEDLICHER Feldbelegung, um die
// Abdeckungs-Berechnung (computeImportFieldStats) praezise zu pruefen:
// STAT-1 hat alle Kernfelder + Kommentare/Beobachter + ein Zusatzfeld,
// STAT-2 fehlen Priorität/Kommentare, STAT-3 fehlen Priorität/Labels/
// Beobachter und hat KEIN Zusatzfeld.
const xml = `<?xml version="1.0"?><rss><channel>
  <item>
    <key>STAT-1</key><summary>Erstes</summary><description>Beschreibung 1</description>
    <status>Offen</status><type>Task</type><priority>Hoch</priority>
    <labels><label>wichtig</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Domain A</customfieldvalue></customfieldvalues></customfield></customfields>
    <watches><watcher>Anna</watcher></watches>
    <comments><comment author="Anna" created="2026-01-01">Kommentartext</comment></comments>
  </item>
  <item>
    <key>STAT-2</key><summary>Zweites</summary><description>Beschreibung 2</description>
    <status>Offen</status><type>Task</type>
    <labels><label>dringend</label></labels>
  </item>
  <item>
    <key>STAT-3</key><summary>Drittes</summary><description>Beschreibung 3</description>
    <status>Offen</status><type>Task</type>
  </item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "stat_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Statistik-Bereich am Ende von Import, automatisch nach dem Import sichtbar =====================
  const summaryText = doc.getElementById("importstats-summary").textContent;
  check("Import-Statistik zeigt automatisch den soeben importierten Import (kein Klick nötig)", summaryText.includes("stat_test.xml"));
  check("Import-Statistik nennt die Ticketanzahl (3)", summaryText.includes("3 Ticket"));

  const tbodyText = doc.getElementById("importstats-tbody").textContent;
  check("Feld 'Status' mit 3/3 (100%) Abdeckung", /Status[\s\S]{0,40}3\/3 \(100%\)/.test(tbodyText));
  check("Feld 'Priorität' mit 1/3 (33%) Abdeckung (nur STAT-1)", /Priorität[\s\S]{0,40}1\/3 \(33%\)/.test(tbodyText));
  check("Feld 'Projekt' mit 0/3 (0%) Abdeckung (in keinem Ticket vorhanden)", /Projekt[\s\S]{0,40}0\/3 \(0%\)/.test(tbodyText));
  check("Feld 'Labels' mit 2/3 (67%) Abdeckung (STAT-1 + STAT-2)", /Labels[\s\S]{0,40}2\/3 \(67%\)/.test(tbodyText));

  // ===================== Zusatzfelder (custom_fields) separat ausgewiesen =====================
  check("Zusatzfeld 'Domain' wird als Zusatzfeld gelistet (1/3, nur STAT-1)", /Domain[\s\S]{0,40}1\/3 \(33%\)/.test(tbodyText));
  check("Abschnittsüberschrift 'Zusatzfelder' vorhanden", tbodyText.includes("Zusatzfelder"));

  // ===================== Kommentare/Beobachter separat als "immer aus Datenschutzgründen entfernt" =====================
  check("Hinweis 'Aus Datenschutzgründen' erscheint als eigener Abschnitt", tbodyText.includes("Aus Datenschutzgründen"));
  check("Kommentare-Zeile nennt 1 von 3 Tickets (STAT-1 hatte einen Kommentar in der Quelle)", tbodyText.includes("1 von 3 Ticket(s) hatten dies in der Quelle") && tbodyText.includes("Kommentare"));

  // ===================== Farbbalken (coverage-bar) im DOM vorhanden =====================
  check("Abdeckungsbalken (coverage-bar) werden gerendert", !!doc.querySelector(".coverage-bar"));
  check("0%-Balken bekommt die Klasse 'empty' (sichtbar statt unsichtbar bei 0 Breite)", !!doc.querySelector(".coverage-bar-fill.empty"));
  check("100%-Balken bekommt die Klasse 'full'", !!doc.querySelector(".coverage-bar-fill.full"));

  // ===================== Zweiter Import: Einzelticket-Fixture - Statistik springt automatisch auf den neuen Import =====================
  doc.querySelector('.import-tab[data-mode="einzelticket"]').click();
  const singleHtml = fs.readFileSync(path.join(FIXTURES, "single_ticket_sample.html"), "utf-8");
  Object.defineProperty(input, "files", { value: [new win.File([singleHtml], "ONESCM-50123.html", { type: "text/html" })], configurable: true });
  fire(input, "change");
  await wait(400);
  const summaryText2 = doc.getElementById("importstats-summary").textContent;
  check("Nach neuem Import springt Statistik automatisch auf DIESEN Import (kein manueller Klick nötig)", summaryText2.includes("ONESCM-50123.html"));
  const tbodyText2 = doc.getElementById("importstats-tbody").textContent;
  check("Einzelticket-Statistik: 'Projekt' 0/1 (0%, im Fixture nicht vorhanden)", /Projekt[\s\S]{0,40}0\/1 \(0%\)/.test(tbodyText2));
  check("Einzelticket-Statistik: 'Bearbeiter' 1/1 (100%, im Fixture vorhanden)", /Bearbeiter[\s\S]{0,40}1\/1 \(100%\)/.test(tbodyText2));
  check("Einzelticket-Statistik: Zusatzfeld 'Domain' vorhanden (1/1)", /Domain[\s\S]{0,40}1\/1 \(100%\)/.test(tbodyText2));

  // ===================== Manuelle Auswahl eines älteren Imports bleibt bei unabhängigem Re-Render erhalten =====================
  const select = doc.getElementById("importstats-import-select");
  const firstOption = Array.from(select.options).filter((o) => o.textContent.includes("stat_test.xml"))[0];
  select.value = firstOption.value;
  fire(select, "change");
  await wait(100);
  check("Manuelle Auswahl des älteren Imports übernommen", doc.getElementById("importstats-summary").textContent.includes("stat_test.xml"));
  // Ein unabhängiges Re-Render (Dashboard-Suche) darf die manuelle Auswahl NICHT zuruecksetzen.
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "STAT";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  check("Manuelle Auswahl bleibt nach unabhängigem Re-Render (Suche) erhalten", doc.getElementById("importstats-summary").textContent.includes("stat_test.xml"));

  // ===================== XSS-Sicherheit: Feld-/Zusatzfeldnamen werden escaped =====================
  const xssXml = `<?xml version="1.0"?><rss><channel><item><key>STAT-XSS</key><summary>XSS</summary><status>Offen</status><type>Task</type>` +
    `<customfields><customfield><customfieldname>&lt;img src=x onerror=alert(1)&gt;</customfieldname><customfieldvalues><customfieldvalue>Wert</customfieldvalue></customfieldvalues></customfield></customfields></item></channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xssXml], "xss_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("Kein <img>-Tag durch bösartigen Zusatzfeldnamen im Statistik-DOM", !doc.getElementById("importstats-tbody").querySelector("img"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE IMPORT-STATISTIK-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
