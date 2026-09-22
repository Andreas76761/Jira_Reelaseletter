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

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Bugfix: "Typ"-Spalte aus Releaseinfo-Tabelle wird jetzt erkannt =====================
  const releaseinfoTxt = `Contract Management ( CM-1.0 ) - Domain: Contract Management
Schlüssel\tStatus\tTyp\tZusammenfassung\tBeschreibung
RTYP-1\tOffen\tEpic\tGrosses Vorhaben\tAusführliche Beschreibung des Vorhabens`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([releaseinfoTxt], "typ_test.txt", { type: "text/plain" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  let row = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("RTYP-1"));
  check("Releaseinfo-Ticket mit 'Typ'-Spalte gefunden", !!row);
  check("Releaseinfo: 'Typ'-Spalte wird korrekt als Typ 'Epic' erkannt (nicht mehr '–')", !!row && row.querySelectorAll("td")[6].textContent.trim() === "Epic");
  check("Releaseinfo: 'Beschreibung'-Spalte landet im description-Feld (nicht nur custom_fields)", !!row && row.querySelectorAll("td")[2].textContent.includes("Ausführliche Beschreibung"));

  // ===================== Bugfix: Icon-only Typ-Zelle (nur <img alt="..">, kein Text) wird jetzt gelesen =====================
  const htmlIconOnly = `<html><body><table id="issuetable"><thead><tr>
    <th data-id="issuetype">T</th><th data-id="issuekey">Key</th><th data-id="summary">Summary</th><th data-id="status">Status</th>
  </tr></thead><tbody>
  <tr data-issuekey="ICON-1">
    <td class="issuetype"><img src="epic.png" alt="Epic" title="Epic" width="16" height="16"></td>
    <td class="issuekey">ICON-1</td>
    <td class="summary">Icon-only Typ-Zelle</td>
    <td class="status">Offen</td>
  </tr>
  </tbody></table></body></html>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([htmlIconOnly], "icon_only.html", { type: "text/html" })], configurable: true });
  fire(input, "change");
  await wait(300);
  check("Icon-only-HTML-Import erfolgreich (kein Absturz)", doc.getElementById("toast").textContent.includes("Import erfolgreich"));
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  row = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("ICON-1"));
  check("Icon-only Typ-Zelle: Typ 'Epic' aus img[alt] erkannt (nicht mehr leer)", !!row && row.querySelectorAll("td")[6].textContent.trim() === "Epic");

  // ===================== Dashboard: Beschreibung rechts von Schlüssel, Datum ohne Uhrzeit =====================
  const xmlQ = `<?xml version="1.0"?><rss><channel>
    <item><key>Q-1</key><summary>Epic-Ticket</summary>
      <description>Eine Beschreibung, die deutlich länger als die sichtbare Spaltenbreite ist und daher optisch gekürzt werden sollte.</description>
      <status>Offen</status><type>Epic</type>
      <created>20/Dez/24 4:41 PM</created><updated>18/Jun/26 12:11 PM</updated></item>
    <item><key>Q-2</key><summary>Bug-Ticket</summary><description>Bug-Beschreibung</description><status>Offen</status><type>Bug</type></item>
    <item><key>Q-3</key><summary>Reporting-Ticket</summary><description>Reporting-Beschreibung</description><status>Offen</status><type>Reporting</type></item>
    <item><key>Q-4</key><summary>Testing-Ticket</summary><description>Testing-Beschreibung</description><status>Offen</status><type>Testing</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlQ], "q.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "Q-";
  fire(doc.getElementById("search-input"), "input");
  await wait(250);

  // Gezielt die Tabelle mit #table-body (nicht "thead th" global) - seit der
  // "Jira Zuordnung"-Tabelle im Dashboard gibt es mehrere <thead> dort.
  const headers = Array.from(doc.getElementById("table-body").closest("table").querySelectorAll("thead th")).map((th) => th.textContent.trim());
  check("Dashboard-Tabellenkopf: 'Beschreibung' direkt nach 'Schlüssel'", headers[1].startsWith("Schlüssel") && headers[2].startsWith("Beschreibung"));

  const q1Row = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("Q-1"));
  const q1Cells = q1Row.querySelectorAll("td");
  check("Dashboard: Beschreibungs-Zelle direkt rechts von Schlüssel-Zelle", q1Cells[1].textContent.trim() === "Q-1" && q1Cells[2].classList.contains("description"));
  check("Dashboard: Beschreibung wird optisch gekürzt (Zelltext kürzer als Original)", q1Cells[2].textContent.length < 100 && q1Cells[2].textContent.includes("…"));
  check("Dashboard: volle Beschreibung im title-Attribut für Hover-Tooltip erhalten", q1Cells[2].getAttribute("title").includes("deutlich länger"));
  check("Dashboard: Erstellt-Datum ohne Uhrzeit angezeigt ('20/Dez/24', nicht '4:41 PM')", q1Cells[7].textContent.trim() === "20/Dez/24");
  check("Dashboard: Aktualisiert-Datum ohne Uhrzeit angezeigt ('18/Jun/26', nicht '12:11 PM')", q1Cells[8].textContent.trim() === "18/Jun/26");

  // Sortierung bleibt trotz gekürzter Anzeige nach vollem Zeitstempel (Uhrzeit fließt weiterhin in die Sortierung ein)
  const createdHeader = doc.querySelector('thead th[data-key="created"]');
  fire(createdHeader, "click");
  await wait(50);
  check("Sortierung nach 'Erstellt' funktioniert weiterhin ohne Fehler (Uhrzeit bleibt Sortierkriterium, nur Anzeige gekürzt)", errors.length === 0);

  // ===================== 4 neue Typ-Schnellfilter-Presets =====================
  const presetBtns = Array.from(doc.querySelectorAll("#type-quick-presets .import-tab"));
  check("4 Schnellfilter-Presets vorhanden", presetBtns.length === 4);
  ["Ohne Bugs", "Nur Epics", "Ohne Reporting", "Ohne Testing"].forEach((label) => {
    check("Preset-Button '" + label + "' vorhanden", presetBtns.some((b) => b.textContent === label));
  });

  const noBugBtn = presetBtns.find((b) => b.textContent === "Ohne Bugs");
  fire(noBugBtn, "click");
  await wait(50);
  check("'Ohne Bugs' blendet Q-2 (Bug) aus", !Array.from(doc.querySelectorAll("#table-body tr")).some((r) => r.textContent.includes("Q-2")));
  check("'Ohne Bugs' lässt Q-1 (Epic) weiterhin sichtbar", Array.from(doc.querySelectorAll("#table-body tr")).some((r) => r.textContent.includes("Q-1")));
  check("'Ohne Bugs'-Button ist nach Klick aktiv markiert", noBugBtn.className.includes("active"));

  const onlyEpicBtn = presetBtns.find((b) => b.textContent === "Nur Epics");
  fire(onlyEpicBtn, "click");
  await wait(50);
  check("'Nur Epics' zeigt genau 1 Ticket (Q-1)", doc.getElementById("result-count").innerHTML.includes("<b>1</b>"));
  check("'Ohne Bugs' bleibt zusätzlich aktiv (Presets sind kombinierbar)", noBugBtn.className.includes("active"));
  fire(onlyEpicBtn, "click"); // wieder ausschalten
  fire(noBugBtn, "click"); // wieder ausschalten
  await wait(50);

  const noReportBtn = presetBtns.find((b) => b.textContent === "Ohne Reporting");
  const noTestBtn = presetBtns.find((b) => b.textContent === "Ohne Testing");
  fire(noReportBtn, "click");
  fire(noTestBtn, "click");
  await wait(50);
  const visibleAfter = Array.from(doc.querySelectorAll("#table-body tr")).map((r) => r.textContent);
  check("'Ohne Reporting' + 'Ohne Testing' kombiniert: Q-3 (Reporting) ausgeblendet", !visibleAfter.some((t) => t.includes("Q-3")));
  check("'Ohne Reporting' + 'Ohne Testing' kombiniert: Q-4 (Testing) ausgeblendet", !visibleAfter.some((t) => t.includes("Q-4")));
  check("'Ohne Reporting' + 'Ohne Testing' kombiniert: Q-1 (Epic) weiterhin sichtbar", visibleAfter.some((t) => t.includes("Q-1")));
  check("'Ohne Reporting' + 'Ohne Testing' kombiniert: Q-2 (Bug) weiterhin sichtbar", visibleAfter.some((t) => t.includes("Q-2")));

  fire(doc.getElementById("reset-filter-btn"), "click");
  await wait(50);
  check("'Filter zurücksetzen' deaktiviert alle 4 Presets wieder", presetBtns.every((b) => !b.className.includes("active")));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TYP/BESCHREIBUNG/SCHNELLFILTER-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
