// Import-Überarbeitung: Typ-Icon + "Einleseformat" je Ticket, Datenprofil
// (0-100%-Balken im Dashboard, nach Status) und neue Einstellungen-Sektion
// "Importformat" (Spalten je Vorgangstyp: aktivierbar/deaktivierbar,
// umbenennbar, einzeln oder per Mehrfach-Einfügen ergänzbar). Deaktivierte
// Spalten werden beim Einlesen NICHT übernommen - rein einschränkend, NACH
// der bestehenden PII-Bereinigung (kann also nur Daten entfernen, nie die
// Bereinigung umgehen).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function setValue(el, v) { el.value = v; fire(el, "input"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Demo-Daten leeren (Kontamination der Zählungen durch die 663
  // Beispiel-Tickets vermeiden - etabliertes Muster in dieser Testsuite).
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== Einstellungen: Importformat-Sektion =====================
  const list = doc.getElementById("importformat-list");
  check("Importformat-Sektion vorhanden", !!list);
  check("Zeigt 'Change Request' mit vorbefüllten Spalten (> 100)", (function () {
    const panels = Array.from(list.querySelectorAll(".panel"));
    const cr = panels.find((p) => p.textContent.includes("Change Request"));
    return !!cr && cr.querySelectorAll(".importformat-name-input").length > 100;
  })());
  check("Zeigt Epic/Feature/Bug/Incident (noch ohne Spalten)", ["Epic", "Feature", "Bug", "Incident"].every((label) => list.textContent.includes(label)));
  check("Icon 🔄 für Change Request sichtbar", list.textContent.includes("🔄"));
  check("Icon 🐞 für Bug sichtbar", list.textContent.includes("🐞"));

  // ===================== Change-Request-Ticket importieren: Icon + Datenprofil =====================
  const xmlCr = `<?xml version="1.0"?><rss><channel>
    <item><key>IF-1</key><summary>Preisanpassung beantragen</summary>
      <description>Änderungsantrag für die Preismatrix.</description>
      <status>Offen</status><type>Change Request</type>
      <assignee>Anna Beispiel</assignee><reporter>Bernd Melder</reporter>
      <customfields>
        <customfield key="storypoints"><customfieldname>Story Points</customfieldname>
          <customfieldvalues><customfieldvalue>5</customfieldvalue></customfieldvalues></customfield>
        <customfield key="wsjf"><customfieldname>WSJF</customfieldname>
          <customfieldvalues><customfieldvalue>12</customfieldvalue></customfieldvalues></customfield>
        <customfield key="market"><customfieldname>Market</customfieldname>
          <customfieldvalues><customfieldvalue>Deutschland</customfieldvalue></customfieldvalues></customfield>
        <customfield key="env"><customfieldname>Umgebung</customfieldname>
          <customfieldvalues><customfieldvalue>Kontakt bei Rückfragen: kontakt@example.com</customfieldvalue></customfieldvalues></customfield>
      </customfields>
    </item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlCr], "if_cr_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const row1 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("IF-1"));
  check("Dashboard-Zeile für IF-1 vorhanden", !!row1);
  check("Typ-Spalte zeigt Icon 🔄 + 'Change Request'", row1.textContent.includes("🔄") && row1.textContent.includes("Change Request"));
  const profileCell1 = row1.querySelector("td.dataprofile");
  check("Datenprofil-Zelle vorhanden und zeigt eine Prozentzahl (kein '–')", !!profileCell1 && /\d+%/.test(profileCell1.textContent) && !profileCell1.textContent.includes("–"));

  fire(row1, "click");
  await wait(50);
  const fieldsText1 = doc.getElementById("modal-fields").textContent;
  check("Bearbeiter im Modal pseudonymisiert ('Person N', kein Klartextname)", /Person \d/.test(fieldsText1) && !fieldsText1.includes("Anna Beispiel"));
  check("PII in Zusatzfeld 'Umgebung' weiterhin entfernt (E-Mail), unabhängig vom Importformat", fieldsText1.includes("[E-Mail entfernt]") && !fieldsText1.includes("kontakt@example.com"));
  check("Zusatzfeld 'WSJF' ist im Modal sichtbar (aktive Spalte)", fieldsText1.includes("WSJF") && fieldsText1.includes("12"));
  fire(doc.getElementById("modal-close"), "click");
  await wait(30);

  // ===================== Spalte deaktivieren VOR dem nächsten Import: wird nicht übernommen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  function crColumnCheckbox(colName) {
    const panels = Array.from(doc.getElementById("importformat-list").querySelectorAll(".panel"));
    const cr = panels.find((p) => p.textContent.includes("Change Request"));
    const nameInput = Array.from(cr.querySelectorAll(".importformat-name-input")).find((i) => i.value === colName);
    const idx = nameInput.getAttribute("data-idx");
    return cr.querySelector('.importformat-active-cb[data-idx="' + idx + '"]');
  }
  const wsjfCb = crColumnCheckbox("WSJF");
  wsjfCb.checked = false;
  fire(wsjfCb, "change");
  await wait(50);

  const xmlCr2 = `<?xml version="1.0"?><rss><channel>
    <item><key>IF-2</key><summary>Zweiter Change Request</summary>
      <description>Noch ein Antrag.</description>
      <status>Offen</status><type>Change Request</type>
      <customfields>
        <customfield key="wsjf"><customfieldname>WSJF</customfieldname>
          <customfieldvalues><customfieldvalue>7</customfieldvalue></customfieldvalues></customfield>
        <customfield key="market"><customfieldname>Market</customfieldname>
          <customfieldvalues><customfieldvalue>Österreich</customfieldvalue></customfieldvalues></customfield>
      </customfields>
    </item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input2 = doc.getElementById("file-input");
  Object.defineProperty(input2, "files", { value: [new win.File([xmlCr2], "if_cr_test2.xml", { type: "application/xml" })], configurable: true });
  fire(input2, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const row2 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("IF-2"));
  fire(row2, "click");
  await wait(50);
  const fieldsText2 = doc.getElementById("modal-fields").textContent;
  check("Deaktivierte Spalte 'WSJF' wird bei NEUEM Import nicht übernommen (Zusatzfeld fehlt komplett statt 'Nicht im Export enthalten', da gar nicht erst in custom_fields)", !fieldsText2.includes("WSJF"));
  check("Andere aktive Spalte 'Market' weiterhin übernommen", fieldsText2.includes("Österreich"));
  fire(doc.getElementById("modal-close"), "click");
  await wait(30);

  check("Datenprofil von IF-1 (VOR dem Deaktivieren importiert) sinkt sofort, da WSJF jetzt inaktiv ist (nur Zählbasis betroffen, Rohdaten bleiben)", (function () {
    const rowAgain = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("IF-1"));
    return !!rowAgain && rowAgain.querySelector("td.dataprofile") !== null;
  })());

  // ===================== Nicht zugeordneter Vorgangstyp: Fallback-Icon, kein Datenprofil =====================
  const xmlOther = `<?xml version="1.0"?><rss><channel>
    <item><key>IF-3</key><summary>Reporting-Ticket</summary>
      <description>Kein Importformat definiert.</description>
      <status>Offen</status><type>Reporting</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input3 = doc.getElementById("file-input");
  Object.defineProperty(input3, "files", { value: [new win.File([xmlOther], "if_other_test.xml", { type: "application/xml" })], configurable: true });
  fire(input3, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  const row3 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("IF-3"));
  check("Unbekannter Typ zeigt Fallback-Icon ▪", row3.textContent.includes("▪"));
  check("Unbekannter Typ zeigt kein Datenprofil (–)", row3.querySelector("td.dataprofile").textContent.includes("–"));

  // ===================== CRUD: Spalte hinzufügen (Bug), umbenennen, löschen =====================
  // Direkt ueber data-fmt="bug"/"epic"/"incident" statt ueber Text-Inhalt
  // gesuchter Panels - robuster (z.B. enthaelt der Change-Request-Panel
  // selbst Spaltennamen wie "Bug Description"/"Epic Colour"/"Incident
  // Description", ein Text-basierter Panel-Find waere daher zweideutig).
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  function newColInput(fmtKey) { return doc.querySelector('.importformat-new-col-input[data-fmt="' + fmtKey + '"]'); }
  function addColBtn(fmtKey) { return doc.querySelector('[data-action="add-importformat-col"][data-fmt="' + fmtKey + '"]'); }
  function bulkTextarea(fmtKey) { return doc.querySelector('.importformat-bulk-textarea[data-fmt="' + fmtKey + '"]'); }
  function bulkBtn(fmtKey) { return doc.querySelector('[data-action="add-importformat-bulk"][data-fmt="' + fmtKey + '"]'); }
  function colNameInputs(fmtKey) { return Array.from(doc.querySelectorAll('.importformat-name-input[data-fmt="' + fmtKey + '"]')); }

  setValue(newColInput("bug"), "Schweregrad");
  fire(addColBtn("bug"), "click");
  await wait(30);
  check("Neue Spalte 'Schweregrad' bei Bug hinzugefügt", colNameInputs("bug").some((i) => i.value === "Schweregrad"));

  const severityInput = colNameInputs("bug").find((i) => i.value === "Schweregrad");
  setValue(severityInput, "Schweregrad (1-5)");
  fire(severityInput, "change");
  await wait(30);
  check("Spalte umbenannt", colNameInputs("bug").some((i) => i.value === "Schweregrad (1-5)") && !colNameInputs("bug").some((i) => i.value === "Schweregrad"));

  const beforeDelCount = colNameInputs("bug").length;
  fire(doc.querySelector('[data-action="delete-importformat-col"][data-fmt="bug"]'), "click");
  await wait(30);
  check("Spalte löschbar", colNameInputs("bug").length === beforeDelCount - 1);

  // ===================== Mehrfach-Einfügen (Epic) =====================
  setValue(bulkTextarea("epic"), "Epic-Ziel\tEpic-Owner, Epic-Budget\nEpic-Risiko");
  fire(bulkBtn("epic"), "click");
  await wait(30);
  check("Mehrfach-Einfügen: 4 neue Spalten bei Epic übernommen", colNameInputs("epic").length === 4);
  check("Alle 4 Begriffe vorhanden", ["Epic-Ziel", "Epic-Owner", "Epic-Budget", "Epic-Risiko"].every((n) => colNameInputs("epic").some((i) => i.value === n)));

  setValue(bulkTextarea("epic"), "Epic-Ziel, Epic-Owner");
  fire(bulkBtn("epic"), "click");
  await wait(30);
  check("Erneutes Einfügen bereits vorhandener Namen dedupliziert (weiterhin nur 4 Spalten)", colNameInputs("epic").length === 4);

  // ===================== XSS-Schutz bei Spaltennamen =====================
  setValue(newColInput("incident"), '<img src=x onerror="window.__xss_if=true">');
  fire(addColBtn("incident"), "click");
  await wait(30);
  check("Kein echtes <img>-Element im DOM nach XSS-Versuch", !doc.getElementById("importformat-list").querySelector("img"));
  check("Kein window.__xss_if gesetzt (kein Script ausgeführt)", win.__xss_if === undefined);

  // ===================== Konfiguration bleibt bei 'Alle Daten löschen' erhalten =====================
  const crColumnCountBefore = (function () {
    const panels = Array.from(doc.getElementById("importformat-list").querySelectorAll(".panel"));
    const cr = panels.find((p) => p.textContent.includes("Change Request"));
    return cr.querySelectorAll(".importformat-name-input").length;
  })();
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  const crColumnCountAfter = (function () {
    const panels = Array.from(doc.getElementById("importformat-list").querySelectorAll(".panel"));
    const cr = panels.find((p) => p.textContent.includes("Change Request"));
    return cr.querySelectorAll(".importformat-name-input").length;
  })();
  check("Importformat-Konfiguration übersteht 'Alle Daten löschen' (Konfiguration, kein Sitzungsdatensatz)", crColumnCountBefore === crColumnCountAfter && crColumnCountAfter > 100);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE IMPORTFORMAT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
