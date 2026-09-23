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

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>COL-1</key><summary>Erstes</summary><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Farbdomäne A</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>COL-2</key><summary>Zweites</summary><status>Fertig</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Farbdomäne B</customfieldvalue></customfieldvalues></customfield></customfields></item>
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
  Object.defineProperty(input, "files", { value: [new win.File([xml], "colortest.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);

  // ===================== Domänen-Farben-Tabelle =====================
  const domainTbody = doc.getElementById("domaincolors-tbody");
  check("Domänen-Farben-Tabelle listet 'Farbdomäne A'", domainTbody.textContent.includes("Farbdomäne A"));
  check("Domänen-Farben-Tabelle listet 'Farbdomäne B'", domainTbody.textContent.includes("Farbdomäne B"));
  const domainInputs = Array.from(domainTbody.querySelectorAll(".domaincolor-input"));
  check("Beide Test-Domänen haben je genau ein Farbfeld (unter ggf. weiteren Demo-Domänen)",
    domainInputs.filter((i) => i.getAttribute("data-domain") === "Farbdomäne A").length === 1 &&
    domainInputs.filter((i) => i.getAttribute("data-domain") === "Farbdomäne B").length === 1);
  check("Neue Domänen zunächst als 'automatisch' markiert", domainTbody.textContent.includes("automatisch"));

  const domainAInput = domainInputs.filter((i) => i.getAttribute("data-domain") === "Farbdomäne A")[0];
  check("Farbfeld für 'Farbdomäne A' gefunden", !!domainAInput);
  if (domainAInput) {
    domainAInput.value = "#ff00aa";
    fire(domainAInput, "change");
    await wait(100);
    check("Nach Änderung: 'Farbdomäne A' als 'angepasst' markiert", doc.getElementById("domaincolors-tbody").textContent.includes("angepasst"));
    const updatedInput = doc.querySelector('.domaincolor-input[data-domain="Farbdomäne A"]');
    check("Farbwert wurde übernommen (#ff00aa)", updatedInput.value.toLowerCase() === "#ff00aa");

    // ===================== Propagation: Dashboard-Balkendiagramm =====================
    doc.querySelector('.nav-item[data-view="dashboard"]').click();
    await wait(100);
    const domainRowFill = doc.querySelector(".domain-row .fill");
    check("Dashboard-Domänenbalken übernimmt die angepasste Farbe", doc.getElementById("domain-chart").innerHTML.toLowerCase().includes("#ff00aa"));

    // ===================== Propagation: Domain-Spalte in Ticket-Tabelle =====================
    check("Domain-Spalte in Ticket-Tabelle zeigt farbigen Punkt (domain-dot)", !!doc.querySelector("#table-body .domain-dot"));

    // ===================== Reset =====================
    doc.querySelector('.nav-item[data-view="einstellungen"]').click();
    await wait(100);
    const resetBtn = doc.querySelector('button[data-action="reset-domaincolor"][data-domain="Farbdomäne A"]');
    check("'Zurücksetzen'-Button für angepasste Domäne vorhanden", !!resetBtn);
    if (resetBtn) {
      fire(resetBtn, "click");
      await wait(100);
      const afterReset = doc.querySelector('.domaincolor-input[data-domain="Farbdomäne A"]');
      check("Nach Zurücksetzen: Farbe nicht mehr #ff00aa (zurück auf automatisch)", afterReset.value.toLowerCase() !== "#ff00aa");
      check("Nach Zurücksetzen: wieder als 'automatisch' markiert", doc.getElementById("domaincolors-tbody").textContent.includes("automatisch"));
    }
  }

  // ===================== Status-Ampel-Tabelle =====================
  const statusTbody = doc.getElementById("statuscolors-tbody");
  check("Status-Ampel-Tabelle listet 'Offen'", statusTbody.textContent.includes("Offen"));
  check("Status-Ampel-Tabelle listet 'Fertig'", statusTbody.textContent.includes("Fertig"));
  const fertigRedBtn = doc.querySelector('.ampel-btn[data-status="Fertig"][data-cat="red"]');
  check("Ampel-Buttons (rot/gelb/grün) für Status 'Fertig' vorhanden", !!fertigRedBtn);
  const fertigGreenBtn = doc.querySelector('.ampel-btn[data-status="Fertig"][data-cat="green"]');
  check("Status 'Fertig' ist standardmäßig auf Grün aktiv (automatisch aus Status-Bucket)", fertigGreenBtn.classList.contains("active"));

  if (fertigRedBtn) {
    fire(fertigRedBtn, "click");
    await wait(100);
    const fertigRedBtnAfter = doc.querySelector('.ampel-btn[data-status="Fertig"][data-cat="red"]');
    check("Nach Klick auf Rot: Status 'Fertig' zeigt Rot als aktiv", fertigRedBtnAfter.classList.contains("active"));
    check("Status 'Fertig' jetzt als 'angepasst' markiert", doc.getElementById("statuscolors-tbody").textContent.includes("angepasst"));

    // ===================== Propagation: Ticket Graph =====================
    doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
    await wait(150);
    const graphOnlyLinked = doc.getElementById("graph-only-linked-checkbox");
    graphOnlyLinked.checked = false;
    fire(graphOnlyLinked, "change");
    await wait(100);
    const graphSvg = doc.getElementById("graph-svg-container").innerHTML;
    check("Ticket Graph zeigt Status-Ampel-Farbe Rot (#E03131) für COL-2 (Status 'Fertig', jetzt Rot statt Grün)", graphSvg.toLowerCase().includes("#e03131"));

    // ===================== Reset =====================
    doc.querySelector('.nav-item[data-view="einstellungen"]').click();
    await wait(100);
    const statusResetBtn = doc.querySelector('button[data-action="reset-statuscolor"][data-status="Fertig"]');
    check("'Zurücksetzen'-Button für angepasste Status-Ampel vorhanden", !!statusResetBtn);
    if (statusResetBtn) {
      fire(statusResetBtn, "click");
      await wait(100);
      const fertigGreenBtnAfter = doc.querySelector('.ampel-btn[data-status="Fertig"][data-cat="green"]');
      check("Nach Zurücksetzen: Status 'Fertig' wieder auf Grün (automatisch)", fertigGreenBtnAfter.classList.contains("active"));
    }
  }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FARBSCHEMA-EINSTELLUNGEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
