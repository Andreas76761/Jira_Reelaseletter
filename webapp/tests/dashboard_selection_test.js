const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const XLSX = require("xlsx");

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
    window.jspdf = { jsPDF: function () {} };
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
    <item><key>SEL-1</key><summary>Erstes Ticket</summary><description>Beschreibung 1</description><status>Offen</status><type>Epic</type></item>
    <item><key>SEL-2</key><summary>Zweites Ticket</summary><description>Beschreibung 2</description><status>Offen</status><type>Story</type></item>
    <item><key>SEL-3</key><summary>Drittes Ticket</summary><description>Beschreibung 3</description><status>Offen</status><type>Feature</type></item>
    <item><key>SEL-4</key><summary>Viertes Ticket</summary><description>Beschreibung 4</description><status>Offen</status><type>Bug</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "sel.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();

  // ===================== Typ-Schnellfilter =====================
  check("Typ-Schnellfilter-Sektion sichtbar (Typen vorhanden)", !doc.getElementById("type-section").hidden);
  const chipLabels = Array.from(doc.querySelectorAll("#type-chips .import-tab")).map((b) => b.textContent);
  check("Schnellfilter enthält 'Alle Typen'", chipLabels[0] === "Alle Typen");
  check("Schnellfilter zeigt Epic mit Anzahl", chipLabels.some((l) => l.startsWith("Epic (")));
  check("Schnellfilter zeigt Story mit Anzahl", chipLabels.some((l) => l.startsWith("Story (")));
  check("Schnellfilter zeigt Feature mit Anzahl", chipLabels.some((l) => l.startsWith("Feature (")));
  check("Reihenfolge: Epic vor Story vor Feature (Prioritätsliste)", chipLabels.indexOf("Epic (1)") < chipLabels.indexOf("Story (1)") && chipLabels.indexOf("Story (1)") < chipLabels.indexOf("Feature (1)"));

  const epicChip = Array.from(doc.querySelectorAll("#type-chips .import-tab")).find((b) => b.textContent.startsWith("Epic"));
  fire(epicChip, "click");
  await wait(50);
  check("Klick auf 'Epic'-Chip filtert auf 1 Ticket", doc.getElementById("result-count").innerHTML.includes("<b>1</b>"));
  check("Epic-Chip nach Klick aktiv", epicChip.className.includes("active"));
  fire(epicChip, "click");
  await wait(50);
  check("Erneuter Klick auf 'Epic' hebt Filter wieder auf", !epicChip.className.includes("active"));

  // ===================== Checkbox-Auswahl + Export =====================
  check("Export-Buttons initial deaktiviert (keine Auswahl)", doc.getElementById("selection-export-keys-btn").disabled && doc.getElementById("selection-export-content-btn").disabled);

  doc.getElementById("search-input").value = "SEL-";
  fire(doc.getElementById("search-input"), "input");
  await wait(250);
  check("Suche auf 'SEL-' zeigt 4 Zeilen", doc.querySelectorAll("#table-body tr").length === 4);

  const selectAllCb = doc.getElementById("select-all-checkbox");
  selectAllCb.checked = true;
  fire(selectAllCb, "change");
  await wait(50);
  check("'Alle sichtbaren auswählen'-Checkbox selektiert alle 4 sichtbaren Zeilen", doc.getElementById("selection-count").textContent.startsWith("4"));
  check("Export-Buttons nach Auswahl aktiviert", !doc.getElementById("selection-export-keys-btn").disabled && !doc.getElementById("selection-export-content-btn").disabled);

  // Checkbox-Klick darf NICHT das Ticket-Detail-Modal öffnen
  check("Modal bleibt nach Checkbox-Klick geschlossen", doc.getElementById("modal-overlay").hidden);

  // Auswahl bleibt bei Filteränderung erhalten
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  await wait(250);
  check("Auswahl bleibt nach Filteränderung erhalten (weiterhin 4)", doc.getElementById("selection-count").textContent.startsWith("4"));

  savedFiles.length = 0;
  fire(doc.getElementById("selection-export-keys-btn"), "click");
  await wait(200);
  check("Export 'Nur Jira-Nummern' ausgelöst", savedFiles.length === 1 && savedFiles[0].filename.includes("Jira-Nummern"));
  const keysText = await savedFiles[0].data.text();
  check("Nummern-Export enthält alle 4 Keys, sonst nichts", ["SEL-1", "SEL-2", "SEL-3", "SEL-4"].every((k) => keysText.includes(k)) && !keysText.includes("Beschreibung"));

  savedFiles.length = 0;
  fire(doc.getElementById("selection-export-content-btn"), "click");
  await wait(300);
  check("Export 'Gesamtinhalt' ausgelöst", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".xlsx"));
  const xlsxBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
  const wb = XLSX.read(xlsxBuf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  check("XLSX-Export hat Kopfzeile + 4 Datenzeilen", rows.length === 5);
  check("XLSX-Export enthält Beschreibung der Tickets (Gesamtinhalt, nicht nur Nummern)", rows.some((r) => r.includes("Beschreibung 1")));

  fire(doc.getElementById("selection-clear-btn"), "click");
  await wait(50);
  check("'Auswahl aufheben' leert die Auswahl", doc.getElementById("selection-count").textContent.startsWith("0"));
  check("Export-Buttons nach Aufheben wieder deaktiviert", doc.getElementById("selection-export-keys-btn").disabled);

  // ===================== Listenauswahl (neuer Nav-Punkt nach Dateiverwaltung) =====================
  const navItems = Array.from(doc.querySelectorAll(".nav-item"));
  const dateiverwaltungIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "dateiverwaltung");
  const listenauswahlIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "listenauswahl");
  check("Nav-Punkt 'Listenauswahl' vorhanden", listenauswahlIdx !== -1);
  check("'Listenauswahl' steht direkt nach 'Dateiverwaltung' in der Navigation", listenauswahlIdx === dateiverwaltungIdx + 1);

  // Auswahl erneut setzen (gezielt SEL-1/SEL-2, nicht "erste 2 in der unsortierten
  // Gesamtliste" - die Suche wurde oben bereits wieder geleert) und als Liste speichern
  ["SEL-1", "SEL-2"].forEach((key) => {
    var cb = doc.querySelector('#table-body input.row-select-checkbox[data-key="' + key + '"]');
    cb.checked = true; fire(cb, "click");
  });
  await wait(50);
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  check("Aktuelle Dashboard-Auswahl wird in Listenauswahl angezeigt", doc.getElementById("listenauswahl-current-count").textContent.includes("2"));
  check("'Liste speichern'-Button aktiviert bei vorhandener Auswahl", !doc.getElementById("listenauswahl-save-btn").disabled);

  doc.getElementById("listenauswahl-name-input").value = "Meine erste Liste";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(100);
  check("Gespeicherte Liste erscheint in der Tabelle", doc.querySelectorAll("#listenauswahl-tbody tr").length === 1);
  check("Listenzähler zeigt 1", doc.getElementById("listenauswahl-count").textContent === "1");
  check("Nav-Badge zeigt 1 gespeicherte Liste", !doc.getElementById("nav-badge-lists").hidden && doc.getElementById("nav-badge-lists").textContent === "1");
  check("Namensfeld nach Speichern geleert", doc.getElementById("listenauswahl-name-input").value === "");
  const listRow = doc.querySelector("#listenauswahl-tbody tr");
  check("Zeile zeigt Listennamen", listRow.textContent.includes("Meine erste Liste"));
  check("Zeile zeigt Ticketanzahl (2)", listRow.textContent.includes("2"));

  // Auswahl im Dashboard ändern - gespeicherte Liste bleibt unverändert (eigener Snapshot)
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  fire(doc.getElementById("selection-clear-btn"), "click");
  await wait(50);
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  check("Gespeicherte Liste bleibt bei geänderter Dashboard-Auswahl unverändert (Snapshot)", doc.querySelector("#listenauswahl-tbody tr").textContent.includes("2"));

  // Export der gespeicherten Liste (Nummern + Inhalt)
  savedFiles.length = 0;
  fire(listRow.querySelector('button[data-action="export-keys"]'), "click");
  await wait(200);
  check("Liste: Nummern-Export ausgelöst", savedFiles.length === 1 && savedFiles[0].filename.includes("Jira-Nummern"));
  const listKeysText = await savedFiles[0].data.text();
  check("Liste: Nummern-Export enthält SEL-1 und SEL-2", listKeysText.includes("SEL-1") && listKeysText.includes("SEL-2"));

  savedFiles.length = 0;
  fire(listRow.querySelector('button[data-action="export-content"]'), "click");
  await wait(300);
  check("Liste: Inhalt-Export (.xlsx) ausgelöst", savedFiles.length === 1 && savedFiles[0].filename.endsWith(".xlsx"));
  const listXlsxBuf = Buffer.from(await savedFiles[0].data.arrayBuffer());
  const listWb = XLSX.read(listXlsxBuf, { type: "buffer" });
  const listRows = XLSX.utils.sheet_to_json(listWb.Sheets[listWb.SheetNames[0]], { header: 1 });
  check("Liste: XLSX enthält Kopfzeile + 2 Datenzeilen", listRows.length === 3);

  // Löschen mit Bestätigungsdialog
  fire(listRow.querySelector('button[data-action="delete-list"]'), "click");
  await wait(100);
  check("Löschen-Bestätigungsdialog öffnet sich", !doc.getElementById("confirm-modal-overlay").hidden);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(400);
  check("Liste nach Bestätigung gelöscht", doc.querySelectorAll("#listenauswahl-tbody tr").length === 0);
  check("Leer-Hinweis wieder sichtbar", !doc.getElementById("listenauswahl-empty").hidden);
  check("Nav-Badge wieder versteckt", doc.getElementById("nav-badge-lists").hidden);

  // ===================== Sitzung zurücksetzen leert Auswahl + gespeicherte Listen =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.querySelector("#table-body input.row-select-checkbox").checked = true;
  fire(doc.querySelector("#table-body input.row-select-checkbox"), "click");
  await wait(50);
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  doc.getElementById("listenauswahl-name-input").value = "Vor Reset";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(100);
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(300);
  check("'Sitzung zurücksetzen' leert die Dashboard-Auswahl", doc.getElementById("selection-count").textContent.startsWith("0"));
  check("'Sitzung zurücksetzen' leert die gespeicherten Listen", doc.querySelectorAll("#listenauswahl-tbody tr").length === 0);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DASHBOARD-AUSWAHL/LISTENAUSWAHL-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
