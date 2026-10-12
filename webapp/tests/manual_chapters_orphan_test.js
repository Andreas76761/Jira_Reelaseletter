// Benutzerhandbuch-Kapitel-Generator: bereits generierte Kapitel durch
// neu erstellte Kapitel austauschen. Ein erneuter Excel-Matrix-Upload
// (Einstellungen) ersetzt NUR die Gliederung/Struktur - bereits erzeugte
// Kapitel-Texte bleiben jetzt erhalten (anders als zuvor, wo sie
// automatisch mitgelöscht wurden), auch wenn ihr alter Titel in der neuen
// Gliederung nicht mehr vorkommt ("verwaistes" Kapitel). Ein neuer Bereich
// "Nicht mehr zugeordnete, bereits generierte Kapitel" erlaubt, so ein
// Kapitel gezielt auf ein Kapitel der neuen Gliederung zu übernehmen
// (ersetzt dessen Text) oder zu verwerfen.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");
const XLSX = require("xlsx");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Dieses Kapitel führt in den Servicevertrag ein. Ein eigener, erkennbarer Beispieltext.", truncated: false, modelTierApplied: "default" });
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

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>ORPH-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
    <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

// Neue Matrix mit NUR einem Kapitel "Kapitel 1: Neue Struktur" - "Kapitel 7"
// (fuer das gleich ein Text erzeugt wird) kommt darin bewusst nicht mehr vor.
function buildReplacementMatrixXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  const matrixAoa = [
    ["Kapitel", "Thema", "Ebene"],
    ["1", "Neue Struktur", 1],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa), "Matrix");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

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
  Object.defineProperty(input, "files", { value: [new win.File([xml], "orphan_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Kapitel "Kapitel 7" erzeugen =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);
  check("Kapitel 'Kapitel 7: Verträge im Alltag verwalten' erzeugt", doc.getElementById("manual-chapters-list").textContent.includes("Kapitel 7: Verträge im Alltag verwalten"));
  check("Orphan-Bereich vor Gliederungs-Update ausgeblendet (Kapitel noch zugeordnet)", doc.getElementById("manual-orphans-wrap").hidden);
  const originalText = doc.querySelector('[data-manual-chapter] textarea').value;
  check("Erzeugter Text enthält den Beispielsatz", originalText.includes("eigener, erkennbarer Beispieltext"));

  // ===================== Neue Matrix hochladen: "Kapitel 7" existiert nicht mehr =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="gliederung"]'), "click");
  await wait(30);
  const buf = buildReplacementMatrixXlsxBuffer();
  const matrixInput = doc.getElementById("outline-matrix-upload-input");
  Object.defineProperty(matrixInput, "files", { value: [new win.File([buf], "replacement.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], configurable: true });
  fire(matrixInput, "change");
  await confirmViaModal(doc);
  check("Gliederung ersetzt: genau 1 Kapitel ('Kapitel 1: Neue Struktur')", doc.getElementById("outline-tbody").textContent.includes("Kapitel 1: Neue Struktur"));
  check("Protokoll bestätigt: generierte Kapitel bleiben erhalten (kein 'gelöscht'/'zurückgesetzt' für Kapitel-Texte)",
    doc.getElementById("log-list").textContent.includes("bleiben erhalten"));

  // ===================== Verwaistes Kapitel im Benutzerhandbuch =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("Altes Kapitel 'Kapitel 7' ist weiterhin in der normalen Kapitelliste vorhanden (nicht gelöscht)",
    doc.getElementById("manual-chapters-list").textContent.includes("Kapitel 7: Verträge im Alltag verwalten"));
  check("Orphan-Bereich jetzt sichtbar", !doc.getElementById("manual-orphans-wrap").hidden);
  const orphanCard = doc.querySelector('[data-manual-orphan="Kapitel 7: Verträge im Alltag verwalten"]');
  check("Orphan-Karte für 'Kapitel 7' vorhanden", !!orphanCard);
  check("Ziel-Auswahl der Orphan-Karte listet 'Kapitel 1: Neue Struktur'",
    !!orphanCard && Array.from(orphanCard.querySelector(".manual-orphan-target-select").options).some((o) => o.value === "Kapitel 1: Neue Struktur"));

  // ===================== Übernehmen ohne Zielauswahl -> Fehlermeldung =====================
  fire(orphanCard.querySelector('[data-manual-orphan-action="apply"]'), "click");
  await wait(30);
  check("Ohne Zielauswahl: Fehlermeldung statt stillem Nichtstun", doc.getElementById("toast").textContent.includes("Ziel-Kapitel"));

  // ===================== Übernehmen mit Zielauswahl =====================
  const targetSelect = orphanCard.querySelector(".manual-orphan-target-select");
  targetSelect.value = "Kapitel 1: Neue Struktur";
  fire(orphanCard, "change");
  fire(orphanCard.querySelector('[data-manual-orphan-action="apply"]'), "click");
  await wait(30);

  check("Orphan-Bereich nach Übernahme wieder ausgeblendet", doc.getElementById("manual-orphans-wrap").hidden);
  check("Altes 'Kapitel 7' nicht mehr in der Kapitelliste", !doc.getElementById("manual-chapters-list").textContent.includes("Kapitel 7: Verträge im Alltag verwalten"));
  const newCard = doc.querySelector('[data-manual-chapter="Kapitel 1: Neue Struktur"]');
  check("Neues Kapitel 'Kapitel 1: Neue Struktur' jetzt mit dem übernommenen Text vorhanden", !!newCard);
  check("Übernommener Text identisch zum ursprünglich erzeugten Text", !!newCard && newCard.querySelector("textarea").value === originalText);
  check("Protokoll vermerkt die Übernahme", doc.getElementById("log-list").textContent.includes("übernommen"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE KAPITEL-AUSTAUSCH-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
