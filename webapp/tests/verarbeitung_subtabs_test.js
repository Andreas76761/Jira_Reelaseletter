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

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();

  // ===================== Struktur: 7 Unter-Tabs =====================
  const subtabs = doc.querySelectorAll("#verarbeitung-tabs .import-tab");
  check("7 Unter-Tabs in Verarbeitung vorhanden", subtabs.length === 7);
  check("Tab 1 'Jira Verarbeitung' initial aktiv", doc.querySelector('.import-tab[data-vsub="protokoll"]').classList.contains("active"));
  check("Panel 'protokoll' initial sichtbar", !doc.querySelector('[data-vsub-panel="protokoll"]').hidden);
  check("Panel 'vergleich' initial versteckt", doc.querySelector('[data-vsub-panel="vergleich"]').hidden);

  // ===================== 1) Jira Verarbeitung (Protokoll) =====================
  check("Protokoll zeigt mind. einen Log-Eintrag (Initial-Import)", doc.querySelectorAll("#log-list li").length >= 1);

  // ===================== 2) Vergleich Jira Tickets =====================
  doc.querySelector('.import-tab[data-vsub="vergleich"]').click();
  check("Tab 'vergleich' aktiv nach Klick", doc.querySelector('.import-tab[data-vsub="vergleich"]').classList.contains("active"));
  check("Panel 'vergleich' sichtbar", !doc.querySelector('[data-vsub-panel="vergleich"]').hidden);
  check("Panel 'protokoll' jetzt versteckt", doc.querySelector('[data-vsub-panel="protokoll"]').hidden);
  check("Vergleichstabelle in Verarbeitung anfangs leer (Hinweistext sichtbar)", !doc.getElementById("changes-empty-verarbeitung").hidden);

  // Teil-Import auslösen (ONESCM-8282), dann prüfen ob Vergleich hier UND in Dateiverwaltung gleich ist
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xmlText = fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8");
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlText], "nachtrag_demo.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="vergleich"]').click();
  const changesVerarbeitungRows = doc.querySelectorAll("#changes-tbody-verarbeitung tr").length;
  const changesDateiverwaltungRows = doc.querySelectorAll("#changes-tbody tr").length;
  check("Vergleich in Verarbeitung zeigt Zeilen nach Aenderung", changesVerarbeitungRows > 0);
  check("Vergleich in Verarbeitung identisch zu Dateiverwaltung (gleiche Zeilenanzahl)", changesVerarbeitungRows === changesDateiverwaltungRows);
  check("Vergleich in Verarbeitung zeigt ONESCM-8282", doc.getElementById("changes-tbody-verarbeitung").textContent.includes("ONESCM-8282"));
  check("KEIN spurious Domain-Eintrag im Verarbeitung-Vergleich (Teil-Import-Fix greift auch hier)", !doc.getElementById("changes-tbody-verarbeitung").textContent.includes("Domain"));

  // ===================== 3) Glossar & Abkürzungen extrahieren =====================
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  check("Abkürzungen vor Extraktion: Hinweistext sichtbar", !doc.getElementById("abbrev-empty").hidden);
  check("Register Abkürzungen vor Extraktion: Hinweistext sichtbar", !doc.getElementById("abbrev-empty-register").hidden);

  // Basisdatensatz hat laut App-Hinweis nur Schluessel/Status/Datum/Domain (keine
  // Zusammenfassung) - fuer eine aussagekraeftige Abkuerzungs-Extraktion zusaetzlich
  // den Releaseinfo-Text importieren, der echten Freitext mit Abkuerzungen enthaelt.
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const releaseinfoFullText = fs.readFileSync(path.join(FIXTURES, "releaseinfo_full.txt"), "utf-8");
  Object.defineProperty(input, "files", { value: [new win.File([releaseinfoFullText], "release_notes.txt", { type: "text/plain" })], configurable: true });
  fire(input, "change");
  await wait(500);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();

  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);

  const abbrevCount = parseInt(doc.getElementById("abbrev-count").textContent, 10);
  check("Nach Extraktion: mind. eine Abkürzung gefunden", abbrevCount > 0);
  check("Abkürzungs-Tabelle hat Zeilen (Verarbeitung-Tab)", doc.querySelectorAll("#abbrev-tbody tr").length === abbrevCount);
  check("Abkürzungs-Tabelle hat Zeilen (Register Abkürzungen)", doc.querySelectorAll("#abbrev-tbody-register tr").length === abbrevCount);
  const glossCandCount = parseInt(doc.getElementById("glossary-candidate-count").textContent, 10);
  check("Nach Extraktion: mind. ein Glossar-Kandidat gefunden", glossCandCount > 0);
  check("Glossar-Kandidaten auch im Glossar-Register sichtbar", doc.querySelectorAll("#glossary-candidate-tbody-register tr").length === glossCandCount);
  check("Kein Domain-Kandidat fehlt (z. B. Documents & Communications)", doc.getElementById("glossary-candidate-tbody").textContent.includes("Documents & Communications"));

  // Eigenständiges Register "Abkürzungen" ueber die Sidebar erreichbar
  doc.querySelector('.nav-item[data-view="abkuerzungen"]').click();
  check("Register-Ansicht 'Abkürzungen' zeigt Ergebnisse nach Extraktion", doc.querySelectorAll("#abbrev-tbody-register tr").length === abbrevCount);

  // ===================== 4) Releaseversion =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const totalTickets = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  const releaseTotal = parseInt(doc.getElementById("releaseversion-total").textContent, 10);
  check("Releaseversion-Tabelle listet alle geladenen Tickets", releaseTotal === totalTickets);
  check("Releaseversion-Tabelle zeigt Domain-Spalte befuellt", doc.getElementById("releaseversion-tbody").textContent.includes("Documents & Communications"));

  // Abgleich: 2 existierende Keys + 1 fehlender Key
  const anyRow = doc.querySelector("#releaseversion-tbody tr");
  const existingKey1 = anyRow.querySelector("td").textContent;
  const rows = doc.querySelectorAll("#releaseversion-tbody tr");
  const existingKey2 = rows[1].querySelector("td").textContent;
  const releaseInput = doc.getElementById("release-keys-input");
  releaseInput.value = existingKey1 + "\n" + existingKey2 + "\nONESCM-999999";
  fire(doc.getElementById("release-match-btn"), "click");
  await wait(50);

  check("Abgleich-Zusammenfassung sichtbar", !doc.getElementById("release-match-summary").hidden);
  const summaryText = doc.getElementById("release-match-summary").textContent;
  check("Abgleich zeigt '2' vorhandene Tickets", summaryText.includes("2") && summaryText.includes("3"));
  check("Fehlende-Tickets-Tabelle sichtbar", !doc.getElementById("release-missing-wrap").hidden);
  check("Fehlendes Ticket ONESCM-999999 wird gelistet", doc.getElementById("release-missing-tbody").textContent.includes("ONESCM-999999"));
  check("Existierende Tickets NICHT in Fehlend-Liste", !doc.getElementById("release-missing-tbody").textContent.includes(existingKey1));

  // Abgleich ohne fehlende Tickets
  releaseInput.value = existingKey1 + "\n" + existingKey2;
  fire(doc.getElementById("release-match-btn"), "click");
  await wait(50);
  check("Kein fehlendes Ticket: Fehlend-Tabelle wieder versteckt", doc.getElementById("release-missing-wrap").hidden);

  // ===================== 5) Jira Liste =====================
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  check("Tab 5 'Jira Liste' aktiv", doc.querySelector('.import-tab[data-vsub="jira-liste"]').classList.contains("active"));
  const jiralisteCount = parseInt(doc.getElementById("jiraliste-count").textContent, 10);
  check("Jira-Liste-Anzahl entspricht Gesamtzahl importierter Tickets", jiralisteCount === totalTickets);
  check("Jira-Liste-Tabelle hat genau so viele Zeilen", doc.querySelectorAll("#jiraliste-tbody tr").length === jiralisteCount);
  check("Jira-Liste zeigt Status-Spalte befuellt", doc.getElementById("jiraliste-tbody").textContent.includes("Geschlossen"));

  // ===================== 6) Domänen-Übersicht =====================
  doc.querySelector('.import-tab[data-vsub="domaenen-uebersicht"]').click();
  check("Tab 6 'Domänen-Übersicht' aktiv", doc.querySelector('.import-tab[data-vsub="domaenen-uebersicht"]').classList.contains("active"));
  const domainOverviewTicketCount = parseInt(doc.getElementById("domainoverview-ticket-count").textContent, 10);
  check("Domänen-Übersicht-Anzahl entspricht Gesamtzahl importierter Tickets", domainOverviewTicketCount === totalTickets);
  check("Domänen-Übersicht zeigt Domain-Gruppen-Zeilen", doc.querySelectorAll("#domainoverview-tbody .domain-group-row").length > 0);
  check("Domänen-Übersicht zeigt Ticket-Zeilen", doc.querySelectorAll("#domainoverview-tbody tr").length > doc.querySelectorAll("#domainoverview-tbody .domain-group-row").length);

  // ===================== Reset setzt Extraktion zurueck =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  check("Nach Reset: Abkürzungen wieder auf Hinweistext (leer)", !doc.getElementById("abbrev-empty").hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VERARBEITUNG-UNTERTABS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
