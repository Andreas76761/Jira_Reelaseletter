const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });
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

  doc.querySelector('.nav-item[data-view="import"]').click();

  // ===================== Datei-Import MIT Kommentar =====================
  const commentInput = doc.getElementById("import-comment-input");
  check("Kommentarfeld im Import-Bereich vorhanden", !!commentInput);
  commentInput.value = "Sonderlieferung vom Kunden, enthält nur Hotfixes";
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>CMT-1</key><summary>Testticket</summary><status>Offen</status></item>
  </channel></rss>`;
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "hotfix_import.xml", { type: "text/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  check("Kommentarfeld nach erfolgreichem Datei-Import geleert", commentInput.value === "");

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRows = Array.from(doc.querySelectorAll("#imports-tbody tr"));
  const hotfixRow = importRows.find((r) => r.textContent.includes("hotfix_import.xml"));
  check("Import-Zeile für hotfix_import.xml vorhanden", !!hotfixRow);
  check("Header 'Kommentar' in Imports-Tabelle vorhanden", doc.querySelector("#imports-table thead").textContent.includes("Kommentar"));
  if (hotfixRow) {
    check("Kommentar wird in der Imports-Tabelle angezeigt", hotfixRow.textContent.includes("Sonderlieferung vom Kunden"));
  }

  // ===================== Kommentar bei der Auswahl (Verarbeitung, Datei auswählen) =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  const stepToggle = doc.querySelector("#steps-job-4 .step-toggle");
  check("Aufklapp-Pfeil für Datei-Auswahl in Job 4 vorhanden", !!stepToggle);
  if (stepToggle) fire(stepToggle, "click");
  const fileOptionsText = doc.getElementById("steps-job-4").textContent;
  check("Kommentar erscheint in der Datei-Auswahl-Liste (Job 4)", fileOptionsText.includes("Sonderlieferung vom Kunden"));

  // ===================== Zwischenablage-Import MIT Kommentar =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  commentInput.value = "Testimport per Zwischenablage";
  doc.getElementById("paste-textarea").value = "Schlüssel\tStatus\tZusammenfassung\nCMT-2\tOffen\tPer Zwischenablage";
  fire(doc.getElementById("paste-process-btn"), "click");
  await wait(100);
  check("Kommentarfeld nach erfolgreichem Zwischenablage-Import geleert", commentInput.value === "");

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const pasteRow = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("Manuell (Zwischenablage)"));
  check("Kommentar beim Zwischenablage-Import gespeichert", !!pasteRow && pasteRow.textContent.includes("Testimport per Zwischenablage"));

  // ===================== Import OHNE Kommentar zeigt ehrlichen Platzhalter =====================
  const firstImportRow = doc.querySelector("#imports-tbody tr");
  check("Import ohne Kommentar zeigt Platzhalter '– kein Kommentar –'", firstImportRow.textContent.includes("kein Kommentar"));

  // ===================== Nachträglich in Dateiverwaltung ergänzen/bearbeiten =====================
  const editBtn = firstImportRow.querySelector('button[data-action="edit-comment"]');
  check("Bearbeiten/Ergänzen-Button vorhanden", !!editBtn);
  fire(editBtn, "click");
  const editInput = firstImportRow.querySelector(".comment-edit-input") || doc.querySelector(".comment-edit-input");
  check("Eingabefeld erscheint im Bearbeiten-Modus", !!editInput);
  if (editInput) {
    editInput.value = "Nachträglich ergänzter Kommentar";
    const saveBtn = doc.querySelector('button[data-action="save-comment"]');
    fire(saveBtn, "click");
  }
  await wait(20);
  const updatedRow = doc.querySelector("#imports-tbody tr");
  check("Nachträglich ergänzter Kommentar wird gespeichert und angezeigt", updatedRow.textContent.includes("Nachträglich ergänzter Kommentar"));
  check("Log-Eintrag über Kommentar-Änderung erstellt", doc.getElementById("log-list").textContent.includes("Kommentar zu Import"));

  // ===================== Abbrechen verwirft Änderung =====================
  const editBtn2 = updatedRow.querySelector('button[data-action="edit-comment"]');
  fire(editBtn2, "click");
  const editInput2 = doc.querySelector(".comment-edit-input");
  editInput2.value = "Sollte verworfen werden";
  fire(doc.querySelector('button[data-action="cancel-comment"]'), "click");
  const rowAfterCancel = doc.querySelector("#imports-tbody tr");
  check("Abbrechen verwirft die Änderung (alter Kommentar bleibt)", rowAfterCancel.textContent.includes("Nachträglich ergänzter Kommentar") && !rowAfterCancel.textContent.includes("Sollte verworfen werden"));

  // ===================== XSS-Schutz: Kommentar wird escaped =====================
  const editBtn3 = rowAfterCancel.querySelector('button[data-action="edit-comment"]');
  fire(editBtn3, "click");
  const editInput3 = doc.querySelector(".comment-edit-input");
  editInput3.value = '<img src=x onerror="window.__xss=true">';
  fire(doc.querySelector('button[data-action="save-comment"]'), "click");
  check("Kommentar-HTML wird escaped (kein <img> im DOM)", !doc.querySelector("#imports-tbody img"));
  check("Kein XSS ausgelöst", win.__xss !== true);

  // ===================== Nach Reset: Kommentarfeld & Zustand zurückgesetzt =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  check("Nach Reset: Kommentarfeld leer", doc.getElementById("import-comment-input").value === "");
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  check("Nach Reset: nur noch 1 Import (Ausgangsdaten, ohne Kommentar)", doc.querySelectorAll("#imports-tbody tr").length === 1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE IMPORT-KOMMENTAR-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
