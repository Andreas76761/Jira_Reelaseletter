// Neuer Nav-Punkt "Trend": Burndown-Chart (erstellt/gelöst/offen kumulativ
// über die Zeit) + Domain-Trend-Chart (neu erstellte Tickets je Domäne über
// die Zeit), als handgebautes SVG gerendert. Rein deterministisch aus den
// Feldern created/resolved/Domain berechnet.
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

// Feste, deterministische Daten ueber mehrere Wochen (Mo, KW-Anfang) hinweg -
// erlaubt exakte Vorhersagen fuer kumulierte Werte statt nur "irgendein SVG".
// Alle Zeiten im Jira-Datumsformat "DD/Mon/YY HH:MM" (von parseJiraDate erkannt).
function ticketXml(opts) {
  return `<item><key>${opts.key}</key><summary>${opts.summary || opts.key}</summary>` +
    `<status>${opts.status}</status><type>Task</type>` +
    `<created>${opts.created}</created>` + (opts.resolved ? `<resolved>${opts.resolved}</resolved>` : "") +
    `<customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>${opts.domain}</customfieldvalue></customfieldvalues></customfield></customfields>` +
    `</item>`;
}
const xml = `<?xml version="1.0"?><rss><channel>
  ${ticketXml({ key: "TREND-1", status: "Fertig", domain: "Alpha", created: "01/Jun/26 09:00", resolved: "08/Jun/26 09:00" })}
  ${ticketXml({ key: "TREND-2", status: "Offen", domain: "Alpha", created: "03/Jun/26 09:00" })}
  ${ticketXml({ key: "TREND-3", status: "Offen", domain: "Beta", created: "15/Jun/26 09:00" })}
  ${ticketXml({ key: "TREND-4", status: "Fertig", domain: "Beta", created: "16/Jun/26 09:00", resolved: "20/Jun/26 09:00" })}
  ${ticketXml({ key: "TREND-5", status: "Offen", domain: "Alpha", created: "17/Jun/26 09:00" })}
  ${ticketXml({ key: "TREND-NODATE", status: "Offen", domain: "Alpha" })}
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Erst alle (663) Demo-Tickets loeschen - der Test braucht exakt die
  // 6 unten definierten Tickets fuer vorhersagbare kumulierte Werte.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "trend.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Navigation zeigt "Trend" direkt nach "Ticket Graph" =====================
  const navLabels = Array.from(doc.querySelectorAll(".nav-item")).map((b) => b.textContent.trim());
  const graphIdx = navLabels.indexOf("Ticket Graph");
  check("Nav-Eintrag 'Trend' vorhanden, direkt nach 'Ticket Graph'", navLabels[graphIdx + 1] === "Trend");

  doc.querySelector('.nav-item[data-view="trend"]').click();
  await wait(150);
  check("Trend-Panel nach Klick sichtbar", doc.querySelector('[data-view-panel="trend"]').hidden === false);

  // ===================== Grunddaten: nur Tickets MIT Erstellungsdatum fliessen ein =====================
  check("Hinweistext nennt 5 Tickets mit Erstellungsdatum (TREND-NODATE ausgeschlossen)", doc.getElementById("trend-range-note").textContent.includes("5 Ticket"));
  check("Leer-Zustand versteckt (Daten vorhanden)", doc.getElementById("trend-empty-state").hidden === true);
  check("Burndown-Bereich sichtbar", doc.getElementById("trend-burndown-section").hidden === false);
  check("Domain-Trend-Bereich sichtbar", doc.getElementById("trend-domain-section").hidden === false);

  // ===================== Burndown: SVG vorhanden, Legende zeigt alle 3 Linien =====================
  const burndownSvg = doc.getElementById("trend-burndown-container").innerHTML;
  check("Burndown-SVG wird gerendert", burndownSvg.includes("<svg"));
  const burndownLegend = doc.getElementById("trend-burndown-legend").textContent;
  check("Burndown-Legende nennt 'Erstellt (kumulativ)'", burndownLegend.includes("Erstellt (kumulativ)"));
  check("Burndown-Legende nennt 'Gelöst (kumulativ)'", burndownLegend.includes("Gelöst (kumulativ)"));
  check("Burndown-Legende nennt 'Offen'", burndownLegend.includes("Offen"));
  // Am aktuellen Datum: 5 erstellt gesamt, 2 geloest (TREND-1, TREND-4) -> 3 offen.
  check("Burndown-Legende zeigt 'Aktuell offen: 3'", burndownLegend.includes("Aktuell offen: 3"));

  // ===================== Domain-Trend: Top-Domaenen automatisch ausgewaehlt (kein manueller Filter) =====================
  const domainTrendSvg1 = doc.getElementById("trend-domain-container").innerHTML;
  check("Domain-Trend-SVG wird gerendert (ohne Auswahl = Top-Domänen)", domainTrendSvg1.includes("<svg"));
  const domainLegend1 = doc.getElementById("trend-domain-legend").textContent;
  check("Domain-Trend-Legende nennt 'Alpha'", domainLegend1.includes("Alpha"));
  check("Domain-Trend-Legende nennt 'Beta'", domainLegend1.includes("Beta"));

  // ===================== Domain-Filter: Auswahl auf nur 'Beta' grenzt die Legende ein =====================
  const domainSelect = doc.getElementById("trend-domain-select");
  check("Domain-Auswahl listet 'Alpha' und 'Beta'", Array.from(domainSelect.options).map((o) => o.value).sort().join(",") === "Alpha,Beta");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Beta"; });
  fire(domainSelect, "change");
  await wait(100);
  const domainLegend2 = doc.getElementById("trend-domain-legend").textContent;
  check("Nach Filter auf 'Beta': Legende nennt NICHT mehr 'Alpha'", !domainLegend2.includes("Alpha"));
  check("Nach Filter auf 'Beta': Legende nennt weiterhin 'Beta'", domainLegend2.includes("Beta"));

  // ===================== "Alle auswählen"/"Auswahl aufheben" (generischer data-select-all/-clear-Mechanismus) =====================
  const selectAllBtn = doc.querySelector('[data-select-all="trend-domain-select"]');
  const selectClearBtn = doc.querySelector('[data-select-clear="trend-domain-select"]');
  check("'Alle auswählen'-Button für Domäne vorhanden", !!selectAllBtn);
  check("'Auswahl aufheben'-Button für Domäne vorhanden", !!selectClearBtn);
  fire(selectClearBtn, "click");
  await wait(100);
  check("Nach 'Auswahl aufheben': wieder Top-Domänen (Alpha erneut in Legende)", doc.getElementById("trend-domain-legend").textContent.includes("Alpha"));

  // ===================== Zeitraster umschalten (Woche -> Monat) =====================
  const granularitySelect = doc.getElementById("trend-granularity-select");
  granularitySelect.value = "month";
  fire(granularitySelect, "change");
  await wait(100);
  check("Nach Umschalten auf 'Monat': Hinweistext nennt 'Monat'", doc.getElementById("trend-range-note").textContent.includes("Monat"));
  check("Burndown-SVG weiterhin gerendert (Monat)", doc.getElementById("trend-burndown-container").innerHTML.includes("<svg"));
  granularitySelect.value = "week";
  fire(granularitySelect, "change");
  await wait(100);

  // ===================== Bild-Export-Buttons vorhanden und ausloesbar (kein Absturz) =====================
  const burndownExportBtn = doc.getElementById("trend-burndown-export-btn");
  const domainExportBtn = doc.getElementById("trend-domain-export-btn");
  check("Burndown-Bild-Export-Button vorhanden", !!burndownExportBtn);
  check("Domain-Trend-Bild-Export-Button vorhanden", !!domainExportBtn);
  const errCountBefore = errors.length;
  fire(burndownExportBtn, "click");
  fire(domainExportBtn, "click");
  await wait(300);
  check("Klick auf Bild-Export-Buttons löst keinen unbehandelten JS-Fehler aus", errors.length === errCountBefore);

  // ===================== Leerer Zustand: ohne Tickets mit Erstellungsdatum =====================
  // "Zurücksetzen" im Import-Bereich würde wieder die 663 Demo-Tickets laden
  // (resetSession()) - hier wird bewusst "Alle Daten löschen" (Einstellungen,
  // deleteAllData()) verwendet, um wirklich bei 0 Tickets zu starten.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  const xmlNoDate = `<?xml version="1.0"?><rss><channel><item><key>NODATE-1</key><summary>Ohne Datum</summary><status>Offen</status><type>Task</type></item></channel></rss>`;
  Object.defineProperty(input, "files", { value: [new win.File([xmlNoDate], "nodate.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="trend"]').click();
  await wait(150);
  check("Ohne Tickets mit Erstellungsdatum: Leer-Zustand sichtbar (kein Absturz)", doc.getElementById("trend-empty-state").hidden === false);
  check("Ohne Tickets mit Erstellungsdatum: Burndown-Bereich versteckt", doc.getElementById("trend-burndown-section").hidden === true);
  check("Ohne Tickets mit Erstellungsdatum: Domain-Trend-Bereich versteckt", doc.getElementById("trend-domain-section").hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TREND-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
