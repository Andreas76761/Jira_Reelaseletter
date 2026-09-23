// Ticket Graph - Teil 1/3: Navigation, Standardansicht, Platzhalter-Knoten,
// EPIC-Rahmen/Epic-Verknuepfung, Beschreibungs-Pin-Knopf, Legende,
// Domaenen-/Status-"Alle auswaehlen"/"Auswahl aufheben"-Buttons.
// Aufgeteilt aus einer vorher einzelnen, sehr grossen Datei (409 Zeilen/87
// Checks) in mehrere kleinere, fokussierte Dateien (siehe
// ticket_graph_filter_test.js und ticket_graph_interact_test.js fuer die
// weiteren Abschnitte) - jede Datei bleibt eigenstaendig lauffaehig (eigenes
// JSDOM-Setup) und liefert dadurch frueher/granularer Ergebnisse.
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
function ticketXml(opts) {
  var epicLinkField = opts.epicLink
    ? `<customfield id="customfield_10207" key="com.pyxis.greenhopper.jira:gh-epic-link"><customfieldname>Epic Link</customfieldname><customfieldvalues><customfieldvalue>${opts.epicLink}</customfieldvalue></customfieldvalues></customfield>`
    : "";
  return `<item><key>${opts.key}</key><summary>${opts.summary}</summary><description>${opts.summary}</description>` +
    `<status>${opts.status}</status><type>${opts.type || "Task"}</type>` +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${opts.domain}</customfieldvalue></customfieldvalues></customfield>${epicLinkField}</customfields>` +
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
  ${ticketXml({ key: "GRAPH-8", summary: "Epic-Kind von GRAPH-1", status: "Offen", domain: "Domain A", type: "Story", epicLink: "GRAPH-1" })}
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

  // ===================== EPIC: fetter Rahmen + Epic->Kind-Kante (Feld "Epic Link") =====================
  const epicNodeGroup = doc.querySelector('.graph-node[data-key="GRAPH-1"]');
  check("GRAPH-1 (Typ Epic) traegt die Klasse 'graph-node-epic'", !!epicNodeGroup && epicNodeGroup.classList.contains("graph-node-epic"));
  const epicRect = epicNodeGroup && epicNodeGroup.querySelector("rect");
  check("EPIC-Knoten hat eine deutlich dickere Rahmenstaerke als normale Knoten (fetter Rahmen)",
    !!epicRect && parseFloat(epicRect.getAttribute("stroke-width")) >= 3.5);
  check("GRAPH-8 (Epic-Kind ueber Feld 'Epic Link') als Knoten im Graph", svg1.includes("GRAPH-8"));
  const epicChildNode = doc.querySelector('.graph-node[data-key="GRAPH-8"]');
  check("GRAPH-8 selbst hat KEINEN fetten Epic-Rahmen (ist kein Epic)", !!epicChildNode && !epicChildNode.classList.contains("graph-node-epic"));
  if (epicChildNode) {
    fire(epicChildNode, "click");
    await wait(100);
    const epicChildSelText = doc.getElementById("graph-selection-tbody").textContent;
    check("Auswahltabelle nennt die Epic-Verknüpfung zu GRAPH-1 fuer GRAPH-8", epicChildSelText.includes("Epic-Verknüpfung: GRAPH-1"));
  }
  const legendTextEpic = doc.getElementById("graph-legend").textContent;
  check("Legende nennt 'Epic-Verknüpfung' als Verknuepfungsart", legendTextEpic.includes("Epic-Verknüpfung"));

  // ===================== Neuer "i"-Knopf je Knoten: Beschreibung anpinnen =====================
  const tooltipPin = doc.getElementById("graph-tooltip");
  const descBtn1 = doc.querySelector('.graph-desc-btn[data-key="GRAPH-1"]');
  check("Neuer 'i'-Knopf am Knoten GRAPH-1 vorhanden", !!descBtn1);
  if (descBtn1) {
    fire(descBtn1, "click");
    await wait(50);
    check("Nach Klick auf 'i': Beschreibungs-Panel sichtbar (angepinnt)", tooltipPin.hidden === false);
    check("Angepinntes Panel zeigt Inhalt zu GRAPH-1", tooltipPin.textContent.includes("GRAPH-1"));
    check("Angepinntes Panel nennt den Schließen-Hinweis", tooltipPin.textContent.includes("Schließen"));
    // Normales Hovern ueber einen ANDEREN Knoten darf das angepinnte Panel NICHT ueberschreiben.
    const otherNodeForHover = doc.querySelector('.graph-node[data-key="GRAPH-2"]');
    if (otherNodeForHover) {
      fire(otherNodeForHover, "mousemove");
      await wait(50);
      check("Angepinntes Panel bleibt bei GRAPH-1, auch wenn ueber GRAPH-2 gehovert wird", doc.getElementById("graph-tooltip").textContent.includes("GRAPH-1") && !doc.getElementById("graph-tooltip").textContent.includes("Zweites Ticket"));
    }
    // Erneuter Klick auf denselben Knopf schliesst das Panel wieder.
    fire(doc.querySelector('.graph-desc-btn[data-key="GRAPH-1"]'), "click");
    await wait(50);
    check("Erneuter Klick auf 'i' schließt das angepinnte Panel wieder", doc.getElementById("graph-tooltip").hidden === true);
  }

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

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TICKET-GRAPH-TESTS (TEIL 1) BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
