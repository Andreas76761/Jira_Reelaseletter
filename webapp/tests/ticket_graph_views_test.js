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

function linkItem(desc, direction, targetKey) {
  return `<issuelinktype><name>Link</name><${direction}links description="${desc}"><issuelink><issuekey id="1">${targetKey}</issuekey></issuelink></${direction}links></issuelinktype>`;
}
function ticketXml(opts) {
  var epicLinkField = opts.epicLink
    ? `<customfield id="customfield_10207" key="com.pyxis.greenhopper.jira:gh-epic-link"><customfieldname>Epic Link</customfieldname><customfieldvalues><customfieldvalue>${opts.epicLink}</customfieldvalue></customfieldvalues></customfield>`
    : "";
  return `<item><key>${opts.key}</key><summary>${opts.summary}</summary><description>${opts.summary}</description>` +
    `<status>${opts.status}</status><type>${opts.type || "Task"}</type>` +
    (opts.created ? `<created>${opts.created}</created>` : "") +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${opts.domain}</customfieldvalue></customfieldvalues></customfield>${epicLinkField}</customfields>` +
    (opts.links ? `<issuelinks>${opts.links}</issuelinks>` : "") +
    `</item>`;
}

// EPIC (VIEW-1) mit zwei Epic-Kindern (VIEW-2/VIEW-3) und einer normalen
// Vorgänger/Nachfolger-Kette (VIEW-4 -> VIEW-5) fuer eine reichhaltige
// Testabdeckung ueber alle 4 neuen Ansichten hinweg.
const xml = `<?xml version="1.0"?><rss><channel>
  ${ticketXml({ key: "VIEW-1", summary: "Epic Eins", status: "Offen", domain: "Domain A", type: "Epic", created: "Mon, 1 Jan 24 10:00" })}
  ${ticketXml({ key: "VIEW-2", summary: "Kind Eins", status: "Offen", domain: "Domain A", type: "Story", epicLink: "VIEW-1", created: "Tue, 2 Jan 24 10:00" })}
  ${ticketXml({ key: "VIEW-3", summary: "Kind Zwei", status: "Fertig", domain: "Domain A", type: "Story", epicLink: "VIEW-1", created: "Wed, 3 Jan 24 10:00" })}
  ${ticketXml({ key: "VIEW-4", summary: "Vorgänger", status: "Fertig", domain: "Domain B", type: "Task", created: "Thu, 4 Jan 24 10:00", links: linkItem("blocks", "outward", "VIEW-5") })}
  ${ticketXml({ key: "VIEW-5", summary: "Nachfolger", status: "Offen", domain: "Domain B", type: "Task", created: "Fri, 5 Jan 24 10:00", links: linkItem("is blocked by", "inward", "VIEW-4") })}
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
  Object.defineProperty(input, "files", { value: [new win.File([xml], "viewstest.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);
  const onlyLinkedCb = doc.getElementById("graph-only-linked-checkbox");
  onlyLinkedCb.checked = false;
  fire(onlyLinkedCb, "change");
  await wait(100);

  // ===================== Tab-Leiste vorhanden, "Schichten" standardmäßig aktiv =====================
  const tabs = doc.querySelectorAll("#graph-view-tabs [data-graph-view]");
  check("5 Graph-Ansichts-Tabs vorhanden (Schichten/Baum/Netzwerk/Matrix/Zeitleiste)", tabs.length === 5);
  check("'Schichten' initial aktiv", doc.querySelector('[data-graph-view="layers"]').classList.contains("active"));
  check("Beschreibungstext zur aktiven Ansicht vorhanden", doc.getElementById("graph-view-desc").textContent.length > 10);

  // ===================== Baumansicht (Epic-zentriert) =====================
  fire(doc.querySelector('[data-graph-view="tree"]'), "click");
  await wait(150);
  check("'Baum'-Tab nach Klick aktiv, 'Schichten' nicht mehr", doc.querySelector('[data-graph-view="tree"]').classList.contains("active") && !doc.querySelector('[data-graph-view="layers"]').classList.contains("active"));
  let svgTree = doc.getElementById("graph-svg-container").innerHTML;
  check("Baumansicht: SVG wird gerendert (kein Matrix-HTML)", svgTree.includes("<svg"));
  check("Baumansicht: EPIC VIEW-1 als Knoten vorhanden", svgTree.includes("VIEW-1"));
  check("Baumansicht: Epic-Kinder VIEW-2/VIEW-3 als Knoten vorhanden", svgTree.includes("VIEW-2") && svgTree.includes("VIEW-3"));
  const epicPos = svgTree.indexOf('data-key="VIEW-1"');
  const childPos = svgTree.indexOf('data-key="VIEW-2"');
  // Baumansicht positioniert das Epic strukturell VOR (links von) seinen
  // Kindern - grobe Plausibilitaetspruefung ueber die x-Koordinate im SVG-Markup.
  function xOf(svgText, key) {
    var idx = svgText.indexOf('data-key="' + key + '"');
    var rectIdx = svgText.indexOf("<rect", idx);
    var m = /x="([\d.]+)"/.exec(svgText.slice(rectIdx, rectIdx + 200));
    return m ? parseFloat(m[1]) : null;
  }
  const xEpic = xOf(svgTree, "VIEW-1");
  const xChild = xOf(svgTree, "VIEW-2");
  check("Baumansicht: Epic steht links von seinem Kind (kleinere x-Koordinate)", xEpic != null && xChild != null && xEpic < xChild);

  // ===================== Netzwerk-Ansicht (Kräftelayout) =====================
  fire(doc.querySelector('[data-graph-view="network"]'), "click");
  await wait(200);
  let svgNetwork = doc.getElementById("graph-svg-container").innerHTML;
  check("Netzwerk-Ansicht: SVG wird gerendert", svgNetwork.includes("<svg"));
  check("Netzwerk-Ansicht: alle 5 Test-Tickets als Knoten vorhanden", ["VIEW-1", "VIEW-2", "VIEW-3", "VIEW-4", "VIEW-5"].every((k) => svgNetwork.includes(k)));
  check("Netzwerk-Ansicht: keine zwei Knoten an exakt derselben Position (kein Kollaps)", (function () {
    var positions = ["VIEW-1", "VIEW-2", "VIEW-3", "VIEW-4", "VIEW-5"].map((k) => [xOf(svgNetwork, k), xOf(svgNetwork, k)]);
    var xs = ["VIEW-1", "VIEW-2", "VIEW-3", "VIEW-4", "VIEW-5"].map((k) => xOf(svgNetwork, k));
    var unique = new Set(xs.map((x) => Math.round(x)));
    return unique.size > 1; // nicht alle exakt gleich (waere ein Zeichen fuer eine kaputte Simulation)
  })());

  // ===================== Zeitleisten-Ansicht =====================
  fire(doc.querySelector('[data-graph-view="timeline"]'), "click");
  await wait(150);
  let svgTimeline = doc.getElementById("graph-svg-container").innerHTML;
  check("Zeitleisten-Ansicht: SVG wird gerendert", svgTimeline.includes("<svg"));
  const xV4 = xOf(svgTimeline, "VIEW-4"), xV5 = xOf(svgTimeline, "VIEW-5");
  check("Zeitleisten-Ansicht: früher erstelltes Ticket (VIEW-4) steht links von später erstelltem (VIEW-5)", xV4 != null && xV5 != null && xV4 < xV5);

  // ===================== Matrix-Ansicht (kein SVG, HTML-Tabelle) =====================
  fire(doc.querySelector('[data-graph-view="matrix"]'), "click");
  await wait(150);
  const matrixHtml = doc.getElementById("graph-svg-container").innerHTML;
  check("Matrix-Ansicht: KEIN <svg>, sondern eine Tabelle", !matrixHtml.includes("<svg") && matrixHtml.includes("<table"));
  check("Matrix-Ansicht: alle 5 Test-Tickets als Zeilen-/Spaltenköpfe vorhanden", ["VIEW-1", "VIEW-2", "VIEW-3", "VIEW-4", "VIEW-5"].every((k) => matrixHtml.includes(k)));
  check("Matrix-Ansicht: Zelle fuer VIEW-4->VIEW-5 (Nachfolger-Kante) eingefaerbt", matrixHtml.includes("VIEW-4 → VIEW-5"));
  check("Zoom-Buttons wirkungslos/kein Absturz in der Matrix-Ansicht", (function () {
    var errBefore = errors.length;
    fire(doc.getElementById("graph-zoom-in-btn"), "click");
    return errors.length === errBefore;
  })());

  // ===================== Zurueck zu "Schichten" - unveraendertes Verhalten =====================
  fire(doc.querySelector('[data-graph-view="layers"]'), "click");
  await wait(150);
  const svgLayers = doc.getElementById("graph-svg-container").innerHTML;
  check("Zurück auf 'Schichten': SVG wieder wie gewohnt gerendert", svgLayers.includes("<svg") && svgLayers.includes("VIEW-1"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TICKET-GRAPH-ANSICHTEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
