// Ticket Graph - Teil 3/3: Mehrfachauswahl (Strg/Cmd-Klick) -> als Liste
// speichern, Zoom/Pan, sowie zwei gezielte Regressionstests (Teil-Import
// ohne Issue-Links, Fallback auf das alte "desc"-Attribut).
// Siehe ticket_graph_test.js (Teil 1) fuer den Hintergrund der Aufteilung.
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

function linkItem(key, desc, direction, targetKey) {
  return `<issuelinktype><name>Link</name><${direction}links description="${desc}"><issuelink><issuekey id="1">${targetKey}</issuekey></issuelink></${direction}links></issuelinktype>`;
}
// Fuer den expliziten Fallback-Regressionstest: dieselbe Struktur, aber mit
// dem ALTEN Attributnamen "desc" - muss weiterhin funktionieren.
function linkItemLegacyDescAttr(desc, direction, targetKey) {
  return `<issuelinktype><name>Link</name><${direction}links desc="${desc}"><issuelink><issuekey id="1">${targetKey}</issuekey></issuelink></${direction}links></issuelinktype>`;
}
function ticketXml(opts) {
  return `<item><key>${opts.key}</key><summary>${opts.summary}</summary><description>${opts.summary}</description>` +
    `<status>${opts.status}</status><type>${opts.type || "Task"}</type>` +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${opts.domain}</customfieldvalue></customfieldvalues></customfield></customfields>` +
    (opts.links ? `<issuelinks>${opts.links}</issuelinks>` : "") +
    `</item>`;
}

const xml = `<?xml version="1.0"?><rss><channel>
  ${ticketXml({ key: "GRAPH-1", summary: "Erstes Ticket", status: "Offen", domain: "Domain A", links: linkItem("GRAPH-1", "blocks", "outward", "GRAPH-2") })}
  ${ticketXml({ key: "GRAPH-2", summary: "Zweites Ticket", status: "BAT Testing", domain: "Domain A", links: linkItem("GRAPH-2", "is blocked by", "inward", "GRAPH-1") })}
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
  Object.defineProperty(input, "files", { value: [new win.File([xml], "graph.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);

  // ===================== Mehrfachauswahl (Strg/Cmd-Klick) -> als Liste speichern =====================
  function fireCtrlClick(el) { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ctrlKey: true })); }
  const msBar = doc.getElementById("graph-multiselect-count");
  check("Mehrfachauswahl-Leiste vorhanden, initial leer", msBar.textContent.includes("Strg/Cmd-Klick"));
  const msSaveBtn = doc.getElementById("graph-multiselect-save-btn");
  const msClearBtn = doc.getElementById("graph-multiselect-clear-btn");
  check("'Als Liste speichern'-Button initial deaktiviert (keine Auswahl)", msSaveBtn.disabled === true);
  const node1 = doc.querySelector('.graph-node[data-key="GRAPH-1"]');
  const node2bExists = !!doc.querySelector('.graph-node[data-key="GRAPH-2"]');
  if (node1 && node2bExists) {
    fireCtrlClick(node1);
    await wait(50);
    // Jeder renderTicketGraph()-Aufruf ersetzt das komplette SVG (innerHTML)
    // - vorher abgefragte Knoten-Elemente sind danach vom Dokument getrennt
    // und wuerden Klicks NICHT mehr an den Container-Listener bubblen
    // lassen. Daher nach jedem Render frisch abfragen.
    fireCtrlClick(doc.querySelector('.graph-node[data-key="GRAPH-2"]'));
    await wait(50);
    check("Nach 2x Strg-Klick: Mehrfachauswahl-Leiste nennt 2 Tickets", doc.getElementById("graph-multiselect-count").textContent.includes("2 Ticket"));
    check("'Als Liste speichern'-Button jetzt aktiviert", doc.getElementById("graph-multiselect-save-btn").disabled === false);
    check("Beide Knoten tragen die Mehrfachauswahl-Markierung (graph-node-multiselected)",
      doc.querySelectorAll(".graph-node-multiselected").length === 2);
    check("Normale Einzelauswahl (Detail-Tabelle) bleibt von Strg-Klick unberührt (kein Absturz/Seiteneffekt)", !!doc.getElementById("graph-selection-tbody"));

    // Strg-Klick auf GRAPH-1 erneut -> aus der Mehrfachauswahl entfernen.
    fireCtrlClick(doc.querySelector('.graph-node[data-key="GRAPH-1"]'));
    await wait(50);
    check("Erneuter Strg-Klick entfernt aus der Mehrfachauswahl (jetzt nur noch 1)", doc.getElementById("graph-multiselect-count").textContent.includes("1 Ticket"));
    // GRAPH-1 wieder dazu, dann als Liste speichern.
    fireCtrlClick(doc.querySelector('.graph-node[data-key="GRAPH-1"]'));
    await wait(50);

    const nameInput = doc.getElementById("graph-multiselect-name-input");
    nameInput.value = "Graph-Testliste";
    fire(doc.getElementById("graph-multiselect-save-btn"), "click");
    await wait(100);
    check("Nach Speichern: Mehrfachauswahl wieder leer (0 Tickets)", doc.getElementById("graph-multiselect-count").textContent.includes("Strg/Cmd-Klick"));
    check("'Als Liste speichern'-Button nach dem Speichern wieder deaktiviert", doc.getElementById("graph-multiselect-save-btn").disabled === true);

    doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
    await wait(100);
    const listenauswahlText = doc.getElementById("listenauswahl-tbody").textContent;
    check("Neue Liste 'Graph-Testliste' unter Listenauswahl mit 2 Tickets gespeichert", listenauswahlText.includes("Graph-Testliste") && listenauswahlText.includes("2"));
    doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
    await wait(150);
  }
  // "Auswahl aufheben"-Button testen (mit frischer Auswahl).
  const node3 = doc.querySelector('.graph-node[data-key="GRAPH-1"]');
  if (node3) {
    fireCtrlClick(node3);
    await wait(50);
    check("Vor 'Auswahl aufheben': mind. 1 Ticket ausgewählt", doc.getElementById("graph-multiselect-count").textContent.includes("1 Ticket"));
    fire(doc.getElementById("graph-multiselect-clear-btn"), "click");
    await wait(50);
    check("Nach 'Auswahl aufheben': Mehrfachauswahl wieder leer", doc.getElementById("graph-multiselect-count").textContent.includes("Strg/Cmd-Klick"));
    check("Keine Knoten mehr mit Mehrfachauswahl-Markierung", doc.querySelectorAll(".graph-node-multiselected").length === 0);
  }

  // ===================== Zoom/Pan =====================
  const zoomLevelEl = doc.getElementById("graph-zoom-level");
  check("Zoom-Stufe initial 100%", zoomLevelEl.textContent === "100%");
  const svgBeforeZoom = doc.querySelector("#graph-svg-container svg");
  const widthBeforeZoom = svgBeforeZoom ? parseFloat(svgBeforeZoom.getAttribute("width")) : 0;
  fire(doc.getElementById("graph-zoom-in-btn"), "click");
  await wait(50);
  check("Nach Zoom-In: Zoom-Stufe > 100%", parseInt(doc.getElementById("graph-zoom-level").textContent, 10) > 100);
  const svgAfterZoomIn = doc.querySelector("#graph-svg-container svg");
  check("Nach Zoom-In: SVG-Breite (Pixel) größer als zuvor", parseFloat(svgAfterZoomIn.getAttribute("width")) > widthBeforeZoom);
  fire(doc.getElementById("graph-zoom-reset-btn"), "click");
  await wait(50);
  check("Nach 'Zoom zurücksetzen': wieder 100%", doc.getElementById("graph-zoom-level").textContent === "100%");
  fire(doc.getElementById("graph-zoom-out-btn"), "click");
  await wait(50);
  check("Nach Zoom-Out: Zoom-Stufe < 100%", parseInt(doc.getElementById("graph-zoom-level").textContent, 10) < 100);
  fire(doc.getElementById("graph-zoom-reset-btn"), "click");
  await wait(50);
  // Strg+Mausrad zoomt; normales Scrollen (ohne ctrlKey) darf die Zoom-Stufe NICHT aendern.
  const wheelCtrl = new win.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
  doc.getElementById("graph-svg-container").dispatchEvent(wheelCtrl);
  await wait(50);
  check("Strg+Mausrad (deltaY<0) zoomt hinein (> 100%)", parseInt(doc.getElementById("graph-zoom-level").textContent, 10) > 100);
  fire(doc.getElementById("graph-zoom-reset-btn"), "click");
  await wait(50);
  const wheelNoCtrl = new win.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: false });
  doc.getElementById("graph-svg-container").dispatchEvent(wheelNoCtrl);
  await wait(50);
  check("Mausrad OHNE Strg/Cmd aendert die Zoom-Stufe NICHT (normales Scrollen bleibt frei)", doc.getElementById("graph-zoom-level").textContent === "100%");

  // ===================== Regression: Teil-Import ohne Issue-Links behaelt bestehende Links =====================
  const xmlPartial = `<?xml version="1.0"?><rss><channel><item><key>GRAPH-1</key><status>Fertig</status><type>Task</type></item></channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlPartial], "graph_update.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);
  const svg4 = doc.getElementById("graph-svg-container").innerHTML;
  check("Nach Teil-Import (nur Status-Update): GRAPH-1 behaelt seine Verknuepfung zu GRAPH-2 (weiterhin im Graph)", svg4.includes("GRAPH-1") && svg4.includes("GRAPH-2"));

  // ===================== Regression: Fallback auf altes Attribut "desc" funktioniert weiterhin =====================
  const xmlLegacyAttr = `<?xml version="1.0"?><rss><channel>
    <item><key>LEGACY-1</key><summary>Legacy Vorgaenger</summary><status>Offen</status><type>Task</type>
      <issuelinks>${linkItemLegacyDescAttr("blocked by", "inward", "LEGACY-2")}</issuelinks></item>
    <item><key>LEGACY-2</key><summary>Legacy Nachfolger</summary><status>Offen</status><type>Task</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  Object.defineProperty(input, "files", { value: [new win.File([xmlLegacyAttr], "legacy_desc.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);
  const legacyNode = doc.querySelector('.graph-node[data-key="LEGACY-1"]');
  if (legacyNode) fire(legacyNode, "click");
  await wait(100);
  const legacySelText = doc.getElementById("graph-selection-tbody").textContent;
  check("Altes Attribut 'desc' (Fallback) wird weiterhin korrekt als Vorgänger klassifiziert", legacySelText.includes("Vorgänger: LEGACY-2"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TICKET-GRAPH-INTERAKTIONS-TESTS (TEIL 3) BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
