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

  function stepStates(jobNum) {
    return Array.from(doc.querySelectorAll("#steps-job-" + jobNum + " .process-step")).map((el) => {
      if (el.classList.contains("state-done")) return "done";
      if (el.classList.contains("state-error")) return "error";
      return "pending";
    });
  }

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();

  // ===================== Zustand direkt nach dem initialen Beispiel-Import =====================
  check("Job 1 hat 4 Prozessschritte", doc.querySelectorAll("#steps-job-1 .process-step").length === 4);
  check("Job 1: Schritte 1+2 (Datei/Verarbeitet) sind 'done' nach initialem Import", stepStates(1)[0] === "done" && stepStates(1)[1] === "done");
  check("Job 1: Protokoll-Schritt 'done' (Import selbst erzeugt Log-Eintrag)", stepStates(1)[2] === "done");

  check("Job 2 hat 4 Prozessschritte", doc.querySelectorAll("#steps-job-2 .process-step").length === 4);
  check("Job 2: 'mind. 2 Importe' ist 'pending' (nur 1 Import bisher)", stepStates(2)[0] === "pending");

  check("Job 3: Extraktion ist 'pending' vor dem ersten Lauf", stepStates(3)[2] === "pending");

  check("Job 4 hat 6 Prozessschritte (wie spezifiziert)", doc.querySelectorAll("#steps-job-4 .process-step").length === 6);
  check("Job 4: Abgleich-Schritt (5) ist 'pending' vor erstem Abgleich", stepStates(4)[4] === "pending");
  check("Job 4: Bewertungs-Schritt (6) ist 'pending' vor erster Bewertung", stepStates(4)[5] === "pending");

  check("Job 5 hat 4 Prozessschritte", doc.querySelectorAll("#steps-job-5 .process-step").length === 4);
  check("Job 5: alle Schritte 'done' (Tickets bereits geladen)", stepStates(5).every((s) => s === "done"));

  check("Job 6 (Domänen-Übersicht) hat 4 Prozessschritte", doc.querySelectorAll("#steps-job-6 .process-step").length === 4);
  check("Job 6: alle Schritte 'done' (Tickets bereits geladen)", stepStates(6).every((s) => s === "done"));

  // ===================== Zweiter Import: Job 2 wird 'done' =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  const xml = fs.readFileSync(path.join(FIXTURES, "nachtrag_demo.xml"), "utf-8");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "nachtrag.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  check("Job 2: nach 2. Import alle Schritte 'done' (Aenderung gefunden)", stepStates(2).every((s) => s === "done"));

  // ===================== Job 3: Extraktion ausfuehren -> Schritte werden 'done' =====================
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);
  check("Job 3: alle Schritte 'done' nach Extraktion", stepStates(3).every((s) => s === "done"));

  // ===================== Job 4: Abgleich + Bewertung ausfuehren =====================
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const anyKey = doc.querySelector("#releaseversion-tbody tr td").textContent;
  doc.getElementById("release-keys-input").value = anyKey;
  fire(doc.getElementById("release-match-btn"), "click");
  await wait(100);
  check("Job 4: Abgleich-Schritt (5) 'done' nach Abgleichen", stepStates(4)[4] === "done");
  check("Job 4: Bewertungs-Schritt (6) weiterhin 'pending' (noch nicht bewertet)", stepStates(4)[5] === "pending");

  fire(doc.getElementById("evaluate-tickets-btn"), "click");
  await wait(100);
  check("Job 4: Bewertungs-Schritt (6) 'done' nach Bewertung", stepStates(4)[5] === "done");
  check("Bewertungs-Zusammenfassung sichtbar", doc.getElementById("evaluate-summary").hidden === false);
  check("Bewertungstabelle sichtbar und befüllt", doc.getElementById("evaluate-tbody").children.length > 0);
  const manualCount = parseInt(doc.getElementById("evaluate-count-manual").textContent, 10);
  const internalCount = parseInt(doc.getElementById("evaluate-count-internal").textContent, 10);
  const unknownCount = parseInt(doc.getElementById("evaluate-count-unknown").textContent, 10);
  const totalTickets = parseInt(doc.getElementById("stat-tickets").textContent, 10);
  check("Bewertungs-Summen ergeben Gesamtzahl (keine Tickets verloren/erfunden)", manualCount + internalCount + unknownCount === totalTickets);
  check("Bewertungstabelle zeigt echte Einordnung (kein erfundener Text)", doc.getElementById("evaluate-tbody").textContent.includes("Unbekannt (kein Typ im Export)") || unknownCount === 0);

  // ===================== Reset setzt Prozessschritte zurueck =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  check("Job 3 nach Reset: Extraktion wieder 'pending'", stepStates(3)[2] === "pending");
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  check("Job 4 nach Reset: Abgleich wieder 'pending'", stepStates(4)[4] === "pending");
  check("Job 4 nach Reset: Bewertung wieder 'pending'", stepStates(4)[5] === "pending");
  check("Bewertungs-Zusammenfassung nach Reset wieder versteckt", doc.getElementById("evaluate-summary").hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PROZESSSCHRITT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
