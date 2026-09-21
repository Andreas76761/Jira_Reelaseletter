// Prototyp/Test der Merge- und Diff-Logik für Mehrfach-Import,
// bevor sie in die App übernommen wird.

function diffTicket(oldT, newT) {
  var trackedFields = [
    { key: "status", label: "Status" },
    { key: "created", label: "Erstellt" },
    { key: "updated", label: "Aktualisiert" },
    { key: "summary", label: "Zusammenfassung" },
  ];
  var diffs = [];
  trackedFields.forEach(function (f) {
    var a = oldT[f.key] || "", b = newT[f.key] || "";
    if (a !== b) diffs.push({ field: f.key, label: f.label, from: a, to: b });
  });
  var oldDomain = (oldT.custom_fields && oldT.custom_fields.Domain) || "";
  var newDomain = (newT.custom_fields && newT.custom_fields.Domain) || "";
  if (oldDomain !== newDomain) diffs.push({ field: "domain", label: "Domain", from: oldDomain, to: newDomain });
  return diffs;
}

function makeApp() {
  return { imports: [], ticketStore: new Map(), changes: [], log: [] };
}

function ingest(app, cleanedTickets, meta, personCount) {
  var importId = app.imports.length + 1;
  app.imports.push({ id: importId, source: meta.source, when: meta.when, ticketCount: cleanedTickets.length, personCount: personCount || 0 });
  var stats = { neu: 0, geaendert: 0, unveraendert: 0 };
  cleanedTickets.forEach(function (t) {
    var existing = app.ticketStore.get(t.key);
    if (!existing) {
      app.ticketStore.set(t.key, { current: t, sources: [{ importId: importId, source: meta.source, when: meta.when }] });
      stats.neu++;
    } else {
      var diffs = diffTicket(existing.current, t);
      var prevSource = existing.sources[existing.sources.length - 1];
      existing.sources.push({ importId: importId, source: meta.source, when: meta.when });
      if (diffs.length) {
        app.changes.push({ key: t.key, from: { source: prevSource.source, when: prevSource.when, snapshot: existing.current }, to: { source: meta.source, when: meta.when, snapshot: t }, diffs: diffs });
        stats.geaendert++;
      } else {
        stats.unveraendert++;
      }
      existing.current = t;
    }
  });
  app.log.push({ when: meta.when, message: "Import '" + meta.source + "': " + cleanedTickets.length + " Tickets (" + stats.neu + " neu, " + stats.geaendert + " geändert, " + stats.unveraendert + " unverändert)" });
  return stats;
}

// --- Testszenario ---
var app = makeApp();

// Import 1: 3 Tickets
var import1 = [
  { key: "ONESCM-1", status: "Offen", created: "01/Jan/24", updated: "01/Jan/24", summary: "Login-Fehler" },
  { key: "ONESCM-2", status: "Offen", created: "02/Jan/24", updated: "02/Jan/24", summary: "Export defekt", custom_fields: { Domain: "Reporting" } },
  { key: "ONESCM-3", status: "Fertig", created: "03/Jan/24", updated: "03/Jan/24", summary: "" },
];
var s1 = ingest(app, import1, { source: "export1.xml", when: "01.01.2026" }, 0);
console.log("Import 1:", s1);

// Import 2: ONESCM-1 Status geändert (Offen -> In Bearbeitung), ONESCM-2 unverändert,
// ONESCM-4 neu, ONESCM-3 Domain geändert
var import2 = [
  { key: "ONESCM-1", status: "In Bearbeitung", created: "01/Jan/24", updated: "05/Jan/24", summary: "Login-Fehler" },
  { key: "ONESCM-2", status: "Offen", created: "02/Jan/24", updated: "02/Jan/24", summary: "Export defekt", custom_fields: { Domain: "Reporting" } },
  { key: "ONESCM-3", status: "Fertig", created: "03/Jan/24", updated: "03/Jan/24", summary: "", custom_fields: { Domain: "Archiving" } },
  { key: "ONESCM-4", status: "Offen", created: "06/Jan/24", updated: "06/Jan/24", summary: "Neues Ticket" },
];
var s2 = ingest(app, import2, { source: "export2.xml", when: "10.01.2026" }, 0);
console.log("Import 2:", s2);

console.log("\nGesamtzahl Tickets im Store:", app.ticketStore.size);
console.log("Anzahl erkannter Änderungen:", app.changes.length);
app.changes.forEach(function (c) {
  console.log("  " + c.key + ": " + c.diffs.map(function (d) { return d.label + " '" + d.from + "' -> '" + d.to + "'"; }).join(", ") +
    " (Quelle " + c.from.source + " -> " + c.to.source + ")");
});
console.log("\nLog:");
app.log.forEach(function (l) { console.log("  [" + l.when + "] " + l.message); });

// --- Prüfungen ---
var checks = [
  ["4 Tickets im Store (1,2,3,4)", app.ticketStore.size === 4],
  ["2 Änderungen erkannt (ONESCM-1 Status, ONESCM-3 Domain)", app.changes.length === 2],
  ["ONESCM-1 Änderung enthält Status+Aktualisiert", app.changes[0].key === "ONESCM-1" && app.changes[0].diffs.some(function (d) { return d.field === "status"; })],
  ["ONESCM-3 Änderung enthält Domain", app.changes[1].key === "ONESCM-3" && app.changes[1].diffs.some(function (d) { return d.field === "domain"; })],
  ["ONESCM-2 NICHT in Änderungen (identisch)", !app.changes.some(function (c) { return c.key === "ONESCM-2"; })],
  ["ONESCM-1 aktueller Stand = 'In Bearbeitung'", app.ticketStore.get("ONESCM-1").current.status === "In Bearbeitung"],
  ["ONESCM-4 ist neu, kein Diff-Eintrag", !app.changes.some(function (c) { return c.key === "ONESCM-4"; })],
  ["2 Imports im Log", app.imports.length === 2],
];
var failed = false;
checks.forEach(function (c) { console.log((c[1] ? "OK  " : "FAIL") + " - " + c[0]); if (!c[1]) failed = true; });
if (failed) { console.error("\nMERGE/DIFF-TEST FEHLGESCHLAGEN"); process.exit(1); }
console.log("\nALLE MERGE/DIFF-TESTS BESTANDEN");
