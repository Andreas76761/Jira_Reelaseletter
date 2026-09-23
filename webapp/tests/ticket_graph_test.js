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

// Issue-Links im ECHTEN Jira-XML-Exportschema (bestaetigt an einem realen
// Jira-10.3.15-Export): outward/inward je Linktyp, Verb-Text im Attribut
// "description" (NICHT "desc" - das war ein Bug, s. parseIssueLinksFromXmlItem).
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
  ${ticketXml({ key: "GRAPH-1", summary: "Erstes Ticket", status: "Offen", domain: "Domain A", type: "Epic", links: linkItem("GRAPH-1", "blocks", "outward", "GRAPH-2") + linkItem("GRAPH-1", "relates to", "outward", "GRAPH-EXT-99") })}
  ${ticketXml({ key: "GRAPH-2", summary: "Zweites Ticket", status: "BAT Testing", domain: "Domain A", type: "Bug", links: linkItem("GRAPH-2", "is blocked by", "inward", "GRAPH-1") + linkItem("GRAPH-2", "is tested by", "inward", "GRAPH-4") })}
  ${ticketXml({ key: "GRAPH-3", summary: "Drittes Ticket", status: "Fertig", domain: "Domain B", links: linkItem("GRAPH-3", "relates to", "outward", "GRAPH-1") })}
  ${ticketXml({ key: "GRAPH-4", summary: "Test-Ticket fuer Zweites", status: "Offen", domain: "Domain B", links: linkItem("GRAPH-4", "tests", "outward", "GRAPH-2") })}
  ${ticketXml({ key: "GRAPH-5", summary: "Isoliertes Ticket ohne Verknuepfung", status: "Offen", domain: "Domain A" })}
  ${ticketXml({ key: "GRAPH-6", summary: "Zirkel A", status: "Offen", domain: "Domain C", links: linkItem("GRAPH-6", "is blocked by", "inward", "GRAPH-7") })}
  ${ticketXml({ key: "GRAPH-7", summary: "Zirkel B", status: "Offen", domain: "Domain C", links: linkItem("GRAPH-7", "is blocked by", "inward", "GRAPH-6") })}
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

  // ===================== Navigation zeigt "Ticket Graph" direkt nach Dashboard =====================
  const navLabels = Array.from(doc.querySelectorAll(".nav-item")).map((b) => b.textContent.trim());
  const dashIdx = navLabels.indexOf("Dashboard");
  check("Nav-Eintrag 'Ticket Graph' vorhanden, direkt nach 'Dashboard'", navLabels[dashIdx + 1] === "Ticket Graph");

  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);
  check("Ticket-Graph-Panel nach Klick sichtbar", doc.querySelector('[data-view-panel="ticketgraph"]').hidden === false);

  // ===================== Standardansicht: nur Tickets MIT Abhaengigkeiten =====================
  const svg1 = doc.getElementById("graph-svg-container").innerHTML;
  check("GRAPH-1 (verknuepft) als Knoten im Graph", svg1.includes("GRAPH-1"));
  check("GRAPH-4 (Test-Ticket) als Knoten im Graph", svg1.includes("GRAPH-4"));
  check("GRAPH-5 (isoliert, keine Verknuepfung) standardmaessig NICHT im Graph", !svg1.includes("GRAPH-5"));
  check("Zirkel-Tickets GRAPH-6/GRAPH-7 trotz Zirkelbezug im Graph (kein Absturz)", svg1.includes("GRAPH-6") && svg1.includes("GRAPH-7"));
  check("Knotenanzahl-Anzeige nennt eine Zahl > 0", /\d+ Ticket/.test(doc.getElementById("graph-node-count").textContent));

  // ===================== Verlinktes, aber nicht geladenes Ticket -> grauer Platzhalter-Knoten =====================
  const phantomNode = doc.querySelector('.graph-node[data-key="GRAPH-EXT-99"]');
  check("GRAPH-EXT-99 (verlinkt, nicht geladen) als Platzhalter-Knoten im Graph", !!phantomNode);
  check("Platzhalter-Knoten traegt die Klasse 'graph-node-phantom'", !!phantomNode && phantomNode.classList.contains("graph-node-phantom"));
  check("Platzhalter-Knoten zeigt Hinweistext 'nicht geladen'", svg1.includes("nicht geladen"));
  check("Knotenanzahl-Anzeige nennt die Anzahl nicht geladener Tickets", /davon \d+ nicht geladen/.test(doc.getElementById("graph-node-count").textContent));

  // ===================== "Nur Tickets mit Abhaengigkeiten" abwaehlen =====================
  const onlyLinkedCb = doc.getElementById("graph-only-linked-checkbox");
  onlyLinkedCb.checked = false;
  fire(onlyLinkedCb, "change");
  await wait(100);
  const svg2 = doc.getElementById("graph-svg-container").innerHTML;
  check("Nach Abwaehlen: GRAPH-5 (isoliert) jetzt ebenfalls im Graph", svg2.includes("GRAPH-5"));
  onlyLinkedCb.checked = true;
  fire(onlyLinkedCb, "change");
  await wait(100);

  // ===================== Legende zeigt Domänen-Farben + Status-Ampel + Verknuepfungsarten =====================
  const legendText = doc.getElementById("graph-legend").textContent;
  check("Legende nennt 'Domain A' (aus den Graph-Tickets)", legendText.includes("Domain A"));
  check("Legende nennt alle 3 Ampel-Kategorien (Rot/Gelb/Grün)", legendText.includes("Rot") && legendText.includes("Gelb") && legendText.includes("Grün"));
  check("Legende nennt 'Vorgänger'/'Nachfolger'/'Testticket'", legendText.includes("Vorgänger") && legendText.includes("Nachfolger") && legendText.includes("Testticket"));
  check("Legende weist auf nicht geladene (graue) Knoten hin", legendText.includes("nicht geladen"));

  // ===================== Klick auf Platzhalter-Knoten -> Auswahltabelle zeigt Hinweis statt Absturz =====================
  const phantomNodeClick = doc.querySelector('.graph-node[data-key="GRAPH-EXT-99"]');
  if (phantomNodeClick) {
    fire(phantomNodeClick, "click");
    await wait(100);
    const phantomSelText = doc.getElementById("graph-selection-tbody").textContent;
    check("Auswahltabelle zeigt GRAPH-EXT-99 nach Klick auf Platzhalter-Knoten", phantomSelText.includes("GRAPH-EXT-99"));
    check("Auswahltabelle erklaert 'Nicht geladen' fuer Platzhalter-Knoten", phantomSelText.includes("Nicht geladen"));
  }

  // ===================== "Alle auswählen"/"Auswahl aufheben"-Buttons bei Domäne/Status =====================
  const domainSelectAllBtn = doc.querySelector('[data-select-all="graph-domain-select"]');
  const domainSelectClearBtn = doc.querySelector('[data-select-clear="graph-domain-select"]');
  check("'Alle auswählen'-Button fuer Domäne vorhanden", !!domainSelectAllBtn);
  check("'Auswahl aufheben'-Button fuer Domäne vorhanden", !!domainSelectClearBtn);
  const statusSelectAllBtn = doc.querySelector('[data-select-all="graph-status-select"]');
  const statusSelectClearBtn = doc.querySelector('[data-select-clear="graph-status-select"]');
  check("'Alle auswählen'-Button fuer Status vorhanden", !!statusSelectAllBtn);
  check("'Auswahl aufheben'-Button fuer Status vorhanden", !!statusSelectClearBtn);
  if (domainSelectAllBtn) {
    fire(domainSelectAllBtn, "click");
    await wait(100);
    const domSel = doc.getElementById("graph-domain-select");
    const allSelected = Array.from(domSel.options).every((o) => o.selected);
    check("'Alle auswählen' markiert wirklich alle Domäne-Optionen", allSelected && domSel.options.length > 1);
    check("'Alle auswählen' loest sofort ein Re-Render aus (Graph reagiert live)", doc.getElementById("graph-svg-container").innerHTML.includes("GRAPH-1"));
  }
  if (domainSelectClearBtn) {
    fire(domainSelectClearBtn, "click");
    await wait(100);
    const domSel = doc.getElementById("graph-domain-select");
    const noneSelected = Array.from(domSel.options).every((o) => !o.selected);
    check("'Auswahl aufheben' hebt wirklich alle Domäne-Optionen auf", noneSelected);
  }

  // ===================== Ticket-Suche filtert Knoten nach Nummer/Text =====================
  const searchInput = doc.getElementById("graph-search-input");
  check("Suchfeld fuer Ticket-Nummer/Text vorhanden", !!searchInput);
  searchInput.value = "Drittes";
  fire(searchInput, "input");
  await wait(250);
  const svgSearch = doc.getElementById("graph-svg-container").innerHTML;
  check("Suche nach 'Drittes' (Zusammenfassung von GRAPH-3): GRAPH-3 im Graph", svgSearch.includes("GRAPH-3"));
  check("Suche nach 'Drittes': GRAPH-4 (kein Treffer, kein Nachbar von GRAPH-3) NICHT im Graph", !svgSearch.includes("GRAPH-4"));
  searchInput.value = "";
  fire(searchInput, "input");
  await wait(250);

  // ===================== Knoten anklicken -> Auswahltabelle aktualisiert sich =====================
  const node2 = doc.querySelector('.graph-node[data-key="GRAPH-2"]');
  check("SVG-Knoten fuer GRAPH-2 im DOM vorhanden", !!node2);
  if (node2) {
    fire(node2, "click");
    await wait(100);
    const selTbody = doc.getElementById("graph-selection-tbody").textContent;
    check("Auswahltabelle zeigt GRAPH-2 nach Klick", selTbody.includes("GRAPH-2"));
    check("Auswahltabelle zeigt Status 'BAT Testing'", selTbody.includes("BAT Testing"));
    check("Auswahltabelle zeigt Domäne 'Domain A'", selTbody.includes("Domain A"));
    check("Auswahltabelle nennt Vorgänger-Verknüpfung zu GRAPH-1", selTbody.includes("Vorgänger: GRAPH-1"));
    check("Auswahltabelle nennt Testticket-Verknüpfung zu GRAPH-4", selTbody.includes("Testticket: GRAPH-4"));
    check("Auswahl-Hinweistext ('kein Ticket ausgewählt') jetzt versteckt", doc.getElementById("graph-selection-empty").hidden === true);
  }

  // ===================== Domänen-Filter grenzt Knoten ein =====================
  const domainSelect = doc.getElementById("graph-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Domain B"; });
  fire(domainSelect, "change");
  await wait(100);
  const svg3 = doc.getElementById("graph-svg-container").innerHTML;
  check("Domänen-Filter 'Domain B': GRAPH-3 im Graph", svg3.includes("GRAPH-3"));
  check("Domänen-Filter 'Domain B': GRAPH-1 (Nachbar, andere Domäne) bleibt als Kontext sichtbar", svg3.includes("GRAPH-1"));
  Array.from(domainSelect.options).forEach((o) => { o.selected = false; });
  fire(domainSelect, "change");
  await wait(100);

  // ===================== Typ-Schnellfilter (Mehrfachauswahl) =====================
  const typeSelect = doc.getElementById("graph-type-select");
  check("Typ-Auswahl vorhanden", !!typeSelect);
  const typeOptionLabels = Array.from(typeSelect.options).map((o) => o.value);
  check("Typ-Auswahl listet 'Epic' und 'Bug' (aus den Testtickets)", typeOptionLabels.includes("Epic") && typeOptionLabels.includes("Bug"));
  Array.from(typeSelect.options).forEach((o) => { o.selected = o.value === "Epic"; });
  fire(typeSelect, "change");
  await wait(100);
  const svgTypeEpic = doc.getElementById("graph-svg-container").innerHTML;
  check("Nur 'Epic' gefiltert: GRAPH-1 (Epic) im Graph", svgTypeEpic.includes("GRAPH-1"));
  check("Nur 'Epic' gefiltert: GRAPH-3 (Task, kein Nachbar von GRAPH-1) NICHT im Graph", !svgTypeEpic.includes("GRAPH-3"));
  // Mehrere Typ-Filter gleichzeitig aktiv (Epic + Bug) - beide Tickets als Knoten.
  Array.from(typeSelect.options).forEach((o) => { o.selected = o.value === "Epic" || o.value === "Bug"; });
  fire(typeSelect, "change");
  await wait(100);
  const svgTypeBoth = doc.getElementById("graph-svg-container").innerHTML;
  check("Epic+Bug gleichzeitig gefiltert: GRAPH-1 (Epic) im Graph", svgTypeBoth.includes("GRAPH-1"));
  check("Epic+Bug gleichzeitig gefiltert: GRAPH-2 (Bug) im Graph", svgTypeBoth.includes("GRAPH-2"));
  check("Epic+Bug gleichzeitig gefiltert: GRAPH-4 (Nachbar von GRAPH-2/Bug) im Graph", svgTypeBoth.includes("GRAPH-4"));
  Array.from(typeSelect.options).forEach((o) => { o.selected = false; });
  fire(typeSelect, "change");
  await wait(100);

  // ===================== Hover-Tooltip zeigt zusaetzliche Inhalte =====================
  const tooltip = doc.getElementById("graph-tooltip");
  check("Tooltip-Element initial versteckt", tooltip.hidden === true);
  const hoverNode = doc.querySelector('.graph-node[data-key="GRAPH-1"]');
  if (hoverNode) {
    const moveEvt = new win.MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 });
    hoverNode.dispatchEvent(moveEvt);
    await wait(50);
    check("Tooltip nach Hover ueber Knoten sichtbar", tooltip.hidden === false);
    check("Tooltip zeigt Ticket-Schlüssel GRAPH-1", tooltip.textContent.includes("GRAPH-1"));
    check("Tooltip zeigt Zusammenfassung ('Erstes Ticket')", tooltip.textContent.includes("Erstes Ticket"));
    fire(doc.getElementById("graph-svg-container"), "mouseleave");
    await wait(50);
    check("Tooltip nach Verlassen des Graphen wieder versteckt", tooltip.hidden === true);
  }
  // Hover ueber einen Platzhalter-Knoten (nicht geladen) - eigener Hinweistext statt Absturz.
  const phantomHover = doc.querySelector('.graph-node[data-key="GRAPH-EXT-99"]');
  if (phantomHover) {
    const moveEvt2 = new win.MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 });
    phantomHover.dispatchEvent(moveEvt2);
    await wait(50);
    check("Tooltip bei Platzhalter-Knoten nennt 'Nicht geladen'", tooltip.textContent.includes("Nicht geladen"));
  }
  fire(doc.getElementById("graph-svg-container"), "mouseleave");
  await wait(50);

  // ===================== Bild-Export-Button vorhanden und ausloesbar (kein Absturz) =====================
  const exportBtn = doc.getElementById("graph-export-image-btn");
  check("Button 'Als Bild exportieren' vorhanden", !!exportBtn);
  if (exportBtn) {
    const errCountBefore = errors.length;
    fire(exportBtn, "click");
    await wait(300);
    // In jsdom ist Canvas/Image-Unterstuetzung eingeschraenkt/nicht immer
    // vorhanden - hier wird nur geprueft, dass der Klick sauber behandelt
    // wird (Erfolg ODER eine per showToast() abgefangene Fehlermeldung),
    // NICHT dass die PNG-Erzeugung selbst gelingt (das setzt eine echte
    // Chromium-Umgebung mit Canvas voraus).
    check("Klick auf Bild-Export loest keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);
  }

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
  console.log("ALLE TICKET-GRAPH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
