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

  const totalBefore = parseInt(doc.getElementById("stat-tickets").textContent, 10);

  // Zwei separate Importe mit je 1 eindeutigen Ticket importieren.
  const xmlA = `<?xml version="1.0"?><rss><channel>
    <item><key>SCP-A1</key><summary>Ticket aus Import A</summary><description>Beschreibung A</description><status>Offen</status><type>Epic</type></item>
  </channel></rss>`;
  const xmlB = `<?xml version="1.0"?><rss><channel>
    <item><key>SCP-B1</key><summary>Ticket aus Import B</summary><description>Beschreibung B</description><status>Offen</status><type>Bug</type></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlA], "scope_a.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);
  Object.defineProperty(input, "files", { value: [new win.File([xmlB], "scope_b.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(300);

  const totalAfterImports = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Beide Importe eingelesen (Gesamtzahl um 2 gestiegen)", totalAfterImports === totalBefore + 2);

  // Beide Tickets im Dashboard auswaehlen und als Liste speichern (Listenauswahl).
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "SCP-";
  fire(doc.getElementById("search-input"), "input");
  await wait(250);
  ["SCP-A1", "SCP-B1"].forEach((key) => {
    const cb = doc.querySelector('input.row-select-checkbox[data-key="' + key + '"]');
    cb.checked = true;
    fire(cb, "click");
  });
  await wait(50);
  doc.querySelector('.nav-item[data-view="listenauswahl"]').click();
  doc.getElementById("listenauswahl-name-input").value = "SCP Kombi-Liste";
  fire(doc.getElementById("listenauswahl-save-btn"), "click");
  await wait(100);
  check("Liste 'SCP Kombi-Liste' gespeichert", doc.getElementById("listenauswahl-tbody").textContent.includes("SCP Kombi-Liste"));
  doc.getElementById("search-input") && (doc.getElementById("search-input").value = "");
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "";
  fire(doc.getElementById("search-input"), "input");
  fire(doc.getElementById("selection-clear-btn"), "click");
  await wait(50);

  // ===================== Verarbeitung Job 4: Schritt 1 - Mehrfachauswahl + Listen mit Icons =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const toggleBtn = doc.querySelector("#steps-job-4 .step-toggle");
  fire(toggleBtn, "click");
  await wait(50);

  const subPanel = doc.getElementById(toggleBtn.getAttribute("data-step-id"));
  check("Sub-Panel zeigt Checkboxen (nicht Radios) für Mehrfachauswahl", subPanel.querySelector('input[name^="active-import-choice-"]').type === "checkbox");
  const importOptions = Array.from(subPanel.querySelectorAll('input[value^="import:"]'));
  check("Beide neuen Importe als Datei-Option vorhanden (📄-Icon)", importOptions.length >= 2 && subPanel.innerHTML.includes("📄"));
  const listOptions = Array.from(subPanel.querySelectorAll('input[value^="list:"]'));
  check("Gespeicherte Liste als eigene Option vorhanden (📋-Icon)", listOptions.length === 1 && subPanel.innerHTML.includes("📋"));
  check("Listen-Option zeigt den Listennamen", subPanel.textContent.includes("SCP Kombi-Liste"));

  // Beide Importe (A + B) gemeinsam auswaehlen -> Vereinigung, nicht nur einer.
  const importAOpt = importOptions.find((o) => {
    const label = o.closest("label");
    return label && label.textContent.includes("scope_a.xml");
  });
  const importBOpt = importOptions.find((o) => {
    const label = o.closest("label");
    return label && label.textContent.includes("scope_b.xml");
  });
  check("Import-Option A gefunden", !!importAOpt);
  check("Import-Option B gefunden", !!importBOpt);
  importAOpt.checked = true; fire(importAOpt, "change");
  await wait(30);
  importBOpt.checked = true; fire(importBOpt, "change");
  await wait(30);
  check("Mehrfachauswahl (Import A + B): Job-4-Tabelle zeigt genau 2 Tickets", doc.getElementById("releaseversion-total").textContent === "2");
  check("Mehrfachauswahl zeigt SCP-A1", doc.getElementById("releaseversion-tbody").textContent.includes("SCP-A1"));
  check("Mehrfachauswahl zeigt SCP-B1", doc.getElementById("releaseversion-tbody").textContent.includes("SCP-B1"));

  // Auf die gespeicherte Liste als alleinige Quelle umschalten (Imports abwaehlen).
  importAOpt.checked = false; fire(importAOpt, "change");
  importBOpt.checked = false; fire(importBOpt, "change");
  await wait(30);
  const listOpt = listOptions[0];
  listOpt.checked = true; fire(listOpt, "change");
  await wait(30);
  check("Gespeicherte Liste als Quelle: Job-4-Tabelle zeigt genau 2 Tickets (aus dem Snapshot)", doc.getElementById("releaseversion-total").textContent === "2");

  // Import A UND Liste kombinieren -> weiterhin 2 (Ueberschneidung SCP-A1 wird dedupliziert).
  importAOpt.checked = true; fire(importAOpt, "change");
  await wait(30);
  check("Import A + Liste kombiniert: weiterhin genau 2 Tickets (dedupliziert)", doc.getElementById("releaseversion-total").textContent === "2");

  // Zurueck auf "Alle Importe" ueber die value=""-Option.
  const stepIdForPanel = toggleBtn.getAttribute("data-step-id");
  const allOptLive = doc.getElementById(stepIdForPanel).querySelector('input[value=""]');
  allOptLive.checked = true; fire(allOptLive, "change");
  await wait(30);
  check("Zurueck auf 'Alle Importe': wieder alle Tickets", parseInt(doc.getElementById("releaseversion-total").textContent, 10) === totalAfterImports);
  const panelAfterAll = doc.getElementById(stepIdForPanel);
  const stillCheckedOthers = Array.from(panelAfterAll.querySelectorAll('input[name^="active-import-choice-"]')).filter((cb) => cb.value !== "" && cb.checked);
  check("'Alle Importe' hakt Import-/Listen-Checkboxen automatisch wieder ab", stillCheckedOthers.length === 0);

  // ===================== "Aktualisieren" (Refresh): Zwischenergebnisse werden geloescht =====================
  // Job 3: Extraktion ausfuehren.
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(50);
  check("Job 3: Extraktion zeigt 'done' vor Refresh", /state-done[^>]*>[\s\S]*?Extraktion ausgeführt/.test(doc.getElementById("steps-job-3").innerHTML));

  // Job 4: Abgleich + Bewertung ausfuehren.
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  doc.getElementById("release-keys-input").value = "SCP-A1";
  fire(doc.getElementById("release-match-btn"), "click");
  fire(doc.getElementById("evaluate-tickets-btn"), "click");
  await wait(50);
  check("Job 4: Abgleich-Zusammenfassung sichtbar vor Refresh", !doc.getElementById("release-match-summary").hidden);
  check("Job 4: Bewertungs-Zusammenfassung sichtbar vor Refresh", !doc.getElementById("evaluate-summary").hidden);

  // Job 7: RAG-Rohdaten extrahieren.
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);
  check("Job 7: Rohdaten-Export-Zeile sichtbar vor Refresh", !doc.getElementById("rag-export-row").hidden);

  // "Aktualisieren"-Button existiert in Schritt 1 (jedes Job-Panel, auch ohne aufgeklapptes Sub-Panel).
  const refreshBtn = doc.querySelector("#steps-job-7 .step-refresh-btn");
  check("'Aktualisieren'-Button in Schritt 1 vorhanden", !!refreshBtn);

  // Abbrechen laesst alles unveraendert.
  fire(refreshBtn, "click");
  await wait(100);
  check("Bestätigungsdialog öffnet sich bei Klick auf 'Aktualisieren'", !doc.getElementById("confirm-modal-overlay").hidden);
  fire(doc.getElementById("confirm-modal-cancel-btn"), "click");
  await wait(100);
  check("Nach 'Abbrechen': Job 7 Rohdaten-Zeile weiterhin sichtbar (nichts geloescht)", !doc.getElementById("rag-export-row").hidden);

  // Jetzt tatsaechlich bestaetigen.
  fire(refreshBtn, "click");
  await wait(100);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(400);

  check("Job 3: Extraktion wieder 'pending' nach Refresh", /state-pending[^>]*>[\s\S]*?Extraktion ausgeführt/.test(doc.getElementById("steps-job-3").innerHTML));
  check("Job 4: Abgleich-Zusammenfassung nach Refresh wieder versteckt", doc.getElementById("release-match-summary").hidden);
  check("Job 4: Bewertungs-Zusammenfassung nach Refresh wieder versteckt", doc.getElementById("evaluate-summary").hidden);
  check("Job 7: Rohdaten-Export-Zeile nach Refresh wieder versteckt", doc.getElementById("rag-export-row").hidden);
  check("Protokoll vermerkt die Aktualisierung", doc.getElementById("log-list").textContent.includes("Verarbeitung aktualisiert"));

  // Imports/Tickets selbst bleiben nach Refresh vollstaendig erhalten (nur Zwischenergebnisse geloescht).
  check("Ticket-Gesamtzahl nach Refresh unveraendert (nur Zwischenergebnisse geloescht, keine Daten)", parseInt(doc.getElementById("stat-tickets").textContent, 10) === totalAfterImports);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE VERARBEITUNG-SCOPE/REFRESH-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
