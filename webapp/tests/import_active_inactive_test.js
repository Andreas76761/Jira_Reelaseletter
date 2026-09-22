const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
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

  function findTicket(key) {
    doc.querySelector('.nav-item[data-view="dashboard"]').click();
    doc.getElementById("search-input").value = key;
    fire(doc.getElementById("search-input"), "input");
    return wait(200).then(() => {
      const row = doc.querySelector("#table-body tr");
      const found = !!row && row.textContent.includes(key);
      doc.getElementById("search-input").value = "";
      fire(doc.getElementById("search-input"), "input");
      return wait(200).then(() => found ? row.textContent : null);
    });
  }

  const startTotal = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Ausgangs-Tickets geladen (Demo-Daten)", startTotal > 0);

  // ===================== 2 separate Importe mit unterschiedlichen Domains =====================
  const xmlA = `<?xml version="1.0"?><rss><channel>
    <item><key>ACT-1</key><summary>Aktiv-Ticket 1</summary><description>Beschreibung A1</description><status>Offen</status><type>Task</type></item>
    <item><key>ACT-2</key><summary>Aktiv-Ticket 2</summary><description>Beschreibung A2</description><status>Offen</status><type>Task</type></item>
  </channel></rss>`;
  const xmlB = `<?xml version="1.0"?><rss><channel>
    <item><key>INACT-1</key><summary>Deaktivierbares Ticket 1</summary><description>Beschreibung B1</description><status>Offen</status><type>Task</type></item>
    <item><key>INACT-2</key><summary>Deaktivierbares Ticket 2</summary><description>Beschreibung B2</description><status>Offen</status><type>Task</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlA], "fileA.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  Object.defineProperty(input, "files", { value: [new win.File([xmlB], "fileB.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);

  const afterImportTotal = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Beide Importe (4 Tickets) im Gesamtbestand sichtbar", afterImportTotal === startTotal + 4);
  check("ACT-1 im Dashboard auffindbar", !!(await findTicket("ACT-1")));
  check("INACT-1 im Dashboard auffindbar", !!(await findTicket("INACT-1")));

  // ===================== Dateiverwaltung: Aktiv-Checkboxen defaultmaessig gesetzt =====================
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const checkboxes = Array.from(doc.querySelectorAll(".import-active-checkbox"));
  check("Aktiv-Checkbox je Import vorhanden (mind. 2 neue)", checkboxes.length >= 2);
  check("Alle Checkboxen defaultmaessig aktiv (checked)", checkboxes.every((cb) => cb.checked));
  check("Pending-Hinweis initial versteckt (keine Aenderung)", doc.getElementById("imports-refresh-pending-hint").hidden === true);

  // Zeile fuer fileB (INACT-1/INACT-2) anhand des Quelle-Textes in der Tabellenzeile finden
  const rows = Array.from(doc.querySelectorAll("#imports-tbody tr"));
  const rowB = rows.find((r) => r.textContent.includes("fileB.xml"));
  check("Import-Zeile fuer fileB.xml gefunden", !!rowB);
  const cbB = rowB.querySelector(".import-active-checkbox");

  // ===================== Checkbox deaktivieren - VOR 'Aktualisieren' keine Wirkung =====================
  cbB.checked = false;
  fire(cbB, "change");
  await wait(50);
  check("Pending-Hinweis nach Checkbox-Aenderung sichtbar", doc.getElementById("imports-refresh-pending-hint").hidden === false);
  const totalBeforeRefresh = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Vor 'Aktualisieren': Ticket-Gesamtzahl UNVERAENDERT (Aenderung nur gestaged)", totalBeforeRefresh === afterImportTotal);
  check("Vor 'Aktualisieren': INACT-1 weiterhin im Dashboard auffindbar", !!(await findTicket("INACT-1")));

  // ===================== 'Aktualisieren' klicken - Wirkung tritt ein =====================
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  fire(doc.getElementById("imports-refresh-btn"), "click");
  await wait(100);
  check("Nach 'Aktualisieren': Pending-Hinweis wieder versteckt", doc.getElementById("imports-refresh-pending-hint").hidden === true);
  const totalAfterRefresh = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Nach 'Aktualisieren': Ticket-Gesamtzahl um 2 gesunken (fileB inaktiv)", totalAfterRefresh === afterImportTotal - 2);
  check("Nach 'Aktualisieren': INACT-1 NICHT mehr im Dashboard auffindbar", !(await findTicket("INACT-1")));
  check("Nach 'Aktualisieren': INACT-2 NICHT mehr im Dashboard auffindbar", !(await findTicket("INACT-2")));
  check("ACT-1 (weiterhin aktiver Import) bleibt auffindbar", !!(await findTicket("ACT-1")));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const rowBAfter = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("fileB.xml"));
  check("Inaktive Import-Zeile optisch als inaktiv markiert (CSS-Klasse)", !!rowBAfter && rowBAfter.className.includes("inactive-import-row"));

  // ===================== Verarbeitung (Job 5 Jira Liste, ueber scopedTickets()) respektiert Aktiv/Inaktiv =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  await wait(100);
  const jiraListeText = doc.getElementById("jiraliste-tbody").textContent;
  check("Verarbeitung/Jira-Liste zeigt INACT-1 NICHT mehr", !jiraListeText.includes("INACT-1"));
  check("Verarbeitung/Jira-Liste zeigt ACT-1 weiterhin", jiraListeText.includes("ACT-1"));

  // ===================== Reaktivieren: verlustfrei, Original-Daten intakt =====================
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const rowBReact = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("fileB.xml"));
  const cbBReact = rowBReact.querySelector(".import-active-checkbox");
  cbBReact.checked = true;
  fire(cbBReact, "change");
  fire(doc.getElementById("imports-refresh-btn"), "click");
  await wait(100);
  const totalAfterReactivate = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Nach Reaktivierung: Ticket-Gesamtzahl wieder wie nach Import (verlustfrei)", totalAfterReactivate === afterImportTotal);
  const reactivatedText = await findTicket("INACT-1");
  check("INACT-1 nach Reaktivierung wieder auffindbar", !!reactivatedText);
  check("INACT-1 zeigt weiterhin die urspruengliche Zusammenfassung (keine Datenveraenderung)", !!reactivatedText && reactivatedText.includes("Deaktivierbares Ticket 1"));

  // ===================== Ticket mit gemischten Quellen (1 aktiv + 1 inaktiv) bleibt sichtbar =====================
  const xmlMixed1 = `<?xml version="1.0"?><rss><channel><item><key>MIX-1</key><summary>Mix Ticket erste Quelle</summary><description>D1</description><status>Offen</status><type>Task</type></item></channel></rss>`;
  const xmlMixed2 = `<?xml version="1.0"?><rss><channel><item><key>MIX-1</key><summary>Mix Ticket zweite Quelle</summary><description>D2</description><status>Fertig</status><type>Task</type></item></channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlMixed1], "mixed1.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  Object.defineProperty(input, "files", { value: [new win.File([xmlMixed2], "mixed2.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const rowMixed1 = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("mixed1.xml"));
  const cbMixed1 = rowMixed1.querySelector(".import-active-checkbox");
  cbMixed1.checked = false;
  fire(cbMixed1, "change");
  fire(doc.getElementById("imports-refresh-btn"), "click");
  await wait(100);
  const mixedText = await findTicket("MIX-1");
  check("MIX-1 bleibt sichtbar (mixed2.xml als zweite Quelle weiterhin aktiv)", !!mixedText);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE AKTIV/INAKTIV-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
