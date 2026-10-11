// Einstellungen -> Benutzerhandbuch-Gliederung: "6 Gliederungs-Versionen
// (Markt/MO/Dealer/IT/Van/Pkw)" + Kapitel x Versionen-Matrix. Rein
// deterministisch aus dem bereits bestehenden Sparte-/Rollen-Filter
// (SPARTE_FILTER_VALUES/ROLE_FILTER_VALUES) abgeleitet - kein KI-Aufruf.
// "Dealer" nutzt den bestehenden Rollen-Tag "Retail"; "IT" ist eine neue
// Rolle. Ein Kapitel ohne jedes zugeordnete Ticket zaehlt zu ALLEN 6
// Versionen (kein Signal zum Ausschliessen).
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
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

// Domaenen passend zu den outlineSeedData()-Kapiteln (s. ticket_cockpit.html):
// Kapitel 7 <- "Contract Management", Kapitel 5 <- "Revenue Management"/
// "Cost Management", Kapitel 6 <- "Reporting", Kapitel 8 <- "Customer &
// Partner Management"/"Customer Account Center". Kapitel 1 bekommt bewusst
// KEIN Ticket (kein Domaenen-Treffer) - der "keine Tickets zugeordnet"-Fall.
const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>OV-1</key><summary>Pkw Dealer Ticket</summary><description>Pkw/Dealer Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Pkw</label><label>Retail</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>OV-2</key><summary>Van MO Ticket</summary><description>Van/MO Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Van</label><label>MO</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Revenue Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>OV-3</key><summary>Markt Ticket</summary><description>Markt Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>Markt</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Reporting</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>OV-4</key><summary>IT Ticket</summary><description>IT Beschreibung.</description><status>Offen</status><type>Task</type>
    <labels><label>IT</label></labels>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Customer &amp; Partner Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
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

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "outline_versions_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);

  check("'IT'-Checkbox im Rollen-Filter vorhanden (neue Rolle)", !!doc.querySelector('input[name^="active-scope-filter-"][value="role:IT"]'));

  const genBtn = doc.getElementById("outline-versions-generate-btn");
  check("Button '6 Versionen + Matrix erzeugen' vorhanden", !!genBtn);
  check("Matrix/Export-Bereich vor Klick versteckt", doc.getElementById("outline-versions-wrap").hidden === true);

  fire(genBtn, "click");
  await wait(50);
  check("Matrix/Export-Bereich nach Klick sichtbar", doc.getElementById("outline-versions-wrap").hidden === false);
  check("Statushinweis bestätigt Erzeugung", doc.getElementById("outline-versions-status-note").textContent.includes("6 Versionen"));

  function rowFor(chapterSubstring) {
    return Array.prototype.filter.call(doc.querySelectorAll("#outline-versions-matrix-tbody tr"), function (tr) {
      return tr.textContent.indexOf(chapterSubstring) !== -1;
    })[0];
  }
  function cellTexts(tr) {
    return Array.prototype.map.call(tr.querySelectorAll("td"), function (td) { return td.textContent.trim(); });
  }

  const row7 = rowFor("Kapitel 7");
  check("Matrix-Zeile für Kapitel 7 vorhanden", !!row7);
  if (row7) {
    const cells = cellTexts(row7); // [Kapitel, Markt, MO, Dealer, IT, Van, Pkw]
    check("Kapitel 7: Markt = –", cells[1] === "–");
    check("Kapitel 7: MO = –", cells[2] === "–");
    check("Kapitel 7: Dealer = ✓ (Retail-Tag)", cells[3] === "✓");
    check("Kapitel 7: IT = –", cells[4] === "–");
    check("Kapitel 7: Van = –", cells[5] === "–");
    check("Kapitel 7: Pkw = ✓", cells[6] === "✓");
  }

  const row5 = rowFor("Kapitel 5");
  if (row5) {
    const cells = cellTexts(row5);
    check("Kapitel 5: MO = ✓", cells[2] === "✓");
    check("Kapitel 5: Van = ✓", cells[5] === "✓");
    check("Kapitel 5: Dealer = – (kein Retail-Tag)", cells[3] === "–");
  }

  const row6 = rowFor("Kapitel 6");
  if (row6) {
    const cells = cellTexts(row6);
    check("Kapitel 6: Markt = ✓ (Sparte- und Rollen-Tag zugleich)", cells[1] === "✓");
    check("Kapitel 6: alle anderen Versionen = –", cells.slice(2).every(function (c) { return c === "–"; }));
  }

  const row8 = rowFor("Kapitel 8");
  if (row8) {
    const cells = cellTexts(row8);
    check("Kapitel 8: IT = ✓ (neue Rolle)", cells[4] === "✓");
    check("Kapitel 8: Markt/MO/Dealer/Van/Pkw = –", [cells[1], cells[2], cells[3], cells[5], cells[6]].every(function (c) { return c === "–"; }));
  }

  const row1 = rowFor("Kapitel 1:");
  check("Matrix-Zeile für Kapitel 1 (keine Tickets zugeordnet) vorhanden", !!row1);
  if (row1) {
    const cells = cellTexts(row1);
    check("Kapitel 1 (ohne Tickets): alle 6 Versionen markiert (kein Ausschlussgrund)", cells.slice(1).every(function (c) { return c.indexOf("✓") === 0; }));
  }

  // ===================== Export je Version =====================
  const exportRow = doc.getElementById("outline-versions-export-row");
  check("6 Export-Buttons (je Version) vorhanden", exportRow.querySelectorAll("[data-outline-version-export]").length === 6);

  savedFiles.length = 0;
  fire(exportRow.querySelector('[data-outline-version-export="dealer"]'), "click");
  await wait(50);
  check("Dealer-Version als 1 Markdown-Datei gespeichert", savedFiles.length === 1 && savedFiles[0].filename.indexOf("Dealer") !== -1);
  if (savedFiles.length === 1) {
    check("Dealer-Gliederung enthält Kapitel 7 (Retail-Tag)", savedFiles[0].data.indexOf("Kapitel 7") !== -1);
    check("Dealer-Gliederung enthält Kapitel 1 (keine Tickets -> alle Versionen)", savedFiles[0].data.indexOf("Kapitel 1:") !== -1);
    check("Dealer-Gliederung enthält NICHT Kapitel 5 (nur MO/Van-Tag)", savedFiles[0].data.indexOf("Kapitel 5") === -1);
  }

  savedFiles.length = 0;
  fire(exportRow.querySelector('[data-outline-version-export="it"]'), "click");
  await wait(50);
  check("IT-Version als 1 Markdown-Datei gespeichert", savedFiles.length === 1 && savedFiles[0].filename.indexOf("IT") !== -1);
  if (savedFiles.length === 1) {
    check("IT-Gliederung enthält Kapitel 8", savedFiles[0].data.indexOf("Kapitel 8") !== -1);
    check("IT-Gliederung enthält NICHT Kapitel 7 (nur Pkw/Retail-Tag)", savedFiles[0].data.indexOf("Kapitel 7") === -1);
  }

  // ===================== Matrix-Export =====================
  savedFiles.length = 0;
  fire(doc.getElementById("outline-versions-matrix-download-btn"), "click");
  await wait(50);
  check("Matrix als 1 Markdown-Datei gespeichert", savedFiles.length === 1 && savedFiles[0].filename.indexOf("Matrix") !== -1);
  if (savedFiles.length === 1) {
    check("Matrix-Markdown enthält Tabellen-Header mit allen 6 Versionen", ["Markt", "MO", "Dealer", "IT", "Van", "Pkw"].every(function (v) { return savedFiles[0].data.indexOf(v) !== -1; }));
    check("Matrix-Markdown enthält Kapitel 7 mit Dealer-Treffer", /Kapitel 7[^\n]*✓/.test(savedFiles[0].data));
  }

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  // ===================== Reset =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("Nach 'Alle Daten löschen': Matrix/Export-Bereich wieder versteckt", doc.getElementById("outline-versions-wrap").hidden === true);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE GLIEDERUNGS-VERSIONEN-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
