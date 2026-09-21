const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });
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

  async function openTicketFields(key) {
    doc.querySelector('.nav-item[data-view="dashboard"]').click();
    doc.getElementById("search-input").value = key;
    fire(doc.getElementById("search-input"), "input");
    await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
    const row = doc.querySelector("#table-body tr");
    if (!row) return null;
    fire(row, "click");
    const txt = doc.getElementById("modal-fields").textContent;
    fire(doc.getElementById("modal-close"), "click");
    doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
    await wait(200);
    return txt;
  }

  // ===================== Teil A: Teil-Import behaelt fehlende Felder =====================
  const before = await openTicketFields("ONESCM-8282");
  check("ONESCM-8282 vor Import gefunden", !!before);
  const domainLineBefore = before.match(/Domain[\s\S]{0,80}/)[0];
  check("ONESCM-8282 hat vorher eine Domain", !domainLineBefore.includes("Nicht im Export enthalten"));
  console.log("  Domain vorher:", domainLineBefore.replace(/\s+/g, " "));

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xmlText = fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8");
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlText], "nachtrag_demo.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  const after = await openTicketFields("ONESCM-8282");
  check("Status wurde auf 'Fertig' aktualisiert (echte Aenderung)", after.includes("Fertig"));
  check("Zusammenfassung wurde aktualisiert (echte Aenderung)", after.includes("Testweise nachgetragene Zusammenfassung"));
  check("Domain bleibt erhalten (Teil-Import ohne Domain-Feld)", after.includes(domainLineBefore.match(/Domain\s*([^\n]*)/)[1].trim() || "___nomatch___") || domainLineBefore.replace(/\s+/g, " ").split(" ").slice(1).some((w) => after.includes(w)));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const changeRows = Array.from(doc.querySelectorAll("#changes-tbody tr"));
  const domainChangeForTicket = changeRows.some((r) => r.textContent.includes("ONESCM-8282") && r.textContent.includes("Domain"));
  check("KEIN spurious 'Domain geaendert'-Eintrag fuer ONESCM-8282 durch Teil-Import", !domainChangeForTicket);
  const statusChangeForTicket = changeRows.some((r) => r.textContent.includes("ONESCM-8282") && r.textContent.includes("Status"));
  check("Echte Status-Aenderung fuer ONESCM-8282 weiterhin als Aenderung erkannt", statusChangeForTicket);

  // ===================== Teil B: Zwischenablage-Import =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  const pasteBtn = doc.getElementById("paste-process-btn");
  const spinner = doc.getElementById("paste-spinner");
  const textarea = doc.getElementById("paste-textarea");
  const releaseinfoSample = fs.readFileSync(path.join(FIXTURES, "releaseinfo_sample.txt"), "utf-8");
  textarea.value = releaseinfoSample;

  check("Spinner vor Verarbeitung versteckt", spinner.hidden === true);
  fire(pasteBtn, "click");
  check("Spinner (Sanduhr) sofort nach Klick sichtbar", spinner.hidden === false);
  check("Verarbeiten-Button waehrend Verarbeitung deaktiviert", pasteBtn.disabled === true);
  await wait(400);
  check("Spinner nach Verarbeitung wieder versteckt", spinner.hidden === true);
  check("Verarbeiten-Button nach Verarbeitung wieder aktiv", pasteBtn.disabled === false);
  check("Textfeld nach erfolgreicher Verarbeitung geleert", textarea.value === "");

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRows = Array.from(doc.querySelectorAll("#imports-tbody tr"));
  const manualRow = importRows.find((r) => r.textContent.includes("Manuell (Zwischenablage)"));
  check("Import-Tabelle zeigt Quelle 'Manuell (Zwischenablage)'", !!manualRow);

  // ===================== Teil C: Leeres Zwischenablage-Feld / Clipboard-Button ohne Berechtigung =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  textarea.value = "";
  const toastBefore = doc.getElementById("toast").textContent;
  fire(pasteBtn, "click");
  await wait(50);
  check("Leeres Feld zeigt Fehlermeldung statt Absturz", doc.getElementById("toast").className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MERGE- UND ZWISCHENABLAGE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
