// Ticket Graph -> Textschnipsel-Querverweise (Massenverarbeitung): zeigt,
// welche Gliederungskapitel sich in ihren Massenverarbeitung-Textschnipseln
// gegenseitig per "[Verweis]"-Tag referenzieren (rein deterministisch aus dem
// bereits vorhandenen Tag erkannt, kein KI-Aufruf). Kapitel ohne erkannte
// Verweis-Beziehung erscheinen nicht als Knoten.
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

// Kapitelnummern 91-93 bewusst gewaehlt, um Kollisionen mit den
// vorbelegten Gliederungs-Seed-Kapiteln (bis Nr. 16) zu vermeiden - sonst
// liefert chapterNumberFromTitle()/app.outline.filter() faelschlich das
// erste (Seed-)Kapitel mit derselben Nummer statt des hier frisch
// angelegten Test-Kapitels.
const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>XR-1</key><summary>Kapitel1 Eintrag</summary><description>Diese Funktion ist zentral. [Verweis] Siehe Kapitel 92 fuer Details zum Ablauf.</description><status>Offen</status><type>Task</type></item>
  <item><key>XR-2</key><summary>Kapitel2 Eintrag</summary><description>Standardprozess. [Verweis] Vergleiche Kapitel 91 wegen der Grundlagen.</description><status>Offen</status><type>Task</type></item>
  <item><key>XR-3</key><summary>Kapitel3 Eintrag</summary><description>Kein Verweis hier, nur normaler Text ohne Tag.</description><status>Offen</status><type>Task</type></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Leerer Zustand: noch keine Textschnipsel =====================
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(50);
  check("'Querverweise anzeigen'-Button vorhanden", !!doc.getElementById("xref-graph-generate-btn"));
  fire(doc.getElementById("xref-graph-generate-btn"), "click");
  await wait(50);
  check("Leerer Zustand: Graph-Wrap ausgeblendet", doc.getElementById("xref-graph-wrap").hidden === true);
  check("Leerer Zustand: Leer-Meldung sichtbar", doc.getElementById("xref-graph-empty").hidden === false);

  // ===================== Gliederung mit 3 Kapiteln anlegen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  ["Kapitel 91: Einleitung", "Kapitel 92: Prozesse", "Kapitel 93: Ohne Verweis"].forEach((title) => {
    doc.getElementById("outline-new-chapter-input").value = title;
    fire(doc.getElementById("outline-add-chapter-btn"), "click");
  });
  await wait(50);

  // ===================== Tickets importieren + als Textschnipsel übernehmen =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "xref.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  fire(doc.getElementById("mass-collect-tickets-btn"), "click");
  await wait(100);

  function massRowByLabelContains(text) {
    return Array.from(doc.querySelectorAll("#mass-groups tr")).find((tr) => tr.textContent.includes(text));
  }
  function assignChapter(ticketKey, chapterTitle) {
    const row = massRowByLabelContains(ticketKey);
    if (!row) return false;
    const sel = row.querySelector(".mass-chapter-select");
    if (!sel) return false;
    sel.value = chapterTitle;
    fire(sel, "change");
    return true;
  }
  check("XR-1 einem Kapitel zugeordnet (Kapitel 1)", assignChapter("XR-1", "Kapitel 91: Einleitung"));
  check("XR-2 einem Kapitel zugeordnet (Kapitel 2)", assignChapter("XR-2", "Kapitel 92: Prozesse"));
  check("XR-3 einem Kapitel zugeordnet (Kapitel 93, ohne Verweis)", assignChapter("XR-3", "Kapitel 93: Ohne Verweis"));
  await wait(50);

  // ===================== Graph erzeugen =====================
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(50);
  fire(doc.getElementById("xref-graph-generate-btn"), "click");
  await wait(50);

  check("Graph-Wrap jetzt sichtbar", doc.getElementById("xref-graph-wrap").hidden === false);
  check("Leer-Meldung jetzt ausgeblendet", doc.getElementById("xref-graph-empty").hidden === true);
  const svg = doc.querySelector("#xref-graph-svg-container svg");
  check("SVG wurde gerendert", !!svg);
  const circles = svg ? Array.from(svg.querySelectorAll("circle")) : [];
  check("Genau 2 Kapitel-Knoten (Kapitel 91 + Kapitel 92) - Kapitel 93 ohne Verweis nicht enthalten", circles.length === 2);
  const circleTitles = circles.map((c) => c.querySelector("title") && c.querySelector("title").textContent);
  check("Knoten 'Kapitel 91: Einleitung' vorhanden", circleTitles.includes("Kapitel 91: Einleitung"));
  check("Knoten 'Kapitel 92: Prozesse' vorhanden", circleTitles.includes("Kapitel 92: Prozesse"));
  check("Kapitel 93 (ohne Verweis-Beziehung) erscheint NICHT als Knoten", !circleTitles.some((t) => t && t.includes("Kapitel 93")));

  const lines = svg ? Array.from(svg.querySelectorAll("line")) : [];
  check("Genau 2 gerichtete Verweis-Kanten (91→92 und 92→91)", lines.length === 2);
  const lineTitles = lines.map((l) => l.querySelector("title") && l.querySelector("title").textContent);
  check("Kante 91→92 mit korrektem Verweistext als Tooltip",
    lineTitles.some((t) => t && t.includes("Kapitel 91: Einleitung") && t.includes("Kapitel 92: Prozesse") && t.includes("Siehe Kapitel 92")));
  check("Kante 92→91 mit korrektem Verweistext als Tooltip",
    lineTitles.some((t) => t && t.includes("Kapitel 92: Prozesse") && t.includes("Kapitel 91: Einleitung") && t.includes("Vergleiche Kapitel 91")));

  const statusNote = doc.getElementById("xref-graph-status-note").textContent;
  check("Status-Hinweis nennt 2 Kapitel und 2 Verweis-Beziehung(en)", statusNote.includes("2 Kapitel") && statusNote.includes("2 Verweis-Beziehung"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE TEXTSCHNIPSEL-QUERVERWEISE-GRAPH-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
