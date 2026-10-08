// Benutzerhandbuch-Kapitel-Generator: Performance-Fixes.
// (1) manualGenerateChapters() rief bisher bei JEDEM fertiggestellten
//     Kapitel renderManualChapters() (kompletter Neuaufbau ALLER Karten)
//     auf - bei vielen Kapiteln in einem Lauf dadurch O(Kapitel^2) statt
//     O(Kapitel). Fix: voller Neuaufbau nur noch periodisch (alle
//     MANUAL_RERENDER_INTERVAL Kapitel) sowie einmal abschließend.
// (2) manualRunQualityCheck()/"Alle prüfen" rief renderManualChapters()
//     bei JEDEM Kapitel zweimal auf (Start + Ende) - Fix: In-Place-Update
//     nur der betroffenen Karte (Spinner/Ergebnis-Panel), gar kein voller
//     Neuaufbau mehr nötig, da sich Reihenfolge/Gruppierung der Karten
//     durch die Qualitätsprüfung nie ändert.
// Dieser Test weist beides NICHT über Zeitmessung nach (flaky), sondern
// zählt deterministisch, wie oft #manual-chapters-list.innerHTML
// tatsächlich NEU GESETZT wird.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCallCount = 0;
let sampleImpl = async (input) => {
  sampleCallCount++;
  if (input.indexOf("Lektor/Qualitätsprüfer") !== -1) {
    return { text: "### Grammatikfehler\n- Keine gefunden.\n\n### Lücken\n- Keine gefunden.\n\n### Verbesserungsvorschläge\n- Keine gefunden.", truncated: false, modelTierApplied: "default" };
  }
  return { text: "Generierter Text Nr. " + sampleCallCount + ".", truncated: false, modelTierApplied: "default" };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function () { return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function setValue(el, v) { el.value = v; fire(el, "input"); }
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

  // Eingebettete Demo-Tickets (~663) zuerst entfernen - jede Gliederungs-
  // Änderung (Kapitel/Domäne hinzufügen) löst sonst eine Neuberechnung über
  // den GESAMTEN Ticket-Bestand aus; bei 663 weiterhin geladenen Tickets und
  // vielen Gliederungs-Änderungen in Folge macht allein das den Testaufbau
  // (nicht die hier eigentlich geprüfte App-Funktion) unverhältnismäßig
  // langsam. Mit nur dem einen unten importierten Test-Ticket bleibt der
  // Aufbau schnell - deckt sich mit dem etablierten Muster in
  // manual_chapters_versioning_test.js.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== 45 Test-Kapitel + ein Ticket je Kapitel-Domäne anlegen =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  function outlineChapterIdByTitle(title) {
    const rows = Array.from(doc.querySelectorAll(".outline-chapter-row"));
    const row = rows.find((r) => r.textContent.includes(title));
    const delBtn = row ? row.querySelector('[data-action="delete-chapter"]') : null;
    return delBtn ? delBtn.getAttribute("data-chapter-id") : null;
  }
  for (let i = 1; i <= 45; i++) {
    const title = "PERF-Test-Kapitel " + i;
    setValue(doc.getElementById("outline-new-chapter-input"), title);
    fire(doc.getElementById("outline-add-chapter-btn"), "click");
    await wait(10);
    const chapterId = outlineChapterIdByTitle(title);
    const domainInput = doc.querySelector('.outline-new-domain-input[data-chapter-id="' + chapterId + '"]');
    setValue(domainInput, "PERF-Test-Domain");
    fire(doc.querySelector('[data-action="add-domain"][data-chapter-id="' + chapterId + '"]'), "click");
    await wait(10);
  }
  check("45 Test-Kapitel angelegt", doc.querySelectorAll(".outline-chapter-row").length >= 45);

  const xmlPerf = `<?xml version="1.0"?><rss><channel>
    <item><key>PERF-1</key><summary>Performance-Ticket</summary>
      <description>Dient nur dem Performance-Test.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>PERF-Test-Domain</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const importInput = doc.getElementById("file-input");
  Object.defineProperty(importInput, "files", { value: [new win.File([xmlPerf], "perf_test.xml", { type: "application/xml" })], configurable: true });
  fire(importInput, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "PERF-Test-Domain"; });
  fire(domainSelect, "change");
  const chapterSelect = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect.options).forEach((o) => { o.selected = false; });
  fire(chapterSelect, "change");
  await wait(30);

  // ===================== innerHTML-Setzungen auf #manual-chapters-list mitzählen =====================
  const listEl = doc.getElementById("manual-chapters-list");
  let descriptor;
  for (let proto = Object.getPrototypeOf(listEl); proto && !descriptor; proto = Object.getPrototypeOf(proto)) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "innerHTML");
  }
  let fullRenderCount = 0;
  Object.defineProperty(listEl, "innerHTML", {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(v) { fullRenderCount++; descriptor.set.call(this, v); },
  });

  // ===================== (1) Generierung über alle 45 Kapitel =====================
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 15000);
  check("Generierung über alle 45 Kapitel abgeschlossen", doc.getElementById("manual-generate-btn").disabled === false);
  check("45 Kapitel-Karten erzeugt", doc.querySelectorAll("#manual-chapters-list [data-manual-chapter]").length === 45);
  // Ohne Fix waere hier mindestens 1 voller Kartenneuaufbau PRO erzeugtem
  // Kapitel angefallen (bis zu 45). Mit Fix nur periodisch (alle 20: bei
  // 20 und 40) plus einmal abschliessend.
  check("Kartenneuaufbau waehrend der Generierung deutlich seltener als 1x je Kapitel (nicht quadratisch)",
    fullRenderCount < 10);
  check("Trotzdem fand mindestens ein Neuaufbau statt (Ergebnis sichtbar)", fullRenderCount >= 1);

  // ===================== (2) "Alle prüfen" über alle 45 Kapitel =====================
  fullRenderCount = 0;
  sampleCallCount = 0;
  const qcAllBtn = doc.getElementById("manual-quality-check-all-btn");
  fire(qcAllBtn, "click");
  await waitUntil(() => !qcAllBtn.disabled, 15000);
  check("'Alle prüfen' über alle 45 Kapitel abgeschlossen", qcAllBtn.disabled === false);
  check("Claude wurde für jedes der 45 Kapitel genau einmal zur Qualitätsprüfung aufgerufen", sampleCallCount === 45);
  const allChecked = Array.from(doc.querySelectorAll("#manual-chapters-list [data-manual-chapter]"))
    .every((card) => card.textContent.includes("Geprüft am"));
  check("Alle 45 Karten zeigen ein Qualitätsprüfungs-Ergebnis (In-Place-Updates korrekt)", allChecked);
  // Die Qualitätsprüfung aendert weder Reihenfolge noch Gruppierung der
  // Karten - ein In-Place-Update je Kapitel reicht aus, ganz OHNE jemals
  // #manual-chapters-list.innerHTML neu zu setzen.
  check("Während 'Alle prüfen' wurde #manual-chapters-list KEIN einziges Mal komplett neu aufgebaut",
    fullRenderCount === 0);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KAPITEL-GENERATOR-PERFORMANCE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
