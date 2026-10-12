// Benutzerhandbuch-Kapitel-Generator: Qualitätsprüfung-Mini-Dashboard (KPI +
// Wortanzahl) sowie 3 Verbesserungs-Varianten-Buttons (Enduser-Text/
// Fachtext/Kurzfassung, s. MANUAL_IMPROVE_VARIANTS). Jede Variante schreibt
// den Kapiteltext für eine andere Zielgruppe neu, arbeitet dabei die
// Verbesserungsvorschläge der Qualitätsprüfung ein und landet in einer
// NEUEN, separaten, farblich markierten Textbox - der Originaltext bleibt
// dabei unverändert. Außerdem: die 3 zugehörigen Prompts + Icon-/Farblegende
// sind unter Einstellungen -> Design editierbar/sichtbar (geteilter Zustand
// mit der allgemeinen RAG-Prompts-Liste, s. rag_prompts_editable_test.js).
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

let sampleCalls = [];
const QC_SUGGESTION = "Füge ein konkretes Beispiel hinzu, das die Bedienung veranschaulicht.";
let sampleImpl = async (input) => {
  sampleCalls.push(input);
  if (input.indexOf("KPI-Definitionen") !== -1) {
    return { text: "QUELLENABDECKUNG: 95\nPRUEF_ERFUELLUNGSQUOTE: 80\nKRITISCHE_BEFUNDE: 1\nGATE: Erfüllt\nBEGRUENDUNG: Passt.", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("Lektor/Qualitätsprüfer") !== -1) {
    return { text: "### Grammatikfehler\n- keine\n\n### Lücken\n- Es fehlt ein Hinweis zur Freigabe.\n\n### Verbesserungsvorschläge\n- " + QC_SUGGESTION, truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("ENDANWENDERS") !== -1) {
    return { text: "## Retail\nSo einfach nutzt du die Funktion. [Hinweis] Spar dir Zeit beim Anlegen.", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("PRÄZISEN FACHTEXT") !== -1) {
    return { text: "## HQ\nFeld Vertragsstatus wird auf 'Aktiv' gesetzt. [Verweis] Siehe Kapitel 2.", truncated: false, modelTierApplied: "default" };
  }
  if (input.indexOf("STARK KOMPRIMIERTE MANAGEMENT-ZUSAMMENFASSUNG") !== -1) {
    return { text: "Kernaussage: Der Vertragsprozess ist jetzt vollständig digital abgebildet.", truncated: false, modelTierApplied: "default" };
  }
  return {
    text: "Dieses Kapitel führt in den Vertragsprozess ein. Es beschreibt mehrere Schritte im operativen Tagesgeschäft, damit eine sinnvolle Wortanzahl entsteht.",
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
    await wait(15);
  }
  return false;
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>IMP-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
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

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "improve_variants_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Kapitel erzeugen (Generierung + automatische KPI-Bewertung) =====================
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
  function card() { return doc.querySelector('[data-manual-chapter="' + title + '"]'); }

  // ===================== Vor Qualitätsprüfung: kein Dashboard, keine Varianten-Buttons =====================
  check("Vor Qualitätsprüfung: kein KPI-Dashboard sichtbar", !card().querySelector(".manual-kpi-dashboard"));
  check("Vor Qualitätsprüfung: keine Verbesserungs-Varianten-Buttons sichtbar", !card().querySelector("[data-manual-improve]"));

  // ===================== Qualitätsprüfung ausführen =====================
  fire(card().querySelector('[data-manual-action="quality-check"]'), "click");
  await waitUntil(() => !!card().querySelector(".manual-kpi-dashboard"), 3000);
  await wait(50);

  // ===================== Dashboard zeigt KPI + Wortanzahl =====================
  const dashboard = card().querySelector(".manual-kpi-dashboard");
  check("Dashboard nach Qualitätsprüfung sichtbar", !!dashboard);
  check("Dashboard zeigt Wortanzahl", /\d+\s*<\/b>\s*Wörter/.test(dashboard.innerHTML));
  check("Dashboard zeigt Quellenabdeckung 95%", dashboard.textContent.includes("95%"));
  check("Dashboard zeigt Prüf-Erfüllungsquote 80%", dashboard.textContent.includes("80%"));
  check("Dashboard zeigt Kritische Befunde 1", dashboard.textContent.includes("1"));
  check("Dashboard zeigt Gate 'Erfüllt'", dashboard.textContent.includes("Erfüllt"));

  // ===================== 3 Verbesserungs-Varianten-Buttons vorhanden =====================
  const enduserBtn = card().querySelector('[data-manual-improve="enduser"]');
  const fachtextBtn = card().querySelector('[data-manual-improve="fachtext"]');
  const kurzfassungBtn = card().querySelector('[data-manual-improve="kurzfassung"]');
  check("Button 'Enduser-Text' vorhanden", !!enduserBtn && enduserBtn.textContent.includes("Enduser-Text erzeugen"));
  check("Button 'Fachtext' vorhanden", !!fachtextBtn && fachtextBtn.textContent.includes("Fachtext erzeugen"));
  check("Button 'Kurzfassung' vorhanden", !!kurzfassungBtn && kurzfassungBtn.textContent.includes("Kurzfassung erzeugen"));

  // ===================== Variante 1: Enduser-Text =====================
  fire(enduserBtn, "click");
  await waitUntil(() => !!card().querySelector('[data-manual-improve-result="enduser"] .callout'), 3000);
  await wait(50);
  const enduserResult = card().querySelector('[data-manual-improve-result="enduser"]');
  check("Enduser-Variante erzeugt eigene Textbox", !!enduserResult && enduserResult.innerHTML.includes("Spar dir Zeit"));
  check("Enduser-Variante mit grüner Rahmenfarbe (var(--done))", enduserResult.innerHTML.includes("var(--done)"));
  check("Enduser-Variante zeigt Hinweis-Icon (ℹ️) für den [Hinweis]-Tag", enduserResult.innerHTML.includes("ℹ️"));
  check("Button-Beschriftung wechselt auf 'neu erzeugen'", card().querySelector('[data-manual-improve="enduser"]').textContent.includes("Enduser-Text neu erzeugen"));
  check("Originaltext (Deutsch) bleibt unverändert", card().querySelector(".manual-chapter-textarea[data-lang='de']").value.indexOf("Spar dir Zeit") === -1);

  // ===================== Variante 2: Fachtext =====================
  fire(fachtextBtn, "click");
  await waitUntil(() => !!card().querySelector('[data-manual-improve-result="fachtext"] .callout'), 3000);
  await wait(50);
  const fachtextResult = card().querySelector('[data-manual-improve-result="fachtext"]');
  check("Fachtext-Variante erzeugt eigene Textbox", !!fachtextResult && fachtextResult.innerHTML.includes("Vertragsstatus"));
  check("Fachtext-Variante mit violetter Rahmenfarbe (var(--backlog))", fachtextResult.innerHTML.includes("var(--backlog)"));
  check("Fachtext-Variante zeigt Verweis-Icon (🔗) für den [Verweis]-Tag", fachtextResult.innerHTML.includes("🔗"));

  // ===================== Variante 3: Kurzfassung =====================
  fire(kurzfassungBtn, "click");
  await waitUntil(() => !!card().querySelector('[data-manual-improve-result="kurzfassung"] p'), 3000);
  await wait(50);
  const kurzfassungResult = card().querySelector('[data-manual-improve-result="kurzfassung"]');
  check("Kurzfassung-Variante erzeugt eigene Textbox", !!kurzfassungResult && kurzfassungResult.innerHTML.includes("vollständig digital"));
  check("Kurzfassung-Variante mit oranger Rahmenfarbe (var(--progress))", kurzfassungResult.innerHTML.includes("var(--progress)"));

  // ===================== Verbesserungsvorschläge der Qualitätsprüfung werden eingearbeitet =====================
  const enduserPrompt = sampleCalls.filter((c) => c.indexOf("ENDANWENDERS") !== -1)[0];
  check("Enduser-Prompt enthält die Verbesserungsvorschläge aus der Qualitätsprüfung", !!enduserPrompt && enduserPrompt.indexOf(QC_SUGGESTION) !== -1);
  check("Alle 3 Varianten + Qualitätsprüfung + Generierung + KPI-Bewertung = 6 Claude-Aufrufe", sampleCalls.length === 6);

  // ===================== Einstellungen -> Design: Prompts + Icon-/Farblegende =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="design"]'), "click");
  await wait(30);
  const legend = doc.getElementById("manual-improve-design-legend");
  check("Design-Legende zeigt 3 Einträge (Enduser/Fachtext/Kurzfassung)", legend.querySelectorAll(".chip").length === 3);
  check("Design-Legende zeigt Icons", legend.textContent.includes("😊") && legend.textContent.includes("🛠️") && legend.textContent.includes("⚡"));
  const designPrompts = doc.getElementById("manual-improve-design-prompts");
  const designTextareas = Array.from(designPrompts.querySelectorAll(".ragprompt-textarea"));
  check("Design-Sektion zeigt genau 3 editierbare Prompts", designTextareas.length === 3);
  const enduserDesignTa = designPrompts.querySelector('[data-ragprompt-key="manualImproveEnduser"]');
  check("Enduser-Prompt in Design-Sektion mit Standardtext befüllt", enduserDesignTa.value.includes("ENDANWENDERS"));
  check("Badge zeigt initial 'Standard'", enduserDesignTa.closest(".ragprompt-block").querySelector(".override-badge").textContent === "Standard");

  // ===================== Anpassung in Design-Sektion synchronisiert mit der allgemeinen RAG-Prompts-Liste =====================
  const customPrompt = "Schreibe die Enduser-Fassung als Kapitän zur See:";
  setValue(enduserDesignTa, customPrompt);
  check("Nach Bearbeitung: Badge zeigt 'angepasst'", enduserDesignTa.closest(".ragprompt-block").querySelector(".override-badge").textContent === "angepasst");
  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="ki-text"]'), "click");
  await wait(30);
  const ragListTa = doc.querySelector('#ragprompts-list [data-ragprompt-key="manualImproveEnduser"]');
  check("Änderung in der Design-Sektion erscheint auch in der allgemeinen RAG-Prompts-Liste (geteilter Zustand)", ragListTa.value === customPrompt);

  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="design"]'), "click");
  await wait(30);
  fire(doc.querySelector('#manual-improve-design-prompts [data-ragprompt-reset="manualImproveEnduser"]'), "click");
  await wait(30);
  const enduserDesignTaAfterReset = doc.querySelector('#manual-improve-design-prompts [data-ragprompt-key="manualImproveEnduser"]');
  check("Nach 'Zurücksetzen' in der Design-Sektion: Badge wieder 'Standard'", enduserDesignTaAfterReset.closest(".ragprompt-block").querySelector(".override-badge").textContent === "Standard");
  fire(doc.querySelector('#einstellungen-tabs .import-tab[data-esub="ki-text"]'), "click");
  await wait(30);
  check("Zurücksetzen auch in der allgemeinen RAG-Prompts-Liste sichtbar", doc.querySelector('#ragprompts-list [data-ragprompt-key="manualImproveEnduser"]').value.includes("ENDANWENDERS"));

  check("Kein unbehandelter JS-Fehler während der gesamten Interaktion", errors.length === 0);

  const passed = checks.filter((c) => c[1]).length;
  console.log(`\n${passed}/${checks.length} bestanden`);
  if (passed === checks.length) {
    console.log("ALLE VERBESSERUNGS-VARIANTEN-TESTS BESTANDEN");
    process.exit(0);
  } else {
    console.log("FEHLGESCHLAGENE PRÜFUNGEN:");
    checks.filter((c) => !c[1]).forEach((c) => console.log("  - " + c[0]));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
