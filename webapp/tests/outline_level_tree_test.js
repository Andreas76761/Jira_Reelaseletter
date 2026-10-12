// Einstellungen: (1) Unter-Tabs ("Sitzung & Verwaltung"/"Stammdaten"/
// "Gliederung & Steuerung"/"Rollen-Navigation"/"KI-Texterzeugung"/
// "Dokumentation") gliedern die bisher sehr lange, flache Einstellungen-
// Ansicht neu, ohne die bestehenden Bereiche inhaltlich zu veraendern.
// (2) Neuer, rein lesbarer "Gliederungs-Baum (Ebene 0-4)" zeigt die ECHTE
// Ebenen-Verschachtelung aus einem Excel-Matrix-Upload (anders als die
// bestehende Kapitelliste, die Ebene 2+3 zu einer flachen Unterkapitel-
// Liste zusammenfasst) zum Ausklappen; "Ebene 0" sind die Kapitel-
// Übergänge aus dem Arbeitsblatt "Uebergaenge". Diese Baumansicht
// erscheint NUR in Einstellungen, nicht bei Verarbeitung/Massenverarbeitung/
// Benutzerhandbuch/Releaseletter (dort bleibt die flache Kapitelauswahl).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const XLSX = require("xlsx");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = { use: function () { return Promise.resolve(null); } };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

// 2 Kapitel: Kapitel 1 mit einem 2 Ebenen tiefen Zweig (1.1 -> 1.1.1),
// Kapitel 2 mit nur einem flachen Unterkapitel (2.1, keine Ebene 3) - prueft
// beide Faelle (verschachtelt vs. Blatt ohne Kinder). Dazu ein "Uebergaenge"-
// Arbeitsblatt fuer die "Ebene 0"-Zeile im Baum.
function buildMatrixXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  const matrixAoa = [
    ["Kapitel", "Thema", "Ebene"],
    ["1", "Einführung und Überblick", 1],
    ["1.1", "Ziele und Nutzen", 2],
    ["1.1.1", "Fachlicher Zweck", 3],
    ["2", "Zugang und Rollen", 1],
    ["2.1", "Login und SSO", 2],
  ];
  const uebergaengeAoa = [
    ["ID", "Text", "Fehlende Nachweise"],
    ["T1-2", "Text ueber den Bezug 1/2.", "1 ↔ 2 | Fehlende Nachweise: Testnachweis"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa), "Matrix");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(uebergaengeAoa), "Uebergaenge");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Einstellungen Unter-Tabs =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  check("Tab-Leiste 'einstellungen-tabs' vorhanden", !!doc.getElementById("einstellungen-tabs"));
  check("Standard-Tab 'Sitzung & Verwaltung' aktiv", doc.querySelector('#einstellungen-tabs .import-tab[data-esub="verwaltung"]').classList.contains("active"));
  check("'Sitzung speichern/laden' initial sichtbar (verwaltung-Tab aktiv)", !doc.getElementById("session-export-btn").closest("[data-esub-panel]").hidden);
  check("'Punkte-System' initial ausgeblendet (stammdaten-Tab nicht aktiv)", doc.getElementById("points-table").closest("[data-esub-panel]").hidden);

  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="gliederung"]'), "click");
  await wait(30);
  check("Nach Klick auf 'Gliederung & Steuerung': Tab aktiv", doc.querySelector('#einstellungen-tabs .import-tab[data-esub="gliederung"]').classList.contains("active"));
  check("Nach Klick: 'Sitzung speichern/laden' jetzt ausgeblendet", doc.getElementById("session-export-btn").closest("[data-esub-panel]").hidden);
  check("Nach Klick: 'Benutzerhandbuch-Gliederung' jetzt sichtbar", !doc.getElementById("outline-tbody").closest("[data-esub-panel]").hidden);
  check("Nach Klick: 'Steuerung & KPI' ebenfalls sichtbar (gleiche Gruppe)", !doc.getElementById("outline-steuerung-tbody").closest("[data-esub-panel]").hidden);
  check("Neuer Bereich 'Gliederungs-Baum' vorhanden und sichtbar", !!doc.getElementById("outline-level-tree-list") && !doc.getElementById("outline-level-tree-list").closest("[data-esub-panel]").hidden);

  // ===================== Baum vor Matrix-Upload (Ausgangsgliederung) =====================
  const treeListBefore = doc.getElementById("outline-level-tree-list");
  check("Baum zeigt vor Upload die Ausgangs-Kapitel als einfache Einträge (kein <details>, da kein levelTree)",
    treeListBefore.textContent.includes("Kapitel 1: Einführung und Überblick") && !treeListBefore.querySelector("details"));

  // ===================== Matrix mit Ebene 1/2/3 + Uebergaenge hochladen =====================
  const buf = buildMatrixXlsxBuffer();
  const input = doc.getElementById("outline-matrix-upload-input");
  Object.defineProperty(input, "files", { value: [new win.File([buf], "leveltree_test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(input, "change");
  await confirmViaModal(doc);

  check("Gliederung ersetzt: genau 2 Kapitel", doc.querySelectorAll(".outline-chapter-row").length === 2);

  // ===================== Baum nach Upload =====================
  const treeList = doc.getElementById("outline-level-tree-list");
  const detailsEls = Array.from(treeList.querySelectorAll("details"));
  check("Baum enthält jetzt <details>-Elemente (echte Verschachtelung)", detailsEls.length > 0);

  function summaryTextOf(details) {
    const s = details.querySelector("summary");
    return s ? s.textContent : "";
  }
  const chapter1Details = detailsEls.find((d) => summaryTextOf(d).includes("Kapitel 1: Einführung und Überblick"));
  check("Kapitel 1 als ausklappbarer Knoten vorhanden", !!chapter1Details);
  const sub11Details = chapter1Details && Array.from(chapter1Details.querySelectorAll("details")).find((d) => summaryTextOf(d).includes("1.1 Ziele und Nutzen"));
  check("1.1 (Ebene 2) unter Kapitel 1 als eigener ausklappbarer Knoten vorhanden", !!sub11Details);
  check("1.1.1 (Ebene 3) als Kind-Element von 1.1 vorhanden (echte Verschachtelung, nicht flach)",
    !!sub11Details && sub11Details.textContent.includes("1.1.1 Fachlicher Zweck"));
  check("1.1.1 ist selbst ein Blatt ohne <details> (keine Ebene 4 vorhanden)",
    !!sub11Details && !Array.from(sub11Details.querySelectorAll("details")).some((d) => summaryTextOf(d).includes("1.1.1")));

  const chapter2Details = detailsEls.find((d) => summaryTextOf(d).includes("Kapitel 2: Zugang und Rollen"));
  check("Kapitel 2 als ausklappbarer Knoten vorhanden", !!chapter2Details);
  check("2.1 (Ebene 2, ohne Kinder) als einfacher Eintrag unter Kapitel 2 vorhanden (kein <details> für 2.1 selbst)",
    !!chapter2Details && chapter2Details.textContent.includes("2.1 Login und SSO") &&
    !Array.from(chapter2Details.querySelectorAll("details")).some((d) => summaryTextOf(d).includes("2.1")));

  const ebene0Details = detailsEls.find((d) => summaryTextOf(d).includes("Ebene 0"));
  check("'Ebene 0 – Kapitel-Übergänge'-Knoten vorhanden (aus Arbeitsblatt Uebergaenge)", !!ebene0Details);
  check("Ebene-0-Knoten listet die Übergangs-ID 'T1-2'", !!ebene0Details && ebene0Details.textContent.includes("T1-2"));

  // ===================== Baum bleibt bei 'Alle Daten löschen' erhalten =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  const treeAfterDelete = doc.getElementById("outline-level-tree-list");
  check("Baum bleibt nach 'Alle Daten löschen' erhalten (Konfiguration, kein Sitzungsdatensatz)",
    treeAfterDelete.querySelectorAll("details").length > 0 && treeAfterDelete.textContent.includes("Kapitel 1: Einführung und Überblick"));

  // ===================== Flache Kapitelauswahl bleibt unveraendert (Massenverarbeitung) =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("Kein eigener Baum/Ausklapp-Element in Massenverarbeitung (weiterhin nur flache Kapitel-Auswahl)",
    !doc.querySelector("#mass-groups details"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE EINSTELLUNGEN-UNTERTABS-/GLIEDERUNGS-BAUM-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
