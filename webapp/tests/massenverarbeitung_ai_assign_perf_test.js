// Massenverarbeitung: Performance-Fix für die KI-Zuordnung. Vorher rief
// massRunAiAssignment() bei JEDEM erfolgreich zugeordneten Eintrag einen
// kompletten Neuaufbau der #mass-groups-Tabelle auf (renderMassFiles() -
// baut die komplette innerHTML inkl. aller Select-Optionen jeder Zeile neu
// auf) - bei vielen hundert Einträgen quadratischer statt linearer
// Gesamtaufwand über den Lauf. Fix: während der Schleife nur die beiden
// betroffenen <select>-Elemente der jeweiligen Zeile direkt im DOM
// aktualisieren (massUpdateRowSelectsInPlace), ein voller Tabellen-Neuaufbau
// erfolgt nur noch periodisch (alle MASS_RERENDER_INTERVAL Treffer) sowie
// einmal abschließend. Dieser Test weist das NICHT über Zeitmessung nach
// (flaky), sondern zählt deterministisch, wie oft die innerHTML von
// #mass-groups tatsächlich NEU GESETZT wird.
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

let sampleCallCount = 0;
let sampleImpl = async () => {
  sampleCallCount++;
  // Liefert bei JEDEM Aufruf eine gueltige Domäne + ein gueltiges Kapitel
  // (Worst Case fuer die Performance-Frage: "changed" wird fuer ALLE
  // Eintraege true, massUpdateRowSelectsInPlace wird also tatsaechlich bei
  // jedem einzelnen Eintrag ausgeloest statt nur gelegentlich).
  return { text: "Domäne: Contract Management\nKapitel: Kapitel 7: Verträge im Alltag verwalten", truncated: false, modelTierApplied: "default" };
};
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

  // ===================== Vorbereitung: eine Domäne/ein Kapitel müssen bereits existieren =====================
  // Die KI-Zuordnung darf nur aus TATSÄCHLICH vorhandenen Domänen/Kapiteln
  // wählen (massParseAiAssignment verwirft alles andere) - ein erster
  // Eintrag MIT Domäne/Kapitel sorgt dafür, dass "Contract Management" und
  // "Kapitel 7: Verträge im Alltag verwalten" in den Auswahllisten stehen,
  // bevor die eigentlichen 45 Test-Einträge hochgeladen werden.
  doc.querySelector('.nav-item[data-view="massenverarbeitung"]').click();
  await wait(50);
  const seedZip = new JSZipNode();
  seedZip.file("Seed.md", "Servicevertrag im Autohaus anlegen und verwalten.");
  const seedBlob = await seedZip.generateAsync({ type: "nodebuffer" });
  const seedFile = new win.File([seedBlob], "seed.zip", { type: "application/zip" });
  const importInput = doc.getElementById("mass-import-input");
  Object.defineProperty(importInput, "files", { value: [seedFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 1, 3000);
  const seedDomainSel = doc.querySelector(".mass-domain-select");
  const seedChapterSel = doc.querySelector(".mass-chapter-select");
  Array.from(seedDomainSel.options).forEach((o) => { if (o.value === "Contract Management") seedDomainSel.value = o.value; });
  fire(seedDomainSel, "change");
  await wait(20);
  const seedChapterSelAfter = doc.querySelector(".mass-chapter-select");
  Array.from(seedChapterSelAfter.options).forEach((o) => { if (o.value.includes("Kapitel 7")) seedChapterSelAfter.value = o.value; });
  fire(seedChapterSelAfter, "change");
  await wait(20);

  // ===================== 45 Einträge ohne Domäne/Kapitel hochladen =====================
  const zip = new JSZipNode();
  for (let i = 1; i <= 45; i++) {
    zip.file("Perf-" + i + ".md", "Generischer Textschnipsel Nummer " + i + " ohne Domänenbezug.");
  }
  const zipBlob = await zip.generateAsync({ type: "nodebuffer" });
  const zipFile = new win.File([zipBlob], "perf-batch.zip", { type: "application/zip" });
  Object.defineProperty(importInput, "files", { value: [zipFile], configurable: true });
  fire(importInput, "change");
  await waitUntil(() => doc.querySelectorAll("#mass-groups tbody tr").length === 46, 5000);
  check("45 Einträge ohne Domäne/Kapitel zusätzlich zum Seed-Eintrag hochgeladen (46 Zeilen gesamt)",
    doc.querySelectorAll("#mass-groups tbody tr").length === 46);

  // ===================== innerHTML-Setzungen auf #mass-groups mitzählen =====================
  const massGroupsEl = doc.getElementById("mass-groups");
  let descriptor;
  for (let proto = Object.getPrototypeOf(massGroupsEl); proto && !descriptor; proto = Object.getPrototypeOf(proto)) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "innerHTML");
  }
  let fullRenderCount = 0;
  Object.defineProperty(massGroupsEl, "innerHTML", {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(v) { fullRenderCount++; descriptor.set.call(this, v); },
  });

  sampleCallCount = 0;
  const aiBtn = doc.getElementById("mass-ai-assign-btn");
  fire(aiBtn, "click");
  await waitUntil(() => !aiBtn.disabled, 10000);
  check("KI-Zuordnung über alle 45 unvollständigen Einträge abgeschlossen", aiBtn.disabled === false);
  check("Claude wurde für jeden der 45 unvollständigen Einträge genau einmal aufgerufen", sampleCallCount === 45);

  // Ohne den Fix waere hier mindestens 1 kompletter Tabellen-Neuaufbau PRO
  // erfolgreich zugeordnetem Eintrag angefallen (bis zu 45). Mit dem Fix
  // nur noch periodisch (alle 20 Treffer: bei 20 und 40) plus einmal
  // abschliessend - deutlich weniger als die Eintragsanzahl.
  check("Tabellen-Neuaufbau (#mass-groups.innerHTML gesetzt) deutlich seltener als 1x je Eintrag (nicht quadratisch)",
    fullRenderCount < 10);
  check("Trotzdem mindestens ein Neuaufbau fand statt (periodisch/abschließend, Ergebnis sichtbar)", fullRenderCount >= 1);

  const statusNote = doc.getElementById("mass-ai-status-note").textContent;
  check("Statuszeile meldet alle 45 Einträge zugeordnet", statusNote.startsWith("45 von 45 Einträgen per KI zugeordnet"));

  // ===================== Endergebnis ist trotz In-Place-Updates korrekt =====================
  const assignedDomainSelects = Array.from(doc.querySelectorAll(".mass-domain-select"));
  const allAssigned = assignedDomainSelects.every((sel) => sel.value === "Contract Management");
  check("Alle 46 Zeilen zeigen nach Abschluss die korrekt zugeordnete Domäne (In-Place-Updates + finaler Render konsistent)", allAssigned);
  check("Alle Einträge stehen nach dem abschließenden Neuaufbau in EINER Domänen-Gruppe 'Contract Management (46)'",
    doc.getElementById("mass-groups").textContent.includes("Contract Management (46)"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE MASSENVERARBEITUNG-KI-ZUORDNUNG-PERFORMANCE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
