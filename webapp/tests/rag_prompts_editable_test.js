// Einstellungen: editierbare RAG-Prompts. Die bisher fest im Code
// verdrahteten Anweisungstexte fuer die 3 RAG-Schritte (Erzeugen,
// Batch-Zusammenfuehrung, Uebersetzen - 5 Prompts insgesamt) sind jetzt
// Konfiguration wie Punkte-System/Labels/Farbschema: frei editierbar,
// mit "Zurücksetzen" auf den Standardtext, persistiert ueber
// Sitzung speichern/laden, wirkt sich auf den naechsten sample()-Aufruf aus.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
let sampleImpl = async (input, opts) => {
  sampleCalls.push({ input, opts });
  return { text: "Generierter Text.", truncated: false, modelTierApplied: "default" };
};
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
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
function setValue(el, v) { el.value = v; fire(el, "input"); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>RPE-1</key><summary>Testticket für Prompt-Test</summary>
      <description>Rohdaten zum Prüfen des editierbaren Prompts.</description>
      <status>Offen</status><type>Task</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Prompt Domain</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "rag_prompts_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Einstellungen: 5 Prompt-Editoren mit Standardtext =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const textareas = Array.from(doc.querySelectorAll(".ragprompt-textarea"));
  check("Genau 8 editierbare RAG-Prompts vorhanden (inkl. Benutzerhandbuch-Kapitel + Zusammenführung + Handbuch-Vergleich)", textareas.length === 8);
  const summaryTa = doc.querySelector('.ragprompt-textarea[data-ragprompt-key="summary"]');
  check("Zusammenfassungs-Prompt initial mit Standardtext befüllt", summaryTa.value.includes("prägnanten, endnutzergerechten Zusammenfassung"));
  const summaryBlock = summaryTa.closest(".ragprompt-block");
  check("Badge zeigt initial 'Standard'", summaryBlock.querySelector(".override-badge").textContent === "Standard");
  check("'Zurücksetzen'-Button initial deaktiviert (kein Override)", summaryBlock.querySelector("[data-ragprompt-reset]").disabled === true);

  // ===================== Prompt anpassen: Badge/Reset-Button reagieren live =====================
  const customPrompt = "Fasse die Tickets als Piratenkapitän in Reimform zusammen:";
  setValue(summaryTa, customPrompt);
  check("Nach Bearbeitung: Badge zeigt 'angepasst'", summaryBlock.querySelector(".override-badge").textContent === "angepasst");
  check("Nach Bearbeitung: 'Zurücksetzen'-Button aktiviert", summaryBlock.querySelector("[data-ragprompt-reset]").disabled === false);

  // ===================== Angepasster Prompt wird tatsächlich an sample() übergeben =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="releaseversion"]').click();
  const importRadios = Array.from(doc.querySelectorAll('input[name="active-import-choice-4"]'));
  importRadios[importRadios.length - 1].checked = true;
  fire(importRadios[importRadios.length - 1], "change");
  await wait(50);
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  fire(doc.getElementById("rag-extract-btn"), "click");
  await wait(50);

  sampleCalls = [];
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(150);
  check("sample() wurde mit dem ANGEPASSTEN Prompt aufgerufen", sampleCalls.length === 1 && sampleCalls[0].input.includes(customPrompt));
  check("Angepasster Prompt ersetzt den Standardtext vollständig (nicht nur angehängt)", !sampleCalls[0].input.includes("prägnanten, endnutzergerechten Zusammenfassung"));
  check("Rohdaten (Ticket-Inhalte) werden weiterhin automatisch angehängt", sampleCalls[0].input.includes("Prompt Domain"));

  // ===================== Fließtext-Prompt bleibt unabhängig (eigener Default) =====================
  sampleCalls = [];
  fire(doc.getElementById("rag-generate-fliesstext-btn"), "click");
  await wait(150);
  check("Fließtext-Prompt weiterhin auf Standard (nur Zusammenfassung wurde angepasst)", sampleCalls[0].input.includes("Benutzerhandbuch"));

  // ===================== Zurücksetzen stellt den Standardtext wieder her =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.querySelector('.ragprompt-block [data-ragprompt-reset="summary"]'), "click");
  await wait(50);
  const summaryTaAfterReset = doc.querySelector('.ragprompt-textarea[data-ragprompt-key="summary"]');
  check("Nach 'Zurücksetzen': Textarea zeigt wieder den Standardtext", summaryTaAfterReset.value.includes("prägnanten, endnutzergerechten Zusammenfassung"));
  check("Nach 'Zurücksetzen': Badge wieder 'Standard'", summaryTaAfterReset.closest(".ragprompt-block").querySelector(".override-badge").textContent === "Standard");

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  sampleCalls = [];
  fire(doc.getElementById("rag-generate-summary-btn"), "click");
  await wait(150);
  check("Nach Zurücksetzen: sample() erhält wieder den Standard-Prompt", sampleCalls[0].input.includes("prägnanten, endnutzergerechten Zusammenfassung"));

  // ===================== Übersetzungs-Prompt ebenfalls editierbar und wirksam =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const translationTa = doc.querySelector('.ragprompt-textarea[data-ragprompt-key="translation"]');
  check("Übersetzungs-Prompt vorhanden mit Standardtext", !!translationTa && translationTa.value.includes("ins Englische"));
  setValue(translationTa, "Übersetze locker-flockig ins Englische:");
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="rag"]').click();
  await wait(50);
  sampleCalls = [];
  fire(doc.getElementById("rag-translate-btn"), "click");
  await wait(150);
  check("Übersetzung nutzt den angepassten Übersetzungs-Prompt", sampleCalls.length === 1 && sampleCalls[0].input.includes("locker-flockig"));

  // ===================== XSS-Schutz: Prompt-Text mit HTML-Sonderzeichen wird sicher gerendert =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const fliesstextTa = doc.querySelector('.ragprompt-textarea[data-ragprompt-key="fliesstext"]');
  setValue(fliesstextTa, '</textarea><img src=x onerror="window.__xss_ragprompt=true">');
  // Ein Reset AN ANDERER STELLE loest ein komplettes Neu-Rendern der Liste aus
  // (innerHTML-Ersetzung aller 5 Bloecke) - genau der Pfad, der den
  // gespeicherten Text erneut in HTML einbetten muss.
  fire(doc.querySelector('.ragprompt-block [data-ragprompt-reset="translation"]'), "click");
  await wait(50);
  check("Kein echtes <img>-Element im DOM nach Neu-Rendern (XSS-sicher escaped, nicht als Tag geparst)", !doc.getElementById("ragprompts-list").querySelector("img"));
  check("Kein window.__xss_ragprompt gesetzt (kein Script ausgeführt)", win.__xss_ragprompt === undefined);
  check("Fließtext-Textarea zeigt den rohen Text weiterhin korrekt (kein Datenverlust durch Escaping)",
    doc.querySelector('.ragprompt-textarea[data-ragprompt-key="fliesstext"]').value.includes("</textarea><img"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE RAG-PROMPT-EDITIER-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
