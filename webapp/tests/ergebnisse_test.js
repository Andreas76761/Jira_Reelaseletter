// Neues Register "Ergebnisse" (Nav direkt nach Benutzerhandbuch): Übersicht
// ALLER im Benutzerhandbuch-Kapitel-Generator erzeugten Dokumente - Haupttext
// UND jede vorhandene Verbesserungs-Variante (Enduser-Text/Fachtext/
// Kurzfassung, s. MANUAL_IMPROVE_VARIANTS) je Kapitel als eigene Zeile, mit
// Datum/Kapitel/Typ/Status (Steuerung&KPI-Prüf-Gate) sowie Export je
// Dokument als Markdown/Word. Zusätzlich eine Designvorlagen-Vorschau
// (Farb-/Icon-Legende der im Word-/PDF-Export bereits fest hinterlegten
// Rollen-/Tag-Gestaltung).
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

const savedFiles = [];
let sampleImpl = async (input) => {
  if (input.indexOf("KPI-Definitionen") !== -1) {
    return { text: "QUELLENABDECKUNG: 90\nPRUEF_ERFUELLUNGSQUOTE: 85\nKRITISCHE_BEFUNDE: 0\nGATE: Erfüllt\nBEGRUENDUNG: Passt.", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("Lektor/Qualitätsprüfer") !== -1) {
    return { text: "### Grammatikfehler\n- keine\n\n### Lücken\n- keine\n\n### Verbesserungsvorschläge\n- keine", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("ENDANWENDERS") !== -1) {
    return { text: "So nutzt du die Funktion ganz einfach.", truncated: false, modelTierApplied: "default" };
  }
  return {
    text: "Dieses Kapitel führt in den Vertragsprozess ein, mit mehreren Sätzen für eine sinnvolle Wortanzahl.",
    truncated: false, modelTierApplied: "default",
  };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
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
    await wait(15);
  }
  return false;
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>ERG-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
    <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
    <status>Fertig</status><type>Feature</type>
    <customfields><customfield><customfieldname>Domain</customfieldname>
    <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
    </customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Nav-Punkt "Ergebnisse" direkt nach Benutzerhandbuch =====================
  const navItems = Array.from(doc.querySelectorAll(".nav-item[data-view]"));
  const bhIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "benutzerhandbuch");
  const ergIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "ergebnisse");
  check("Nav-Punkt 'Ergebnisse' vorhanden", ergIdx !== -1);
  check("'Ergebnisse' steht direkt nach 'Benutzerhandbuch' in der Navigation", ergIdx === bhIdx + 1);

  // ===================== Vor Kapitel-Erzeugung: leere Übersicht =====================
  doc.querySelector('.nav-item[data-view="ergebnisse"]').click();
  await wait(50);
  check("Panel 'Ergebnisse' sichtbar nach Klick", !doc.querySelector('[data-view-panel="ergebnisse"]').hidden);
  check("Leer-Hinweis initial sichtbar (keine Dokumente)", !doc.getElementById("ergebnisse-empty").hidden);
  check("Übersichtstabelle initial leer", doc.getElementById("ergebnisse-tbody").children.length === 0);

  // ===================== Designvorlagen-Vorschau unabhängig von Daten sichtbar =====================
  const designTbody = doc.getElementById("ergebnisse-design-tbody");
  check("Designvorlagen-Tabelle zeigt 12 Zeilen (5 Rollen + 7 Tags)", designTbody.querySelectorAll("tr").length === 12);
  check("Designvorlagen-Vorschau zeigt Word-Hex-Farbwert", designTbody.textContent.includes("#FBEDD9") || designTbody.textContent.includes("#"));
  check("Designvorlagen-Vorschau zeigt PDF-RGB-Farbwert", designTbody.textContent.includes("rgb("));
  check("Retail-Icon in der Designvorlagen-Vorschau vorhanden", designTbody.textContent.includes("◆"));

  // ===================== Kapitel erzeugen (Haupttext + automatische KPI-Bewertung) =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "ergebnisse_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(domainSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  for (let waited = 0; waited < 5000 && doc.getElementById("manual-chapters-list").children.length === 0; waited += 100) await wait(100);
  await wait(50);
  const title = "Kapitel 7: Verträge im Alltag verwalten";
  check("Kapitel erzeugt", doc.getElementById("manual-chapters-list").textContent.includes(title));

  // ===================== Übersicht zeigt den Haupttext mit Datum/Kapitel/Typ/Status =====================
  doc.querySelector('.nav-item[data-view="ergebnisse"]').click();
  await wait(50);
  check("Leer-Hinweis nach Erzeugung ausgeblendet", doc.getElementById("ergebnisse-empty").hidden);
  let rows = Array.from(doc.querySelectorAll("#ergebnisse-tbody tr"));
  check("Genau 1 Zeile (nur Haupttext, noch keine Varianten)", rows.length === 1);
  check("Zeile zeigt das Kapitel", rows[0].textContent.includes(title));
  check("Zeile zeigt den Typ 'Haupttext'", rows[0].textContent.includes("Haupttext (Benutzerhandbuch)"));
  check("Zeile zeigt den Status 'Erfüllt' (automatische KPI-Bewertung, Gate)", rows[0].textContent.includes("Erfüllt"));
  check("Zeile hat ein Datum (nicht leer)", /\d/.test(rows[0].querySelector("td").textContent));

  // ===================== Export des Haupttextes aus der Übersicht =====================
  const haupttextMdBtn = rows[0].querySelector('[data-ergebnisse-export="md"]');
  fire(haupttextMdBtn, "click");
  await wait(100);
  check("Export 'Als Markdown' für den Haupttext ausgelöst", savedFiles.some((f) => f.filename && f.filename.endsWith(".md") && !f.filename.includes("Enduser")));

  // ===================== Qualitätsprüfung + Enduser-Variante erzeugen =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const card = doc.querySelector('[data-manual-chapter="' + title + '"]');
  fire(card.querySelector('[data-manual-action="quality-check"]'), "click");
  await waitUntil(() => !!card.querySelector(".manual-kpi-dashboard"), 3000);
  await wait(50);
  fire(card.querySelector('[data-manual-improve="enduser"]'), "click");
  await waitUntil(() => !!card.querySelector('[data-manual-improve-result="enduser"] p'), 3000);
  await wait(50);

  // ===================== Übersicht zeigt jetzt 2 Zeilen (Haupttext + Enduser-Variante) =====================
  doc.querySelector('.nav-item[data-view="ergebnisse"]').click();
  await wait(50);
  rows = Array.from(doc.querySelectorAll("#ergebnisse-tbody tr"));
  check("Nach Erzeugen der Enduser-Variante: 2 Zeilen in der Übersicht", rows.length === 2);
  const variantRow = rows.find((r) => r.textContent.includes("Enduser-Text"));
  check("Enduser-Variante erscheint mit eigenem Typ und Icon", !!variantRow && variantRow.textContent.includes("☆"));
  check("Enduser-Variante zeigt ebenfalls den Status 'Erfüllt' (gleiches Kapitel-Gate)", !!variantRow && variantRow.textContent.includes("Erfüllt"));

  // ===================== Export der Enduser-Variante (neue Export-Funktion) =====================
  savedFiles.length = 0;
  fire(variantRow.querySelector('[data-ergebnisse-export="docx"]'), "click");
  await wait(150);
  check("Export 'Als Word' für die Enduser-Variante ausgelöst", savedFiles.some((f) => f.filename && f.filename.endsWith(".docx") && f.filename.includes("Enduser")));
  savedFiles.length = 0;
  fire(variantRow.querySelector('[data-ergebnisse-export="md"]'), "click");
  await wait(100);
  check("Export 'Als Markdown' für die Enduser-Variante ausgelöst", savedFiles.some((f) => f.filename && f.filename.endsWith(".md") && f.filename.includes("Enduser")));

  // ===================== Kapitel löschen -> Übersicht wieder leer =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  fire(doc.querySelector('[data-manual-chapter="' + title + '"] [data-manual-action="delete"]'), "click");
  await wait(50);
  doc.querySelector('.nav-item[data-view="ergebnisse"]').click();
  await wait(50);
  check("Nach Löschen des Kapitels: Übersicht wieder leer", doc.getElementById("ergebnisse-tbody").children.length === 0);
  check("Leer-Hinweis nach Löschen wieder sichtbar", !doc.getElementById("ergebnisse-empty").hidden);

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE ERGEBNISSE-REGISTER-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
