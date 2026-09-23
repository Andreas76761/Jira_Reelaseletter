const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
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

// Erste Datei: enthaelt einen Namen (Assignee/Reporter -> PersonAnonymizer),
// eine E-Mail-Adresse und eine VIN in der Beschreibung (-> redactText/PII-
// Muster) sowie ein Issue-Link (Phase A) - prueft, dass die Dateiansicht
// ausschliesslich die BEREITS bereinigten Werte zeigt, nie die Rohdaten.
const xml1 = `<?xml version="1.0"?><rss><channel>
  <item>
    <key>FV-1</key>
    <summary>Erstes Ticket</summary>
    <description>Kontakt: max.mueller@example.com, Fahrgestellnummer WVWZZZ1JZXW000001</description>
    <status>Offen</status>
    <type>Task</type>
    <assignee username="mmueller">Max Mueller</assignee>
    <reporter username="aschmidt">Anna Schmidt</reporter>
    <customfields>
      <customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Domain A</customfieldvalue></customfieldvalues></customfield>
    </customfields>
    <issuelinks>
      <issuelinktype><name>Link</name><outwardlinks desc="blocks"><issuelink><issuekey id="1">FV-2</issuekey></issuelink></outwardlinks></issuelinktype>
    </issuelinks>
  </item>
  <item>
    <key>FV-2</key>
    <summary>Zweites Ticket</summary>
    <status>Fertig</status>
    <type>Task</type>
  </item>
</channel></rss>`;

// Zweite Datei: separater Import, damit der Dateiansicht-Datei-Filter
// geprueft werden kann (nur Tickets DIESER Datei duerfen erscheinen).
const xml2 = `<?xml version="1.0"?><rss><channel>
  <item><key>FV-3</key><summary>Drittes Ticket aus zweiter Datei</summary><status>Offen</status><type>Task</type></item>
</channel></rss>`;

// Dritte Datei: XSS-Probe - ein boesartiger customfieldname (aus dem XML
// frei waehlbar) darf beim Rendern in .innerHTML NICHT als echtes Tag
// landen (s. Fix in ticketToReadableXml()/tag()).
const xssFieldName = '"><img src=x onerror=alert(1)>';
const xml3 = `<?xml version="1.0"?><rss><channel>
  <item>
    <key>FV-4</key>
    <summary>XSS-Testticket</summary>
    <status>Offen</status>
    <type>Task</type>
    <customfields>
      <customfield><customfieldname>${xssFieldName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</customfieldname><customfieldvalues><customfieldvalue>Wert</customfieldvalue></customfieldvalues></customfield>
    </customfields>
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

  Object.defineProperty(input, "files", { value: [new win.File([xml1], "erste_datei.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  Object.defineProperty(input, "files", { value: [new win.File([xml2], "zweite_datei.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  Object.defineProperty(input, "files", { value: [new win.File([xml3], "dritte_datei.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Nav/Panel: Dateiansicht am Ende des Import-Bereichs =====================
  check("Import-Panel enthaelt den Dateiansicht-Auswahl-Select", !!doc.getElementById("fileview-import-select"));
  const importPanel = doc.querySelector('[data-view-panel="import"]');
  const allChildren = Array.from(importPanel.querySelectorAll("*"));
  const fileviewSelectPos = allChildren.indexOf(doc.getElementById("fileview-import-select"));
  const pasteBtnPos = allChildren.indexOf(doc.getElementById("paste-process-btn"));
  // Reihenfolge statt starrer Prozent-Schwelle pruefen (robust gegenueber
  // spaeter angehaengten weiteren Import-Abschnitten, z.B. Import-Statistik):
  // Dateiansicht muss nach den eigentlichen Import-Mechanismen (Tabs/
  // Dropzone/Zwischenablage) kommen.
  check("Dateiansicht-Bereich steht nach den Import-Mechanismen (Tabs/Dropzone/Zwischenablage)", pasteBtnPos !== -1 && fileviewSelectPos > pasteBtnPos);

  const select = doc.getElementById("fileview-import-select");
  const btn = doc.getElementById("fileview-show-btn");

  // ===================== Auswahl-Select gefuellt, Button erst nach Auswahl aktiv =====================
  const options = Array.from(select.options).map((o) => o.textContent);
  check("Select listet alle 3 importierten Dateien", options.some((t) => t.includes("erste_datei.xml")) && options.some((t) => t.includes("zweite_datei.xml")) && options.some((t) => t.includes("dritte_datei.xml")));
  check("Button 'Dateiansicht' ohne Auswahl deaktiviert", btn.disabled === true);

  var firstOption = Array.from(select.options).filter((o) => o.textContent.includes("erste_datei.xml"))[0];
  select.value = firstOption.value;
  fire(select, "change");
  check("Button 'Dateiansicht' nach Auswahl aktiviert", btn.disabled === false);

  fire(btn, "click");
  await wait(100);

  const wrap = doc.getElementById("fileview-wrap");
  check("Dateiansicht-Panel nach Klick sichtbar", wrap.hidden === false);
  const content = doc.getElementById("fileview-content").innerHTML;

  // ===================== Nur Tickets DIESER Datei angezeigt =====================
  check("FV-1 (aus erste_datei.xml) in der Ansicht", content.includes("FV-1"));
  check("FV-2 (aus erste_datei.xml) in der Ansicht", content.includes("FV-2"));
  check("FV-3 (aus zweite_datei.xml) NICHT in der Ansicht", !content.includes("FV-3"));

  // ===================== Bereinigte/redigierte Anzeige, keine Rohdaten =====================
  check("Name 'Max Mueller' NICHT im Klartext sichtbar (pseudonymisiert)", !content.includes("Max Mueller"));
  check("Name 'Anna Schmidt' NICHT im Klartext sichtbar (pseudonymisiert)", !content.includes("Anna Schmidt"));
  check("Pseudonym 'Person 1' stattdessen sichtbar", content.includes("Person 1"));
  check("E-Mail-Adresse NICHT im Klartext sichtbar", !content.includes("max.mueller@example.com"));
  check("Platzhalter '[E-Mail entfernt]' sichtbar", content.includes("[E-Mail entfernt]"));
  check("VIN NICHT im Klartext sichtbar", !content.includes("WVWZZZ1JZXW000001"));
  check("Platzhalter '[FIN/VIN entfernt]' sichtbar", content.includes("[FIN/VIN entfernt]"));
  check("Hinweistext erklaert 'bereinigte' Ansicht, nicht Originaldatei", doc.getElementById("fileview-summary").textContent.toLowerCase().includes("bereinigt"));

  // ===================== Issue-Link (Phase A) korrekt im XML-Block sichtbar =====================
  check("Issue-Link zu FV-2 im pseudo-XML-Block sichtbar", content.includes("issuelink") && content.includes("FV-2"));

  // ===================== FILEVIEW_MAX_TICKETS-Kappung: Hinweistext bei Ueberschreitung =====================
  // (mit nur 2 Tickets in dieser Datei nicht ausgeloest - separater Smoke-Test
  // fuer die reine Anwesenheit der Kappungslogik im Quelltext.)
  const srcHasCap = fragment.includes("FILEVIEW_MAX_TICKETS");
  check("Kappungslogik FILEVIEW_MAX_TICKETS im gebauten Code vorhanden", srcHasCap);

  // ===================== XSS: bösartiger Custom-Field-Name wird sicher entschärft =====================
  var thirdOption = Array.from(select.options).filter((o) => o.textContent.includes("dritte_datei.xml"))[0];
  select.value = thirdOption.value;
  fire(select, "change");
  fire(btn, "click");
  await wait(100);
  const xssContent = doc.getElementById("fileview-content").innerHTML;
  check("XSS-Payload im Custom-Field-Namen NICHT als echtes <img>-Tag im DOM", !doc.getElementById("fileview-content").querySelector("img"));
  check("XSS-Payload als Text sichtbar (escaped), Ticket FV-4 gerendert", xssContent.includes("FV-4"));

  // ===================== Kein Rohtext (Dateiquelltext) im DOM sichtbar =====================
  check("Roh-XML-Deklaration '<?xml' nicht im gerenderten Inhalt", !content.includes("<?xml"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DATEIANSICHT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
