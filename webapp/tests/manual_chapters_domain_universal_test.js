// Benutzerhandbuch-Kapitel-Generator: Bugfix manualTargetChapters().
// Gliederungskapitel OHNE eigene Domänen-Zuordnung (z. B. "Willkommen",
// "Inhaltsverzeichnis", allgemeine Einführungskapitel - s.
// outlineSeedData()-Kommentar "Bewusst NICHT zugeordnet") wurden bisher bei
// JEDER Domänen-Auswahl dauerhaft übersprungen, da ein leeres domains-Array
// über .some() nie matcht - die Kandidatenliste (und damit die Kapitel-
// Erstellung) begann dadurch immer beim ersten domänen-zugeordneten
// Kapitel ("Kapitel 4"), statt wie in der aktuellen Gliederung nummeriert
// mit "Willkommen" zu starten. Fix: sind ALLE verfügbaren Domänen
// ausgewählt ("Alle auswählen"), zählen domänenlose Kapitel als
// domänenübergreifend und werden als Kandidaten einbezogen; bei einer
// EINZELNEN/eingeschränkten Domänen-Auswahl bleibt das bisherige, engere
// Verhalten unverändert (kein Verlassen des gewählten Themas).
//
// Hinweis zur Testbarkeit: domänenlose Kapitel wie "Willkommen" können nie
// echten, aus Tickets generierten Inhalt bekommen (computeAutoOutline()
// ordnet Tickets AUSSCHLIESSLICH über die Domäne zu) - sie werden daher
// auch nach dem Fix als "übersprungen (keine passenden Tickets)" behandelt,
// NICHT als generierte Kapitel-Karte. Der Fix zeigt sich trotzdem robust
// beobachtbar: die Statuszeile wird SYNCHRON gesetzt, bevor der erste echte
// Claude-Aufruf aussteht (Skip-Schleife ohne await) - direkt nach dem
// Klick auf "Erzeuge" steht dort bereits "Kapitel 6 von 18" (18 Kandidaten
// dank Fix, Position 6 = erstes TATSÄCHLICH generiertes Kapitel nach 5
// domänenlosen Kandidaten davor), statt vorher "Kapitel 1 von 2".
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Kurzer Beispieltext für diesen Testlauf.", truncated: false, modelTierApplied: "default" });
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
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
    await wait(15);
  }
  return false;
}
function selectedCount(selectEl) { return Array.from(selectEl.options).filter((o) => o.selected).length; }

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>DU-1</key><summary>Servicevertrag im Alltag ändern</summary>
    <description>Der Dealer ändert einen bestehenden Vertrag.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
  <item><key>DU-2</key><summary>Statusbericht zu offenen Anträgen</summary>
    <description>Reporting zeigt den aktuellen Freigabestatus.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Reporting</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "domain_universal_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);

  const domainSelect = doc.getElementById("manual-domain-select");
  check("Genau 2 Domänen zur Auswahl (Contract Management, Reporting)", domainSelect.options.length === 2);

  // ===================== Szenario A: EINE Domäne ausgewählt - bisheriges, enges Verhalten bleibt =====================
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  check("Einzelne Domäne: Statuszeile zeigt direkt 'Kapitel 1 von 1' (nur Kapitel 7 als Kandidat, kein Willkommen/Inhaltsverzeichnis davor)",
    doc.getElementById("manual-status-note").textContent.indexOf("Kapitel 1 von 1") !== -1);
  await waitUntil(() => doc.getElementById("manual-generate-btn").disabled === false, 5000);
  await wait(50);

  const keysA = Array.from(doc.querySelectorAll("#manual-chapters-list [data-manual-chapter]")).map((c) => c.getAttribute("data-manual-chapter"));
  check("Einzelne Domäne 'Contract Management': genau 1 Kapitel erzeugt", keysA.length === 1);
  check("Einzelne Domäne: erzeugtes Kapitel ist 'Kapitel 7' (das zugeordnete, nicht 'Kapitel 4')", keysA[0] === "Kapitel 7: Verträge im Alltag verwalten");

  // ===================== Reset für Szenario B =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input2 = doc.getElementById("file-input");
  Object.defineProperty(input2, "files", { value: [new win.File([xml], "domain_universal_test2.xml", { type: "application/xml" })], configurable: true });
  fire(input2, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);

  // ===================== Szenario B: ALLE Domänen ausgewählt - Bugfix greift =====================
  fire(doc.querySelector('[data-select-all="manual-domain-select"]'), "click");
  await wait(50);
  const domainSelect2 = doc.getElementById("manual-domain-select");
  check("'Alle auswählen' markiert beide Domänen", selectedCount(domainSelect2) === 2);

  fire(doc.getElementById("manual-generate-btn"), "click");
  // Die Statuszeile wird SYNCHRON gesetzt (Skip-Schleife ohne await) - direkt
  // nach dem Klick ist bereits "Kapitel 6 von 18" sichtbar: 18 Kandidaten
  // (16 domänenlose + Kapitel 6 + Kapitel 7) statt vorher nur 2, Position 6
  // = fünf domänenlose Kandidaten (Willkommen, Inhaltsverzeichnis, Kapitel
  // 1-3) wurden der Gliederungs-Nummerierung nach ZUERST berücksichtigt
  // (und mangels Tickets übersprungen), bevor das erste wirklich generierte
  // Kapitel (Kapitel 6, Reporting) drankommt.
  const statusAfterClick = doc.getElementById("manual-status-note").textContent;
  check("Alle Domänen: Kandidatenliste jetzt 18 statt 2 (domänenlose Kapitel werden mitgezählt)", statusAfterClick.indexOf("von 18") !== -1);
  check("Alle Domänen: erstes TATSÄCHLICH generiertes Kapitel ist Nr. 6 (5 domänenlose Kapitel - Willkommen, Inhaltsverzeichnis, Kapitel 1-3 - davor berücksichtigt)",
    statusAfterClick.indexOf("Kapitel 6 von 18") !== -1 && statusAfterClick.indexOf("Kapitel 6: Antrag verfolgen") !== -1);

  await waitUntil(() => doc.getElementById("manual-generate-btn").disabled === false, 15000);
  await wait(50);

  const keysB = Array.from(doc.querySelectorAll("#manual-chapters-list [data-manual-chapter]")).map((c) => c.getAttribute("data-manual-chapter"));
  check("Alle Domänen gewählt: 'Kapitel 6' (Reporting) weiterhin erzeugt", keysB.indexOf("Kapitel 6: Antrag verfolgen und aktivieren") !== -1);
  check("Alle Domänen gewählt: 'Kapitel 7' (Contract Management) weiterhin erzeugt", keysB.indexOf("Kapitel 7: Verträge im Alltag verwalten") !== -1);
  check("Alle Domänen gewählt: 'Kapitel 4' (fremde, nie importierte Domänen) bleibt ausgeschlossen", keysB.indexOf("Kapitel 4: Servicevertrag anlegen") === -1);
  check("Alle Domänen gewählt: genau 2 Kapitel-Karten (die übrigen 16 domänenlosen Kandidaten mangels Tickets korrekt übersprungen, nicht als leere Karten erzeugt)", keysB.length === 2);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE DOMAENEN-UNIVERSAL-KAPITEL-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
