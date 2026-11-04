// v2.122.0 Register "Mitteilungen": Uebersicht aller internen Mitteilungen (FINAL-Staende + Register),
// Filter (Ort, Kategorie, Faelligkeit, Suche), Sortierung faellig zuerst, "Geprueft – unveraendert"
// (einzeln + alle faelligen), Oeffnen am Ort, Nav-Badge, interne Excel-/Markdown-Liste.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
async function blobText(d) { return typeof d === "string" ? d : Buffer.from(await d.arrayBuffer()).toString("utf-8"); }
const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
function note(id, category, title, text, intervalDays, daysAgo) {
  return { id, category, title, text, intervalDays, createdAt: iso(daysAgo + 5), updatedAt: iso(daysAgo), updatedBy: "Anna", history: [{ at: iso(daysAgo + 5), by: "Anna", kind: "angelegt" }] };
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const rows = () => Array.from(doc.querySelectorAll("#notes-ov-tbody tr"));
  const setSel = (id, v) => { const el = doc.getElementById(id); el.value = v; fire(el, "change"); };

  const navItems = Array.from(doc.querySelectorAll(".nav-item")).map((b) => b.getAttribute("data-view"));
  check("Nav: FINAL → VARIANTE → Mitteilungen", navItems.indexOf("variante") === navItems.indexOf("final") + 1 && navItems.indexOf("mitteilungen") === navItems.indexOf("variante") + 1);
  nav("mitteilungen");
  check("Leere Übersicht: Hinweis sichtbar, Exporte deaktiviert", !doc.getElementById("notes-ov-empty").hidden && doc.getElementById("notes-ov-xlsx-btn").disabled && doc.getElementById("notes-ov-summary").textContent.startsWith("0 interne"));

  // Sitzung mit FINAL-Stand + Register-Mitteilungen laden
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  session.final = session.final || {};
  session.final.versions = [{ id: 1, name: "Handbuch DE 2026.4", status: "Entwurf", createdAt: iso(20), chapters: [{ title: "Kapitel 1", text: "Text" }],
    notes: [note(1, "Version Screen", "Screens 4.3", "Screens mit Version 4.3 aufgenommen.", 30, 40), note(2, "Ideenspeicher", "Glossar", "Glossar im Anhang.", 0, 3)] }];
  session.docNotes = { releaseletter: [note(3, "Neue Features", "Massenänderung", "Massenänderung kommt mit 2026.5.", 7, 10), note(4, "Ideenspeicher", "Video", "Kurzvideo zum Release.", 30, 2)],
    benutzerhandbuch: [note(5, "Offene Punkte", "Rollen prüfen", "Rollenbeschreibung Disponent prüfen.", 14, 1)], prozessbild: [], clickanweisung: [] };
  const si = doc.getElementById("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(session)], "s.json")], configurable: true });
  fire(si, "change");
  await wait(80);
  if (!doc.getElementById("confirm-modal-overlay").hidden) fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(400);

  const badge = doc.getElementById("nav-badge-notes");
  check("Nav-Badge zeigt 2 fällige Mitteilungen", !badge.hidden && badge.textContent === "2");
  nav("mitteilungen");
  check("Übersicht: 5 Mitteilungen, Zusammenfassung '5 … davon 2 fällig'", rows().length === 5 && doc.getElementById("notes-ov-summary").textContent.startsWith("5 interne Mitteilung(en) insgesamt, davon 2 fällig"));
  check("Sortierung: fällige zuerst (älteste Fälligkeit oben), 'ohne Intervall' zuletzt",
    rows()[0].textContent.includes("Screens 4.3") && rows()[1].textContent.includes("Massenänderung") && rows()[4].textContent.includes("Glossar") && rows()[4].textContent.includes("ohne Intervall"));
  check("Fällige Zeilen hervorgehoben mit 'fällig seit' und Ort", rows()[0].classList.contains("notes-ov-overdue") && rows()[0].textContent.includes("fällig seit") && rows()[0].textContent.includes("FINAL – Handbuch DE 2026.4") && rows()[1].textContent.includes("Releaseletter"));
  check("Nicht fällige Zeile: 'fällig am', kein Prüfen-Button", !rows()[2].classList.contains("notes-ov-overdue") && rows()[2].textContent.includes("fällig am") && !rows()[2].querySelector("[data-notes-ov-confirm]"));

  // Filter
  const whereOpts = Array.from(doc.getElementById("notes-ov-where").options).map((o) => o.textContent);
  check("Ort-Filter listet FINAL-Stand und Register", whereOpts.includes("FINAL – Handbuch DE 2026.4") && whereOpts.includes("Releaseletter") && whereOpts.includes("Benutzerhandbuch") && !whereOpts.includes("Prozessbild"));
  setSel("notes-ov-where", "releaseletter");
  check("Filter Ort=Releaseletter → 2 Zeilen, Zusammenfassung '2 angezeigt'", rows().length === 2 && doc.getElementById("notes-ov-summary").textContent.includes("2 angezeigt"));
  setSel("notes-ov-where", "");
  setSel("notes-ov-category", "Ideenspeicher");
  check("Filter Kategorie=Ideenspeicher → 2 Zeilen", rows().length === 2 && rows().every((r) => r.textContent.includes("Ideenspeicher")));
  setSel("notes-ov-category", "");
  setSel("notes-ov-due", "overdue");
  check("Filter Fälligkeit=fällig → 2 Zeilen", rows().length === 2);
  setSel("notes-ov-due", "none");
  check("Filter Fälligkeit=ohne Intervall → 1 Zeile (Glossar)", rows().length === 1 && rows()[0].textContent.includes("Glossar"));
  setSel("notes-ov-due", "");
  const q = doc.getElementById("notes-ov-search"); q.value = "disponent"; fire(q, "input");
  check("Volltextsuche (Inhalt, ohne Groß-/Kleinschreibung) → 1 Zeile", rows().length === 1 && rows()[0].textContent.includes("Rollen prüfen"));
  q.value = ""; fire(q, "input");

  // Exporte (intern)
  savedFiles.length = 0;
  fire(doc.getElementById("notes-ov-xlsx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const xz = savedFiles[0] ? await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer())) : null;
  const sheet = xz ? await xz.file("xl/worksheets/sheet1.xml").async("string") : "";
  const wb = xz ? await xz.file("xl/workbook.xml").async("string") : "";
  check("Excel-Liste: Dateiname, Blatt 'Interne Mitteilungen', alle 5 Mitteilungen mit Ort/Fälligkeit",
    savedFiles[0] && /^Interne_Mitteilungen_\d{4}-\d{2}-\d{2}\.xlsx$/.test(savedFiles[0].filename) && wb.includes("Interne Mitteilungen") &&
    ["Screens 4.3", "Massenänderung", "Video", "Rollen prüfen", "Glossar", "FINAL – Handbuch DE 2026.4", "fällig seit", "ohne Intervall"].every((t) => sheet.includes(t)));
  setSel("notes-ov-where", "benutzerhandbuch");
  savedFiles.length = 0;
  fire(doc.getElementById("notes-ov-md-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = savedFiles[0] ? await blobText(savedFiles[0].data) : "";
  check("Markdown-Liste exportiert nur die gefilterten Mitteilungen, gruppiert nach Ort, als intern markiert",
    md.startsWith("# Interne Mitteilungen") && md.includes("Nur für den internen Gebrauch") && md.includes("## Benutzerhandbuch") && md.includes("### Rollen prüfen") && !md.includes("Massenänderung"));
  setSel("notes-ov-where", "");

  // Geprueft – unveraendert (einzeln)
  fire(rows()[1].querySelector("[data-notes-ov-confirm]"), "click");
  check("Einzeln geprüft: Massenänderung nicht mehr fällig, Badge 1", !rows().some((r) => r.classList.contains("notes-ov-overdue") && r.textContent.includes("Massenänderung")) && badge.textContent === "1");
  nav("releaseletter");
  const rlCard = Array.from(doc.querySelectorAll('[data-doc-notes-host="releaseletter"] [data-note-id]')).find((c) => c.querySelector('[data-note-field="title"]').value === "Massenänderung");
  fire(rlCard.querySelector("[data-note-history]"), "click");
  const rlCard2 = Array.from(doc.querySelectorAll('[data-doc-notes-host="releaseletter"] [data-note-id]')).find((c) => c.querySelector('[data-note-field="title"]').value === "Massenänderung");
  check("Register Releaseletter: Verlauf enthält 'geprüft'", rlCard2.querySelector(".final-note-history").textContent.includes("geprüft"));

  // Oeffnen springt in FINAL zum Stand
  nav("mitteilungen");
  fire(rows()[0].querySelector("[data-notes-ov-open]"), "click");
  check("'Öffnen' springt nach FINAL und öffnet die Mitteilungen des Stands", !doc.querySelector('[data-view-panel="final"]').hidden && !doc.getElementById("final-notes-panel").hidden && doc.getElementById("final-notes-title").textContent.includes("Handbuch DE 2026.4"));

  // Alle faelligen bestaetigen
  nav("mitteilungen");
  fire(doc.getElementById("notes-ov-confirm-due-btn"), "click");
  await wait(40);
  check("Bestätigungsdialog für Sammel-Prüfung", !doc.getElementById("confirm-modal-overlay").hidden);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
  check("Nach Sammel-Prüfung: nichts mehr fällig, Badge ausgeblendet, Button deaktiviert",
    !rows().some((r) => r.classList.contains("notes-ov-overdue")) && badge.hidden && doc.getElementById("notes-ov-confirm-due-btn").disabled);
  nav("dashboard");
  check("Dashboard-Hinweis ebenfalls leer", doc.getElementById("dashboard-notes-due").hidden);

  // Neue Mitteilung im Register erscheint in der Uebersicht
  nav("prozessbild");
  const pb = doc.querySelector('[data-doc-notes-host="prozessbild"]');
  pb.querySelector(".doc-note-new-title").value = "BPMN-Variante";
  pb.querySelector(".doc-note-new-text").value = "Swimlanes je Rolle ergänzen.";
  fire(pb.querySelector("[data-doc-note-add]"), "click");
  nav("mitteilungen");
  check("Neue Prozessbild-Mitteilung erscheint in der Übersicht (6 gesamt)", rows().length === 6 && rows().some((r) => r.textContent.includes("BPMN-Variante") && r.textContent.includes("Prozessbild")));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MITTEILUNGEN-UEBERSICHT-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
