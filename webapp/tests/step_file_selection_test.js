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

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();

  // ===================== Pfeil/Toggle bei nur 1 vorhandenem Import =====================
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const toggleBtn = doc.querySelector("#steps-job-4 .step-toggle");
  check("Schritt 'Datei(en) ausgewählt/importiert' hat einen Pfeil (Toggle-Button)", !!toggleBtn);
  const subPanel = doc.getElementById(toggleBtn.getAttribute("data-step-id"));
  check("Unteraktivitäten-Panel initial eingeklappt (hidden)", subPanel.hidden === true);
  check("Pfeil zeigt geschlossenen Zustand (▸)", toggleBtn.textContent === "▸");

  fire(toggleBtn, "click");
  check("Panel nach Klick aufgeklappt", subPanel.hidden === false);
  check("Pfeil zeigt geöffneten Zustand (▾)", toggleBtn.textContent === "▾");
  check("aria-expanded korrekt gesetzt", toggleBtn.getAttribute("aria-expanded") === "true");

  const fileOptions = subPanel.querySelectorAll('input[name^="active-import-choice-"]');
  check("Datei-Auswahl zeigt 'Alle Importe' + genau 1 Datei-Option, OBWOHL nur 1 Import vorhanden ist", fileOptions.length === 2);
  check("'Alle Importe' ist standardmäßig ausgewählt", fileOptions[0].checked === true && fileOptions[0].value === "");
  check("Die eine vorhandene Datei ist als echte Auswahlmöglichkeit vorhanden (nicht ausgeblendet)", fileOptions[1].value !== "");

  // ===================== Panel bleibt nach Re-Render (z. B. neuer Import) offen =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  const xml = fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "nachtrag.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const subPanelAfter = doc.getElementById(doc.querySelector("#steps-job-4 .step-toggle").getAttribute("data-step-id"));
  check("Panel bleibt nach einem neuen Import weiterhin aufgeklappt (State bleibt erhalten)", subPanelAfter.hidden === false);
  const fileOptionsAfter = subPanelAfter.querySelectorAll('input[name^="active-import-choice-"]');
  check("Jetzt 2 Datei-Optionen (+ 'Alle Importe' = 3 Radios)", fileOptionsAfter.length === 3);

  // ===================== Tatsaechliche Datei auswaehlen -> Scoping wirkt =====================
  const totalBefore = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  const releaseTotalBefore = parseInt(doc.getElementById("releaseversion-total").textContent, 10);
  check("Vor Auswahl: Job-4-Tabelle zeigt ALLE Tickets (zusammengeführt)", releaseTotalBefore === totalBefore);

  // Die zuletzt importierte Datei (nachtrag.xml, 1 Ticket: ONESCM-8282) auswaehlen
  const lastRadio = fileOptionsAfter[fileOptionsAfter.length - 1];
  lastRadio.checked = true;
  fire(lastRadio, "change");
  await wait(100);

  const releaseTotalAfter = parseInt(doc.getElementById("releaseversion-total").textContent, 10);
  check("Nach Datei-Auswahl: Job-4-Tabelle zeigt NUR Tickets aus dieser einen Datei (1 statt " + totalBefore + ")", releaseTotalAfter === 1);
  check("Header-Gesamtzahl (oben rechts) bleibt unveraendert (Auswahl betrifft nur die Job-Tabellen)", parseInt(doc.getElementById("stat-tickets").textContent, 10) === totalBefore);
  check("Gefilterte Tabelle zeigt genau ONESCM-8282", doc.getElementById("releaseversion-tbody").textContent.includes("ONESCM-8282"));

  // Job 5 ist ueber denselben globalen Zustand ebenfalls gescoped (geteilte Auswahl)
  doc.querySelector('.import-tab[data-vsub="jira-liste"]').click();
  check("Job 5 (Jira Liste) uebernimmt dieselbe Datei-Auswahl (ebenfalls 1 Ticket)", doc.getElementById("jiraliste-count").textContent === "1");

  // Protokoll-Eintrag zur Auswahl
  doc.querySelector('.import-tab[data-vsub="protokoll"]').click();
  check("Auswahl wird im Protokoll vermerkt", doc.getElementById("log-list").textContent.includes("Aktive Datei für Verarbeitung"));

  // Job 3 Extraktion respektiert ebenfalls die Auswahl
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);
  // nachtrag.xml hat keinen Freitext mit Abkuerzungen -> 0 gefunden, aber wichtig: kein Fehler/Absturz
  check("Extraktion mit Datei-Scope laeuft fehlerfrei durch", !doc.getElementById("toast").className.includes("error"));

  // ===================== Zurueck auf "Alle Importe" =====================
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const allRadio = doc.querySelector('#steps-job-4 input[name^="active-import-choice-"][value=""]');
  allRadio.checked = true;
  fire(allRadio, "change");
  await wait(100);
  check("Zurueck auf 'Alle Importe': Job-4-Tabelle zeigt wieder alle Tickets", parseInt(doc.getElementById("releaseversion-total").textContent, 10) === totalBefore);

  // ===================== Reset setzt Auswahl zurueck =====================
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const toggleBtn2 = doc.querySelector("#steps-job-4 .step-toggle");
  fire(toggleBtn2, "click");
  const radios2 = doc.querySelectorAll('#steps-job-4 input[name^="active-import-choice-"]');
  radios2[radios2.length - 1].checked = true;
  fire(radios2[radios2.length - 1], "change");
  await wait(100);

  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const radiosAfterReset = doc.querySelectorAll('#steps-job-4 input[name^="active-import-choice-"]');
  check("Nach Reset: 'Alle Importe' wieder ausgewählt", radiosAfterReset[0].checked === true);
  check("Nach Reset: Job-4-Tabelle zeigt wieder alle (663) Tickets", doc.getElementById("releaseversion-total").textContent === "663");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DATEI-AUSWAHL-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
