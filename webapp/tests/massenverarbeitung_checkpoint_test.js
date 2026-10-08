// Massenverarbeitung: automatische Zwischenversion im Hintergrund alle 50
// verarbeitete Einträge WÄHREND der KI-Zuordnung (massSaveRunCheckpoint,
// analog zum Kapitel-Generator-Checkpoint, s. manual_chapters_versioning_
// test.js). Eigene, dedizierte Testdatei statt Erweiterung von
// massenverarbeitung_test.js, da 50 Einträge dort alle nachfolgenden
// zeilennummern-basierten Assertions verschoben hätten (s. historische
// Begründung in massenverarbeitung_test.js).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Domäne: keine\nKapitel: keines", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // app.massFiles ist zu Sitzungsbeginn immer leer (wird NICHT aus den
  // eingebetteten Demo-Tickets gespeist) - kein Reset noetig, und die Demo-
  // Tickets bleiben bewusst geladen, damit "Sitzung speichern" (s. u.) nicht
  // mangels Daten ablehnt.

  // ===================== 50 Einträge ohne Domäne/Kapitel hochladen (ZIP) =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  const zip = new JSZipNode();
  for (let i = 1; i <= 50; i++) {
    zip.file("Checkpoint-" + i + ".md", "Generischer Textschnipsel Nummer " + i + " ohne Domänenbezug.");
  }
  const zipBlob = await zip.generateAsync({ type: "nodebuffer" });
  const zipFile = new win.File([zipBlob], "checkpoint-batch.zip", { type: "application/zip" });
  const importInput = doc.getElementById("mass-import-input");
  Object.defineProperty(importInput, "files", { value: [zipFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 50, 5000);
  check("50 Einträge ohne Domäne/Kapitel hochgeladen", doc.querySelectorAll("#mass-groups tbody tr").length === 50);

  // ===================== KI-Zuordnung über alle 50 laufen lassen =====================
  const aiBtn = doc.getElementById("mass-ai-assign-btn");
  fire(aiBtn, "click");
  await waitUntil(() => !aiBtn.disabled, 10000);
  check("KI-Zuordnung über alle 50 Einträge abgeschlossen", aiBtn.disabled === false);

  // ===================== Automatische Zwischenversion nach 50 Durchgängen =====================
  const checkpointsWrap = doc.getElementById("mass-checkpoints-wrap");
  check("Zwischenversionen-Liste sichtbar (kein echter Ordner, aber im UI auffindbar)", checkpointsWrap.hidden === false);
  const checkpointsText = doc.getElementById("mass-checkpoints-list").textContent;
  check("Zwischenversionen-Liste nennt 'Nach 50 Durchgängen'", checkpointsText.includes("Nach 50 Durchgängen"));
  check("Zwischenversionen-Liste nennt 50 Einträge", checkpointsText.includes("50 Einträge"));

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(50);
  const protokollText = (doc.getElementById("log-list") || doc.body).textContent;
  check("Protokoll enthält einen Zwischenversion-Eintrag nach 50 Durchgängen", protokollText.includes("Zwischenversion im Hintergrund gespeichert (nach 50 Durchgängen, 50 Einträge)"));

  // ===================== Wiederherstellen stellt den Checkpoint-Stand wieder her =====================
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  const firstDomainSelect = doc.querySelector("#mass-groups .mass-domain-select");
  // Eine Domäne manuell setzen, die es vor dem Checkpoint so nicht gab.
  const opt = doc.createElement("option");
  opt.value = "ZZZ-Nach-Checkpoint";
  opt.textContent = "ZZZ-Nach-Checkpoint";
  firstDomainSelect.appendChild(opt);
  firstDomainSelect.value = "ZZZ-Nach-Checkpoint";
  fire(firstDomainSelect, "change");
  await wait(50);
  check("Domäne nach Checkpoint manuell geändert", doc.body.textContent.includes("ZZZ-Nach-Checkpoint"));

  const restoreBtn = doc.getElementById("mass-checkpoints-list").querySelector("[data-mass-checkpoint-restore]");
  check("'Wiederherstellen'-Button für die Zwischenversion vorhanden", !!restoreBtn);
  fire(restoreBtn, "click");
  await confirmViaModal(doc);
  check("Nach 'Wiederherstellen': die nachträglich gesetzte Domäne ist wieder verschwunden", !doc.body.textContent.includes("ZZZ-Nach-Checkpoint"));
  check("Nach 'Wiederherstellen': weiterhin 50 Einträge vorhanden", doc.querySelectorAll("#mass-groups tbody tr").length === 50);

  // ===================== Session-Persistenz von massCheckpoints =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("Export enthält massCheckpoints mit mindestens einem Eintrag", Array.isArray(exportedJson.massCheckpoints) && exportedJson.massCheckpoints.length >= 1);

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("Nach 'Alle Daten löschen': Zwischenversionen-Liste wieder verborgen", doc.getElementById("mass-checkpoints-wrap").hidden === true);

  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  check("Nach Laden: Zwischenversionen-Liste wieder sichtbar", doc.getElementById("mass-checkpoints-wrap").hidden === false);
  check("Nach Laden: Zwischenversionen-Liste nennt 'Nach 50 Durchgängen'", doc.getElementById("mass-checkpoints-list").textContent.includes("Nach 50 Durchgängen"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MASSENVERARBEITUNG-ZWISCHENVERSION-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
