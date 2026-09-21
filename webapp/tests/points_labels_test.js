const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });
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

  // Eigene Tickets mit bekannten Typen/Text fuer Punkte- und Label-Zuordnung importieren
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>PL-1</key><summary>Neues Feature fuer Dealer Portal</summary>
      <description>Betrifft den Market-Bereich und das Vehicle-Modul.</description>
      <status>Offen</status><type>Epic</type></item>
    <item><key>PL-2</key><summary>Fehler in der Preisberechnung</summary>
      <description>Price-Feld zeigt falschen Wert.</description>
      <status>Offen</status><type>Bug</type></item>
    <item><key>PL-3</key><summary>Unbekannter Typ ohne Punkte-Eintrag</summary>
      <description>Kein Label-Treffer hier.</description>
      <status>Offen</status><type>Sonderfall-XYZ</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "points_labels_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Einstellungen: Punkte-System Standardwerte =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const pointsRows = () => Array.from(doc.querySelectorAll("#points-tbody tr"));
  check("5 Standard-Tickettypen im Punkte-System", pointsRows().length === 5);
  const epicRow = pointsRows().find((r) => r.textContent.includes("Epic"));
  check("Epic = 5 Punkte (Standardwert)", !!epicRow && epicRow.querySelector(".points-value-input").value === "5");
  const bugRow = pointsRows().find((r) => r.textContent.includes("Bug"));
  check("Bug = 1 Punkt (Standardwert)", !!bugRow && bugRow.querySelector(".points-value-input").value === "1");

  // ===================== Einstellungen: Labels Standardwerte =====================
  const labelsText = doc.getElementById("labels-list").textContent;
  ["Market", "HQ", "Dealer", "Vehicle", "Finance", "Claim", "Product", "Van", "PC", "Price", "Prolongation"].forEach((lbl) => {
    check("Standard-Label '" + lbl + "' vorhanden", labelsText.includes(lbl));
  });

  // ===================== Verarbeitung Job 4: neue Spalten + automatische Zuordnung =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const headers4 = Array.from(doc.querySelectorAll("#releaseversion-table thead th")).map((th) => th.textContent);
  check("Job-4-Tabelle hat 7 Spalten (Ticket/Typ/Domäne/Status/Beschreibung/Priorität/Labels)", headers4.length === 7);
  check("Job-4-Header enthält 'Typ'", headers4.includes("Typ"));
  check("Job-4-Header enthält 'Beschreibung'", headers4.includes("Beschreibung"));
  check("Job-4-Header enthält 'Priorität (Punkte)'", headers4.includes("Priorität (Punkte)"));
  check("Job-4-Header enthält 'Labels'", headers4.includes("Labels"));

  function rowFor(key, tbodyId) {
    return Array.from(doc.querySelectorAll("#" + tbodyId + " tr")).find((tr) => tr.textContent.includes(key));
  }
  const pl1Row = rowFor("PL-1", "releaseversion-tbody");
  check("PL-1 zeigt Typ 'Epic' in eigener Spalte", !!pl1Row && pl1Row.children[1].textContent.trim() === "Epic");
  check("PL-1 (Epic) zeigt 5 Punkte", !!pl1Row && pl1Row.children[5].textContent.trim() === "5");
  check("PL-1 zeigt automatisch erkannte Labels 'Dealer', 'Market', 'Vehicle'", !!pl1Row &&
    ["Dealer", "Market", "Vehicle"].every((l) => pl1Row.children[6].textContent.includes(l)));
  check("PL-1 zeigt Beschreibung", !!pl1Row && pl1Row.children[4].textContent.includes("Market-Bereich"));

  const pl2Row = rowFor("PL-2", "releaseversion-tbody");
  check("PL-2 (Bug) zeigt 1 Punkt", !!pl2Row && pl2Row.children[5].textContent.trim() === "1");
  check("PL-2 zeigt automatisch erkanntes Label 'Price'", !!pl2Row && pl2Row.children[6].textContent.includes("Price"));

  const pl3Row = rowFor("PL-3", "releaseversion-tbody");
  check("PL-3 zeigt Typ 'Sonderfall-XYZ'", !!pl3Row && pl3Row.children[1].textContent.trim() === "Sonderfall-XYZ");
  check("PL-3 (unbekannter Typ) zeigt ehrlich 'Unbekannt' statt geraten", !!pl3Row && pl3Row.children[5].textContent.trim() === "Unbekannt");
  check("PL-3 ohne Label-Treffer zeigt '–'", !!pl3Row && pl3Row.children[6].textContent.trim() === "–");

  // ===================== Job 5 + Job 6 haben ebenfalls die neuen Spalten =====================
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  const headers5 = Array.from(doc.querySelectorAll("#jiraliste-table thead th")).map((th) => th.textContent);
  check("Job-5-Header enthält Typ/Domäne/Beschreibung/Priorität/Labels", ["Typ", "Domäne", "Beschreibung", "Priorität (Punkte)", "Labels"].every((h) => headers5.includes(h)));
  const pl1Row5 = rowFor("PL-1", "jiraliste-tbody");
  check("Job 5: PL-1 zeigt Typ 'Epic'", !!pl1Row5 && pl1Row5.children[1].textContent.trim() === "Epic");
  check("Job 5: PL-1 zeigt 5 Punkte", !!pl1Row5 && pl1Row5.children[6].textContent.trim() === "5");

  doc.querySelector('.import-tab[data-vsub="domaenen-uebersicht"]').click();
  const headers6 = Array.from(doc.querySelectorAll("#domainoverview-table thead th")).map((th) => th.textContent);
  check("Job-6-Header enthält Typ/Beschreibung/Priorität/Labels", ["Typ", "Beschreibung", "Priorität (Punkte)", "Labels"].every((h) => headers6.includes(h)));
  const pl2Row6 = rowFor("PL-2", "domainoverview-tbody");
  check("Job 6: PL-2 zeigt Typ 'Bug'", !!pl2Row6 && pl2Row6.children[1].textContent.trim() === "Bug");
  check("Job 6: PL-2 zeigt 1 Punkt", !!pl2Row6 && pl2Row6.children[6].textContent.trim() === "1");

  // ===================== Einstellungen: Punkte bearbeiten wirkt sofort auf die Tabellen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const epicInput = pointsRows().find((r) => r.textContent.includes("Epic")).querySelector(".points-value-input");
  epicInput.value = "8";
  fire(epicInput, "change");
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const pl1RowAfter = rowFor("PL-1", "releaseversion-tbody");
  check("Nach Punkte-Änderung in Einstellungen: PL-1 zeigt sofort 8 Punkte", !!pl1RowAfter && pl1RowAfter.children[5].textContent.trim() === "8");

  // ===================== Einstellungen: neuen Tickettyp hinzufügen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  doc.getElementById("points-new-type").value = "Sonderfall-XYZ";
  doc.getElementById("points-new-value").value = "7";
  fire(doc.getElementById("points-add-btn"), "click");
  check("Neuer Tickettyp erscheint im Punkte-System (6 Zeilen)", pointsRows().length === 6);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const pl3RowAfter = rowFor("PL-3", "releaseversion-tbody");
  check("PL-3 (jetzt gepflegter Typ) zeigt 7 Punkte statt 'Unbekannt'", !!pl3RowAfter && pl3RowAfter.children[5].textContent.trim() === "7");

  // ===================== Einstellungen: Tickettyp löschen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const rowToDelete = pointsRows().find((r) => r.textContent.includes("Sonderfall-XYZ"));
  fire(rowToDelete.querySelector('button[data-action="delete-points"]'), "click");
  check("Tickettyp nach Löschen wieder entfernt (5 Zeilen)", pointsRows().length === 5);

  // ===================== Einstellungen: neues Label hinzufügen und entfernen =====================
  doc.getElementById("labels-new-input").value = "TestLabel123";
  fire(doc.getElementById("labels-add-btn"), "click");
  check("Neues Label 'TestLabel123' in der Liste", doc.getElementById("labels-list").textContent.includes("TestLabel123"));
  const chipToRemove = Array.from(doc.querySelectorAll(".label-chip")).find((c) => c.textContent.includes("TestLabel123"));
  fire(chipToRemove.querySelector("button"), "click");
  check("Label nach Entfernen wieder verschwunden", !doc.getElementById("labels-list").textContent.includes("TestLabel123"));

  // ===================== Punkte-System/Labels bleiben nach 'Sitzung zurücksetzen' erhalten (Konfiguration, kein Sitzungsdatensatz) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const epicRowAfterReset = pointsRows().find((r) => r.textContent.includes("Epic"));
  check("Punkte-System bleibt nach Sitzung-Reset erhalten (Epic weiterhin 8 Punkte)", !!epicRowAfterReset && epicRowAfterReset.querySelector(".points-value-input").value === "8");

  // ===================== Testergebnisse-Bereich =====================
  const suitesCount = parseInt(doc.getElementById("test-results-suites").textContent, 10);
  const totalCount = parseInt(doc.getElementById("test-results-total").textContent, 10);
  const passedCount = parseInt(doc.getElementById("test-results-passed").textContent, 10);
  check("Testergebnisse zeigen mind. 15 Testgruppen", suitesCount >= 15);
  check("Testergebnisse zeigen mehrere hundert Checks", totalCount > 400);
  check("Alle eingebetteten Checks sind 'bestanden' (kein Fake-Erfolg)", passedCount === totalCount);
  check("Datum ist gesetzt", doc.getElementById("test-results-date").textContent.trim().length > 0);
  check("Testergebnis-Tabelle initial eingeklappt (keine Check-Zeilen sichtbar)", doc.querySelectorAll("#test-results-tbody .test-check-row:not([hidden])").length === 0);
  const firstToggle = doc.querySelector(".test-group-toggle");
  fire(firstToggle, "click");
  check("Erste Testgruppe nach Klick aufgeklappt (Check-Zeilen sichtbar)", doc.querySelectorAll("#test-results-tbody .test-check-row:not([hidden])").length > 0);
  check("Sichtbare Check-Zeile zeigt Status 'bestanden'", doc.querySelector("#test-results-tbody .test-check-row:not([hidden]) .test-status-pass") !== null);

  // ===================== XSS-Schutz in allen neuen Bereichen =====================
  check("Keine ungeschützten Script-Tags in Punkte-Tabelle/Labels/Testergebnissen",
    !doc.getElementById("points-tbody").innerHTML.includes("<script") &&
    !doc.getElementById("labels-list").innerHTML.includes("<script") &&
    !doc.getElementById("test-results-tbody").innerHTML.match(/<script(?!\u0000)/));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PUNKTE/LABELS/TESTERGEBNISSE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
