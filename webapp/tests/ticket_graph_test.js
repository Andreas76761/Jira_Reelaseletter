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

// Issue-Links im Standard-Jira-XML-Exportschema: outward/inward je Linktyp,
// mit "desc"-Verb-Text (der die Kategorie bestimmt, s. classifyLinkDesc()).
function linkItem(key, desc, direction, targetKey) {
  return `<issuelinktype><name>Link</name><${direction}links desc="${desc}"><issuelink><issuekey id="1">${targetKey}</issuekey></issuelink></${direction}links></issuelinktype>`;
}
function ticketXml(opts) {
  return `<item><key>${opts.key}</key><summary>${opts.summary}</summary><description>${opts.summary}</description>` +
    `<status>${opts.status}</status><type>Task</type>` +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${opts.domain}</customfieldvalue></customfieldvalues></customfield></customfields>` +
    (opts.links ? `<issuelinks>${opts.links}</issuelinks>` : "") +
    `</item>`;
}

const xml = `<?xml version="1.0"?><rss><channel>
  ${ticketXml({ key: "GRAPH-1", summary: "Erstes Ticket", status: "Offen", domain: "Domain A", links: linkItem("GRAPH-1", "blocks", "outward", "GRAPH-2") })}
  ${ticketXml({ key: "GRAPH-2", summary: "Zweites Ticket", status: "BAT Testing", domain: "Domain A", links: linkItem("GRAPH-2", "is blocked by", "inward", "GRAPH-1") + linkItem("GRAPH-2", "is tested by", "inward", "GRAPH-4") })}
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

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TICKET-GRAPH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
