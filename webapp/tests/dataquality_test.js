// Neuer Nav-Punkt "Datenqualität": 12 automatisierte Prüfpunkte gegen die
// aktuell geladenen Tickets, rein aus vorhandenen Feldern abgeleitet
// (kein KI-Aufruf). Jede Fixture setzt bewusst SICHERE Werte fuer alle
// Felder ausser dem einen, gezielt getesteten Feld - Ausnahme sind
// Pruefpunkte, die sich gegenseitig bedingen (z.B. loest "fehlende
// Domaene" zwangslaeufig auch "kein Kapitel zugeordnet" aus, da die
// Kapitel-Zuordnung selbst auf der Domaene beruht) - solche erwarteten
// Ueberschneidungen werden explizit zugelassen statt strikter
// Exakt-1-Zaehlung je Zeile.
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
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// Relative Zeitangaben (statt fester Kalenderdaten) - laeuft unabhaengig
// vom tatsaechlichen Testdatum stabil durch. ISO-Format wird von
// parseJiraDate() ueber den Date.parse()-Fallback korrekt erkannt.
function daysAgo(days) { return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString(); }
const RECENT = daysAgo(3);   // "vor kurzem aktualisiert" - loest "veraltet" NICHT aus
const OLD = daysAgo(200);    // ">90 Tage" - loest "veraltet" aus

function linkItem(desc, direction, targetKey) {
  return `<issuelinktype><name>Link</name><${direction}links description="${desc}"><issuelink><issuekey id="1">${targetKey}</issuekey></issuelink></${direction}links></issuelinktype>`;
}
// Sichere Standardwerte, die fuer sich genommen KEINEN der 12 Punkte
// ausloesen - jede Fixture ueberschreibt gezielt nur das zu testende Feld.
function ticketXml(opts) {
  // Typ "Bug" als Standard, weil er im Standard-Punkte-System (Einstellungen)
  // gepflegt ist ("Task" ist es NICHT), Domäne "Contract Management" als
  // Standard, weil sie einem Kapitel der Standard-Gliederung zugeordnet ist
  // (Kapitel 7) - beides sonst würde JEDE Fixture (nicht nur die gezielt
  // dafür gebauten DQ-NOPOINTS/DQ-NOOUTLINE) diese Punkte fälschlich mit
  // auslösen.
  var o = Object.assign({
    summary: "Sicherer Standardtitel", description: "Sichere Standardbeschreibung.",
    status: "Offen", type: "Bug", domain: "Contract Management", created: RECENT, updated: RECENT
  }, opts);
  var epicField = o.epicLink
    ? `<customfield id="customfield_10207" key="com.pyxis.greenhopper.jira:gh-epic-link"><customfieldname>Epic Link</customfieldname><customfieldvalues><customfieldvalue>${o.epicLink}</customfieldvalue></customfieldvalues></customfield>`
    : "";
  var domainField = o.domain
    ? `<customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${o.domain}</customfieldvalue></customfieldvalues></customfield>`
    : "";
  return `<item><key>${o.key}</key><summary>${o.summary}</summary><description>${o.description}</description>` +
    `<status>${o.status}</status><type>${o.type}</type>` +
    `<created>${o.created}</created><updated>${o.updated}</updated>` +
    (o.resolved ? `<resolved>${o.resolved}</resolved>` : "") +
    `<customfields>${domainField}${epicField}</customfields>` +
    (o.links ? `<issuelinks>${o.links}</issuelinks>` : "") +
    `</item>`;
}

// Ein vollstaendig "sauberes" Referenz-Ticket - darf bei KEINEM der 12
// Punkte auftauchen (Regressionsschutz gegen Fehlalarme).
const cleanTicket = ticketXml({ key: "DQ-CLEAN", status: "Fertig", resolved: RECENT });

const xml = `<?xml version="1.0"?><rss><channel>
  ${cleanTicket}
  ${ticketXml({ key: "DQ-NOSUMMARY", summary: "" })}
  ${ticketXml({ key: "DQ-NODESC", description: "" })}
  ${ticketXml({ key: "DQ-NODOMAIN", domain: "" })}
  ${ticketXml({ key: "DQ-NOTYPE", type: "" })}
  ${ticketXml({ key: "DQ-NOCREATED", created: "", updated: "" })}
  ${ticketXml({ key: "DQ-DONE-NORESOLVED", status: "Fertig" })}
  ${ticketXml({ key: "DQ-STALE", created: OLD, updated: "" })}
  ${ticketXml({ key: "DQ-ORPHANLINK", links: linkItem("blocks", "outward", "DQ-NICHT-GELADEN") })}
  ${ticketXml({ key: "DQ-ORPHANEPIC", epicLink: "DQ-EPIC-FEHLT" })}
  ${ticketXml({ key: "DQ-NOLABEL", summary: "xyzxyzxyz voellig unbekannter Begriff qwertqwert", domain: "Domain A" })}
  ${ticketXml({ key: "DQ-NOOUTLINE", domain: "Domäne Ohne Kapitel Xyz" })}
  ${ticketXml({ key: "DQ-NOPOINTS", type: "Voellig Unbekannter Typ Xyz" })}
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Erst alle Demo-Tickets loeschen - fuer vorhersagbare Trefferzahlen.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "dataquality.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Navigation zeigt "Datenqualität" direkt nach "Trend" =====================
  const navLabels = Array.from(doc.querySelectorAll(".nav-item")).map((b) => b.textContent.trim());
  const trendIdx = navLabels.indexOf("Trend");
  check("Nav-Eintrag 'Datenqualität' vorhanden, direkt nach 'Trend'", navLabels[trendIdx + 1] === "Datenqualität");

  doc.querySelector('.nav-item[data-view="dataquality"]').click();
  await wait(150);
  check("Datenqualität-Panel nach Klick sichtbar", doc.querySelector('[data-view-panel="dataquality"]').hidden === false);

  // ===================== Zusammenfassung-Chips =====================
  check("13 Tickets geprüft (12 Fixtures + 1 sauberes Referenz-Ticket)", doc.getElementById("dq-tickets-total").textContent === "13");
  check("Leer-Zustand versteckt (Daten vorhanden)", doc.getElementById("dq-empty-state").hidden === true);

  check("Alle 12 Prüfpunkte als Zeilen vorhanden", doc.querySelectorAll(".dq-group-row").length === 12);

  // ===================== Jeder Prüfpunkt aufgeklappt: nennt sein Ziel-Ticket, NIE das saubere Referenz-Ticket =====================
  function expandAndGetText(titleSubstr) {
    var row = Array.from(doc.querySelectorAll(".dq-group-row")).find((r) => r.textContent.includes(titleSubstr));
    if (!row) return null;
    var toggle = row.querySelector(".dq-group-toggle");
    fire(toggle, "click");
    return row;
  }
  const expectations = [
    ["Fehlende Zusammenfassung", "DQ-NOSUMMARY"],
    ["Fehlende Beschreibung", "DQ-NODESC"],
    ["Fehlende Domäne", "DQ-NODOMAIN"],
    ["Fehlender Typ", "DQ-NOTYPE"],
    ["Fehlendes Erstellungsdatum", "DQ-NOCREATED"],
    ["Erledigt ohne \"Gelöst am\"", "DQ-DONE-NORESOLVED"],
    ["Veraltet", "DQ-STALE"],
    ["Verwaiste Verknüpfung", "DQ-ORPHANLINK"],
    ["Verwaiste Epic-Verknüpfung", "DQ-ORPHANEPIC"],
    ["Kein Label-Themengebiet zugeordnet", "DQ-NOLABEL"],
    ["Kein Benutzerhandbuch-Kapitel zugeordnet", "DQ-NOOUTLINE"],
    ["Tickettyp ohne Punkte-Konfiguration", "DQ-NOPOINTS"]
  ];
  for (const [title, targetKey] of expectations) {
    const row = expandAndGetText(title);
    await wait(20);
    const tbodyText = doc.getElementById("dq-tbody").textContent;
    check("Prüfpunkt '" + title + "' nennt sein Ziel-Ticket " + targetKey, !!row && tbodyText.includes(targetKey));
  }
  check("Sauberes Referenz-Ticket DQ-CLEAN taucht bei KEINEM Prüfpunkt auf (kein Fehlalarm)", !doc.getElementById("dq-tbody").textContent.includes("DQ-CLEAN"));

  // ===================== Auf-/Zuklappen: nur die aufgeklappte Zeile zeigt Testfall-Zeilen =====================
  // Der Loop oben hat inzwischen alle 12 Zeilen aufgeklappt - erst alle
  // wieder einklappen. Jeder Klick ersetzt via renderDataQuality() das
  // komplette tbody-innerHTML, vorher abgefragte Button-Referenzen werden
  // dadurch vom Dokument getrennt (gleiches Muster wie beim Ticket-Graph-
  // Mehrfachauswahl-Test) - daher vor JEDEM Klick frisch abfragen statt
  // eine vorab gesammelte Liste abzuarbeiten.
  let collapseGuard = 0;
  while (doc.querySelector('.dq-group-toggle[aria-expanded="true"]') && collapseGuard < 20) {
    fire(doc.querySelector('.dq-group-toggle[aria-expanded="true"]'), "click");
    await wait(20);
    collapseGuard++;
  }
  check("Alle Zeilen wieder eingeklappt", doc.querySelectorAll(".dq-item-row:not([hidden])").length === 0);
  const summaryRow = Array.from(doc.querySelectorAll(".dq-group-row")).find((r) => r.textContent.includes("Fehlende Zusammenfassung"));
  fire(summaryRow.querySelector(".dq-group-toggle"), "click");
  await wait(50);
  const visibleRows = Array.from(doc.querySelectorAll(".dq-item-row:not([hidden])"));
  check("Nur 1 Testfall-Zeile sichtbar (nur dieser eine Prüfpunkt aufgeklappt)", visibleRows.length === 1);
  check("Sichtbare Zeile nennt DQ-NOSUMMARY", visibleRows[0].textContent.includes("DQ-NOSUMMARY"));

  // ===================== "Im Dashboard anzeigen" springt zum Ticket =====================
  const jumpBtn = doc.getElementById("dq-tbody").querySelector('[data-dq-jump="DQ-NOSUMMARY"]');
  check("'Im Dashboard anzeigen'-Button für DQ-NOSUMMARY vorhanden", !!jumpBtn);
  fire(jumpBtn, "click");
  await wait(200);
  check("Klick springt zum Dashboard", doc.querySelector('[data-view-panel="dashboard"]').hidden === false);
  check("Suchfeld ist mit dem Ticket-Schlüssel befüllt", doc.getElementById("search-input").value === "DQ-NOSUMMARY");
  check("Dashboard-Tabelle zeigt DQ-NOSUMMARY", doc.getElementById("table-body").textContent.includes("DQ-NOSUMMARY"));

  // ===================== Leerer Zustand: keine Tickets geladen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="dataquality"]').click();
  await wait(150);
  check("Ohne Tickets: Leer-Zustand sichtbar (kein Absturz)", doc.getElementById("dq-empty-state").hidden === false);
  check("Ohne Tickets: 0 geprüft", doc.getElementById("dq-tickets-total").textContent === "0");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DATENQUALITÄT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
