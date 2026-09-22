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

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Einstellungen: Gliederung - Standardbestand =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  const outlineText = () => doc.getElementById("outline-tbody").textContent;
  check("Gliederung enthält 'Kapitel 4: Servicevertrag anlegen'", outlineText().includes("Kapitel 4: Servicevertrag anlegen"));
  check("Gliederung enthält Unterkapitel '4.1 Vertragsarten'", outlineText().includes("4.1 Vertragsarten"));
  check("Gliederung enthält 'Kapitel 16: Glossar, Checklisten, Anhang'", outlineText().includes("Kapitel 16: Glossar, Checklisten, Anhang"));
  check("Gliederung enthält Frontmatter-Eintrag 'Willkommen zu Ihrer oneSCM-Schulung'", outlineText().includes("Willkommen zu Ihrer oneSCM-Schulung"));
  check("Gliederung enthält Backmatter-Eintrag 'Glossar' (eigener Top-Level-Eintrag)", outlineText().includes("Checkliste für den Alltag"));
  // Reihenfolge wie vom Nutzer geliefert (nicht numerisch sortiert): Kapitel 13/14 stehen vor Kapitel 10/11.
  const chapterRowTitles = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).map((r) => r.textContent.trim());
  const idx13 = chapterRowTitles.findIndex((t) => t.startsWith("Kapitel 13:"));
  const idx10 = chapterRowTitles.findIndex((t) => t.startsWith("Kapitel 10:"));
  check("Nicht-sequenzielle Original-Reihenfolge erhalten (Kapitel 13 vor Kapitel 10)", idx13 !== -1 && idx10 !== -1 && idx13 < idx10);

  // ===================== Einstellungen: Gliederung erweitern/löschen =====================
  doc.getElementById("outline-new-chapter-input").value = "Kapitel 17: Ausblick";
  fire(doc.getElementById("outline-add-chapter-btn"), "click");
  check("Neues Kapitel 'Kapitel 17: Ausblick' angelegt", outlineText().includes("Kapitel 17: Ausblick"));

  const newChapterRow = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 17: Ausblick"));
  const chapterId = newChapterRow.querySelector('button[data-action="delete-chapter"]').getAttribute("data-chapter-id");
  const subInput = doc.querySelector('.outline-new-sub-input[data-chapter-id="' + chapterId + '"]');
  subInput.value = "17.1 Roadmap";
  fire(doc.querySelector('button[data-action="add-sub"][data-chapter-id="' + chapterId + '"]'), "click");
  check("Neues Unterkapitel '17.1 Roadmap' angelegt", outlineText().includes("17.1 Roadmap"));

  const subRow = Array.from(doc.querySelectorAll("#outline-tbody .outline-sub-row")).find((r) => r.textContent.includes("17.1 Roadmap"));
  fire(subRow.querySelector('button[data-action="delete-sub"]'), "click");
  check("Unterkapitel nach Löschen wieder entfernt", !outlineText().includes("17.1 Roadmap"));

  fire(doc.querySelector('button[data-action="delete-chapter"][data-chapter-id="' + chapterId + '"]'), "click");
  check("Kapitel nach Löschen wieder entfernt", !outlineText().includes("Kapitel 17: Ausblick"));

  // ===================== Einstellungen: Gliederung - Standard-Domänen-Vorschlag =====================
  // (rational hergeleitet aus den 13 im Demo-Datensatz vorkommenden Domänen + Kapitelthemen, s. outlineSeedData())
  function chapterIdFor(title) {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes(title));
    return row && row.querySelector('button[data-action="delete-chapter"]').getAttribute("data-chapter-id");
  }
  check("Kapitel 4 hat 3 vorgeschlagene Domänen (Contract Generation/Calculation, Vehicle Management)", (() => {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 4: Servicevertrag anlegen"));
    return !!row && row.textContent.includes("(3 Domänen)");
  })());
  check("Kapitel 4 zeigt 'Contract Generation' als zugeordnete Domäne", outlineText().includes("Contract Generation"));
  check("Kapitel 5 hat 2 vorgeschlagene Domänen (Revenue Management, Cost Management)", (() => {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 5: Zahlung, Rechnung und Unterschrift"));
    return !!row && row.textContent.includes("(2 Domänen)");
  })());
  check("Kapitel 9 (Troubleshooting) bewusst OHNE Domänen-Vorschlag (kein erzwungener Fit)", (() => {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 9: Troubleshooting und Support"));
    return !!row && row.textContent.includes("(0 Domänen)");
  })());

  // ===================== Einstellungen: Gliederung - Domänen manuell zuordnen/entfernen (an einem bisher unbesetzten Kapitel) =====================
  const kap9Id = chapterIdFor("Kapitel 9: Troubleshooting und Support");
  doc.querySelector('.outline-new-domain-input[data-chapter-id="' + kap9Id + '"]').value = "ZUW-Kapitel9-Domain";
  fire(doc.querySelector('button[data-action="add-domain"][data-chapter-id="' + kap9Id + '"]'), "click");
  check("Domäne 'ZUW-Kapitel9-Domain' zu Kapitel 9 zugeordnet", outlineText().includes("ZUW-Kapitel9-Domain"));
  check("Kapitel-9-Zeile zeigt Domänen-Zähler '(1 Domäne)'", (() => {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 9: Troubleshooting und Support"));
    return !!row && row.textContent.includes("(1 Domäne)");
  })());

  // Doppelte Zuordnung wird abgelehnt (kein Duplikat in der Liste).
  doc.querySelector('.outline-new-domain-input[data-chapter-id="' + kap9Id + '"]').value = "ZUW-Kapitel9-Domain";
  fire(doc.querySelector('button[data-action="add-domain"][data-chapter-id="' + kap9Id + '"]'), "click");
  check("Doppelte Domänen-Zuordnung wird abgelehnt (weiterhin nur 1x 'ZUW-Kapitel9-Domain')",
    Array.from(doc.querySelectorAll(".outline-domain-row")).filter((r) => r.textContent.includes("ZUW-Kapitel9-Domain")).length === 1);
  check("Weiterhin nur 1 Domäne bei Kapitel 9", (() => {
    const row = Array.from(doc.querySelectorAll("#outline-tbody .outline-chapter-row")).find((r) => r.textContent.includes("Kapitel 9: Troubleshooting und Support"));
    return !!row && row.textContent.includes("(1 Domäne)");
  })());

  // Domäne wieder entfernen und erneut zuordnen (fuer den Rest des Tests gebraucht).
  const kap9DomainRow = Array.from(doc.querySelectorAll(".outline-domain-row")).find((r) => r.textContent.includes("ZUW-Kapitel9-Domain"));
  fire(kap9DomainRow.querySelector('button[data-action="delete-domain"]'), "click");
  check("Domäne 'ZUW-Kapitel9-Domain' nach Löschen wieder entfernt", !outlineText().includes("ZUW-Kapitel9-Domain"));
  doc.querySelector('.outline-new-domain-input[data-chapter-id="' + kap9Id + '"]').value = "ZUW-Kapitel9-Domain";
  fire(doc.querySelector('button[data-action="add-domain"][data-chapter-id="' + kap9Id + '"]'), "click");
  check("Domäne 'ZUW-Kapitel9-Domain' erneut zugeordnet", outlineText().includes("ZUW-Kapitel9-Domain"));

  // ===================== Tickets importieren: 1 Treffer über die Standard-Domäne (Kapitel 4, ohne manuelle Zuordnung),
  // 1 Treffer über die eben manuell zugeordnete Domäne (Kapitel 9), 1 ohne Treffer =====================
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>ZUW-1</key><summary>Neuer Servicevertrag anlegen</summary>
      <description>Es geht um die Vertragsarten und die Fahrzeugverwaltung.</description>
      <status>Offen</status><type>Epic</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>ZUW-2</key><summary>Frage zur Unterschrift</summary>
      <description>Es geht um die Digitale Unterschrift und die IBAN-Prüfung.</description>
      <status>Offen</status><type>Bug</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>ZUW-Kapitel9-Domain</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>ZUW-3</key><summary>Allgemeine Anfrage</summary>
      <description>Kein spezifischer Bezug zu irgendeinem Thema.</description>
      <status>Offen</status><type>Task</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Sonderfall-Ohne-Domain</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "zuordnung.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Dashboard: Jira Zuordnung nach Label-Kategorie (Standard) =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(100);
  const assignmentText = () => doc.getElementById("assignment-tbody").textContent;
  check("Zuordnung (Label) zeigt Kategorie 'Fahrzeuge & Fahrzeugdaten'", assignmentText().includes("Fahrzeuge & Fahrzeugdaten"));
  check("Zuordnung (Label) zeigt Kategorie 'Zahlung & Rechnung'", assignmentText().includes("Zahlung & Rechnung"));
  check("Zuordnung (Label) zeigt 'Ohne Zuordnung' für ZUW-3", (() => {
    const rows = Array.from(doc.querySelectorAll("#assignment-tbody tr"));
    const ohneIdx = rows.findIndex((r) => r.textContent.includes("Ohne Zuordnung"));
    const zuw3Idx = rows.findIndex((r) => r.textContent.includes("ZUW-3"));
    return ohneIdx !== -1 && zuw3Idx > ohneIdx;
  })());
  check("ZUW-1 erscheint unter 'Fahrzeuge & Fahrzeugdaten'", (() => {
    const rows = Array.from(doc.querySelectorAll("#assignment-tbody tr"));
    const catIdx = rows.findIndex((r) => r.textContent.includes("Fahrzeuge & Fahrzeugdaten"));
    const nextGroupIdx = rows.findIndex((r, i) => i > catIdx && r.classList.contains("domain-group-row"));
    const zuw1Idx = rows.findIndex((r) => r.textContent.includes("ZUW-1"));
    return catIdx !== -1 && zuw1Idx > catIdx && (nextGroupIdx === -1 || zuw1Idx < nextGroupIdx);
  })());

  // ===================== Dashboard: Umschalten auf "Nach Gliederung" =====================
  fire(doc.querySelector('#assignment-mode-tabs button[data-assignment-mode="outline"]'), "click");
  await wait(50);
  check("'Nach Gliederung'-Tab aktiv markiert", doc.querySelector('#assignment-mode-tabs button[data-assignment-mode="outline"]').className.includes("active"));
  check("Zuordnung (Gliederung) zeigt 'Kapitel 4: Servicevertrag anlegen'", assignmentText().includes("Kapitel 4: Servicevertrag anlegen"));
  check("Zuordnung (Gliederung) zeigt 'Kapitel 9: Troubleshooting und Support'", assignmentText().includes("Kapitel 9: Troubleshooting und Support"));
  check("ZUW-1 erscheint unter Kapitel 4 (über die Standard-Domäne 'Contract Generation', ohne manuelle Zuordnung)", (() => {
    const rows = Array.from(doc.querySelectorAll("#assignment-tbody tr"));
    const catIdx = rows.findIndex((r) => r.textContent.includes("Kapitel 4: Servicevertrag anlegen"));
    const nextGroupIdx = rows.findIndex((r, i) => i > catIdx && r.classList.contains("domain-group-row"));
    const zuw1Idx = rows.findIndex((r) => r.textContent.includes("ZUW-1"));
    return catIdx !== -1 && zuw1Idx > catIdx && (nextGroupIdx === -1 || zuw1Idx < nextGroupIdx);
  })());
  check("ZUW-2 erscheint unter Kapitel 9 (über die manuell zugeordnete Domäne)", (() => {
    const rows = Array.from(doc.querySelectorAll("#assignment-tbody tr"));
    const catIdx = rows.findIndex((r) => r.textContent.includes("Kapitel 9: Troubleshooting und Support"));
    const nextGroupIdx = rows.findIndex((r, i) => i > catIdx && r.classList.contains("domain-group-row"));
    const zuw2Idx = rows.findIndex((r) => r.textContent.includes("ZUW-2"));
    return catIdx !== -1 && zuw2Idx > catIdx && (nextGroupIdx === -1 || zuw2Idx < nextGroupIdx);
  })());
  check("Auch im Gliederungs-Modus: 'Ohne Zuordnung' für ZUW-3 vorhanden", assignmentText().includes("Ohne Zuordnung"));

  // Zurueck auf Label-Modus fuer den Rest des Tests.
  fire(doc.querySelector('#assignment-mode-tabs button[data-assignment-mode="label"]'), "click");
  await wait(50);

  // ===================== Verarbeitung -> 7. RAG: neue Filter Label-Kategorie/Gliederungskapitel =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(100);

  // Auf den eigenen Import scopen (sonst zaehlen die 663 eingebetteten Demo-Tickets mit,
  // die realistischerweise selbst Fahrzeug-/Zahlungs-Vokabular enthalten).
  fire(doc.querySelector("#steps-job-7 .step-toggle"), "click");
  const zuwImportCheckbox = Array.from(doc.querySelectorAll('#steps-job-7 input[value^="import:"]')).find((cb) => {
    const label = cb.closest("label");
    return label && label.textContent.includes("zuordnung.xml");
  });
  zuwImportCheckbox.checked = true;
  fire(zuwImportCheckbox, "change");
  await wait(50);
  const categoryOptions = Array.from(doc.getElementById("rag-label-category-select").options).map((o) => o.value);
  check("RAG Label-Kategorie-Filter listet 'Fahrzeuge & Fahrzeugdaten'", categoryOptions.includes("Fahrzeuge & Fahrzeugdaten"));
  check("RAG Label-Kategorie-Filter listet 'Zahlung & Rechnung'", categoryOptions.includes("Zahlung & Rechnung"));
  const chapterOptions = Array.from(doc.getElementById("rag-outline-select").options).map((o) => o.value);
  check("RAG Gliederungs-Filter listet 'Kapitel 4: Servicevertrag anlegen'", chapterOptions.includes("Kapitel 4: Servicevertrag anlegen"));
  check("RAG Gliederungs-Filter listet 'Kapitel 9: Troubleshooting und Support'", chapterOptions.includes("Kapitel 9: Troubleshooting und Support"));

  // Nur Label-Kategorie "Fahrzeuge & Fahrzeugdaten" auswaehlen -> nur ZUW-1, kein Mischmasch.
  const categorySelect = doc.getElementById("rag-label-category-select");
  Array.from(categorySelect.options).forEach((o) => { o.selected = o.value === "Fahrzeuge & Fahrzeugdaten"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Extraktion nach Label-Kategorie 'Fahrzeuge & Fahrzeugdaten': genau 1 Ticket", doc.getElementById("rag-extract-count").textContent === "1");
  check("Extraktion enthält ZUW-1", doc.getElementById("rag-extract-tbody").textContent.includes("ZUW-1"));
  check("Extraktion enthält NICHT ZUW-2 (kein Mischmasch über alle Tickets)", !doc.getElementById("rag-extract-tbody").textContent.includes("ZUW-2"));
  Array.from(categorySelect.options).forEach((o) => { o.selected = false; });

  // Nur Gliederungskapitel 9 auswaehlen -> nur ZUW-2.
  const chapterSelect = doc.getElementById("rag-outline-select");
  Array.from(chapterSelect.options).forEach((o) => { o.selected = o.value === "Kapitel 9: Troubleshooting und Support"; });
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Extraktion nach Gliederungskapitel 9: genau 1 Ticket", doc.getElementById("rag-extract-count").textContent === "1");
  check("Extraktion enthält ZUW-2", doc.getElementById("rag-extract-tbody").textContent.includes("ZUW-2"));
  check("Extraktion enthält NICHT ZUW-1 (kein Mischmasch über alle Tickets)", !doc.getElementById("rag-extract-tbody").textContent.includes("ZUW-1"));
  Array.from(chapterSelect.options).forEach((o) => { o.selected = false; });

  // ===================== Gliederung/Labels bleiben nach 'Sitzung zurücksetzen' erhalten (Konfiguration) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  check("Gliederung bleibt nach Sitzung-Reset erhalten", outlineText().includes("Kapitel 4: Servicevertrag anlegen"));
  check("Labels bleiben nach Sitzung-Reset erhalten", doc.getElementById("labels-tbody").textContent.includes("IBAN"));

  // ===================== XSS-Schutz in den neuen Bereichen =====================
  check("Keine ungeschützten Script-Tags in Gliederung/Zuordnung",
    !doc.getElementById("outline-tbody").innerHTML.includes("<script") &&
    !doc.getElementById("assignment-tbody").innerHTML.includes("<script"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE STAMMDATEN-GLIEDERUNG/ZUORDNUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
