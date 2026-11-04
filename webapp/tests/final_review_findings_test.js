// v2.124.0 FINAL Schritt 9: Review-Befunde uebernehmen – Stichpunkte der KI-Berichte mit erkanntem
// Kapitel als Verbesserungen (Status offen, Editor-Agent "Verbesserungen einarbeiten") oder als interne
// Mitteilung "Offene Punkte"; Sperre veroeffentlichter Staende; Review-Ergebnisse je Stand gespeichert.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });
const savedFiles = [];
const prompts = [];
let slow = false;
async function sample(input, opts) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (slow) {
    await new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      if (sig) sig.addEventListener("abort", () => reject(Object.assign(new Error("abgebrochen"), { code: "cancelled" })));
      setTimeout(resolve, 5000);
    });
  }
  let text = "SONSTIGES";
  if (p.includes("KAPITELTEXT:")) text = p.slice(p.indexOf("KAPITELTEXT:\n") + 13);
  else if (p.includes("Du prüfst ein internes Dokument")) text = "Kapitel 1: Verträge\n- Der Schritt zum Speichern fehlt.\n- Begriff 'Vertrag' uneinheitlich.\n**Kapitel 2: Fahrzeuge**\n- Fahrzeugklasse wird nicht erklärt.\n\nGesamtempfehlung: Entwurf";
  else if (p.includes("Prüfe das unten stehende Gesamtdokument sprachlich")) text = "### Rechtschreibung & Grammatik\n- Kapitel 1: Verträge – „wird geändert“ statt „werden geändert“.\n\n### Einheitliche Begriffe\nKeine gefunden.";
  else if (p.includes("Vergleiche die Kapitel UNTEREINANDER")) text = "### Widersprüche zwischen Kapiteln\n- Keine gefunden.\n\n### Redundanzen zwischen Kapiteln\nKeine gefunden.";
  else if (p.includes("Nicht umgesetzte Verbesserungen")) text = "### Nicht umgesetzte Verbesserungen\nKeine gefunden.\n\n### Lücken im Ablauf\n- Fahrzeuge: Voraussetzung Berechtigung fehlt.\n- Allgemein: Glossar fehlt.";
  return { text, truncated: false };
}
sample.json = async () => ({});
sample.limits = async () => ({ images: false });
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : name === "sample" ? sample : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function buildDocx(body) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type: "nodebuffer" });
}
const heading = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const para = (t) => "<w:p><w:r><w:t>" + esc(t) + "</w:t></w:r></w:p>";
const SECRET = "INTERNE-NOTIZ-5150";
async function blobBuf(d) { return Buffer.from(await d.arrayBuffer()); }

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, el.tagName === "SELECT" ? "change" : "input"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const versionRows = () => Array.from(doc.querySelectorAll("#final-versions-tbody tr"));
  const fRows = () => Array.from(doc.querySelectorAll("#final-review-findings-tbody tr"));
  const fRow = (txt) => fRows().find((r) => r.textContent.includes(txt));
  const results = () => Array.from(doc.querySelectorAll("#final-review-results [data-final-review-result]"));
  async function build(name) {
    setVal("final-build-name-input", name);
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
  }
  async function runAgents() {
    $("final-review-status").textContent = "";
    fire($("final-review-run-btn"), "click");
    await waitUntil(() => $("final-review-status").textContent.includes("Agent(en) ausgeführt"), 15000);
  }
  async function session() {
    savedFiles.length = 0;
    fire($("session-export-btn"), "click");
    await waitUntil(() => savedFiles.length > 0, 5000);
    return JSON.parse(savedFiles[0].data);
  }
  const mark = (row) => { const cb = row.querySelector("[data-final-finding-cb]"); cb.checked = true; fire(cb, "change"); };
  const CH1 = "Kapitel 1: Verträge", CH2 = "Kapitel 2: Fahrzeuge";

  nav("final"); await wait(50);
  const input = $("final-manual-file-input");
  Object.defineProperty(input, "files", { value: [new win.File([await buildDocx(
    heading(CH1) + para("Verträge werden online geändert.") + para("[Bild]") +
    heading(CH2) + para("Fahrzeuge werden im Fuhrpark angelegt."))], "h.docx")], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("final-manuals-tbody").children.length === 1, 5000);
  await build("Release 1");
  check("Vor dem Review: keine Befunde-Tabelle", $("final-review-findings").hidden);
  await runAgents();

  // ===================== Befunde =====================
  check("Befunde aus den KI-Berichten: 6 Stichpunkte ('Keine gefunden.' und Struktur-Prüfung ausgenommen)", !$("final-review-findings").hidden && $("final-review-findings-count").textContent === "6" && fRows().length === 6);
  const chOf = (txt) => fRow(txt) ? fRow(txt).querySelector("[data-final-finding-chapter]").value : null;
  check("Kapitel aus Kontextzeile erkannt (auch fett formatiert)", chOf("Der Schritt zum Speichern fehlt.") === CH1 && chOf("Begriff 'Vertrag'") === CH1 && chOf("Fahrzeugklasse") === CH2);
  check("Kapitel aus Kurzname im Stichpunkt erkannt, Präfix entfernt", chOf("Voraussetzung Berechtigung fehlt.") === CH2 && !fRow("Voraussetzung").querySelector("td:last-child").textContent.startsWith("Fahrzeuge"));
  check("Stichpunkt mit vollem Kapiteltitel: Kapitel erkannt, Text ohne Titel", chOf("statt „werden geändert“") === CH1 && fRow("statt „werden").querySelector("td:last-child").textContent.startsWith("„wird geändert“"));
  check("Befund ohne Kapitel: '– ohne Kapitel –'", chOf("Glossar fehlt.") === "");
  check("Agent je Befund angezeigt", fRow("Fahrzeugklasse").textContent.includes("Inhalt & Qualität") && fRow("Glossar").textContent.includes("Vollständigkeit & Abdeckung"));
  check("Übernehmen erst nach Markieren aktiv", $("final-review-adopt-imp-btn").disabled && $("final-review-adopt-note-btn").disabled);

  mark(fRow("Der Schritt zum Speichern fehlt.")); mark(fRow("Fahrzeugklasse")); mark(fRow("Glossar fehlt."));
  check("3 markiert → Buttons aktiv, 'alle' teilweise", !$("final-review-adopt-imp-btn").disabled && $("final-review-findings-all").indeterminate);
  fire($("final-review-adopt-imp-btn"), "click");
  check("Als Verbesserungen übernommen: 2, 1 ohne Kapitel übersprungen", $("final-review-findings-note").textContent.startsWith("2 Befund(e) als Verbesserung übernommen") && $("final-review-findings-note").textContent.includes("1 ohne Kapitel übersprungen"));
  check("Übernommene Befunde markiert und gesperrt", fRow("Der Schritt zum Speichern").textContent.includes("als Verbesserung übernommen") && fRow("Fahrzeugklasse").querySelector("[data-final-finding-cb]").disabled);
  let ses = await session();
  let v1 = ses.final.versions[0];
  check("Stand: Verbesserungen je Kapitel mit Herkunft und Status 'offen'",
    v1.improvements[CH1].includes("[Review – Inhalt & Qualität] Der Schritt zum Speichern fehlt.") && v1.improvements[CH2].includes("[Review – Inhalt & Qualität] Fahrzeugklasse wird nicht erklärt.") &&
    v1.improvementStatus[CH1][0] === "offen" && v1.improvementStatus[CH2].length === v1.improvements[CH2].length);
  check("Schritt 7 zeigt die Verbesserung beim Kapitel", $("final-result-master-output").textContent.includes("Der Schritt zum Speichern fehlt."));

  // Kapitel umstellen + Uebernahme
  const st = fRow("statt „werden");
  const chSel = st.querySelector("[data-final-finding-chapter]"); chSel.value = CH2; fire(chSel, "change");
  mark(fRow("statt „werden"));
  fire($("final-review-adopt-imp-btn"), "click");
  ses = await session(); v1 = ses.final.versions[0];
  check("Geändertes Kapitel wird übernommen (Kapitel 2)", v1.improvements[CH2].some((t) => t.startsWith("[Review – Sprache & Stil] „wird geändert“")) && !(v1.improvements[CH1] || []).some((t) => t.includes("werden geändert")));
  check("Doppelte Übernahme ausgeschlossen (Zeile gesperrt)", fRow("statt „werden").querySelector("[data-final-finding-cb]").disabled);

  // Als interne Mitteilung
  check("Befund ohne Kapitel bleibt markiert", fRow("Glossar fehlt.").querySelector("[data-final-finding-cb]").checked);
  fire($("final-review-adopt-note-btn"), "click");
  check("Als interne Mitteilung gespeichert: Button 'Mitteilungen (1)'", versionRows()[0].querySelector("[data-final-version-notes]").textContent.startsWith("Mitteilungen (1)"));
  ses = await session(); v1 = ses.final.versions[0];
  check("Mitteilung 'Offene Punkte' mit Befund, Agent und Intervall wöchentlich", v1.notes.length === 1 && v1.notes[0].category === "Offene Punkte" && v1.notes[0].text.includes("Glossar fehlt. (Vollständigkeit & Abdeckung)") && v1.notes[0].intervalDays === 7);
  check("Interne Mitteilung nicht als Verbesserung im Dokument", !JSON.stringify(v1.improvements).includes("Glossar") && !JSON.stringify(v1.chapters).includes("Glossar"));

  // Struktur-Pruefung erkennt die offenen Verbesserungen
  doc.querySelectorAll("[data-final-review-agent]").forEach((c) => { c.checked = c.getAttribute("data-final-review-agent") === "structure"; fire(c, "change"); });
  await runAgents();
  const stxt = doc.querySelector('[data-final-review-result="structure"]').textContent;
  check("Struktur-Prüfung zählt die übernommenen Verbesserungen als offen", stxt.includes("⚠ 3 Verbesserung(en) noch offen") && stxt.includes(CH2 + ": 2 von 2 offen"));

  // Editor-Agent arbeitet die Review-Verbesserungen ein
  prompts.length = 0;
  fire($("final-review-editor-btn"), "click");
  await wait(50);
  fire($("edito-final-agent-improve-btn"), "click");
  await waitUntil(() => /Kapitel optimiert/.test($("edito-final-agent-status").textContent), 10000);
  const ip = prompts.find((p) => p.includes("KAPITEL: " + CH2)) || "";
  check("Editor 'Verbesserungen einarbeiten' erhält die Review-Befunde je Kapitel", prompts.length === 2 && ip.includes("- [Review – Inhalt & Qualität] Fahrzeugklasse wird nicht erklärt.") && ip.includes("[Review – Sprache & Stil]"));

  // Sperre veroeffentlichter Staende
  nav("final"); await wait(30);
  setVal("final-reviewer-input", "A. Muster");
  let s0 = versionRows()[0].querySelector("[data-final-version-status]"); s0.value = "Veröffentlicht"; fire(s0, "change"); await wait(80);
  mark(fRow("Begriff 'Vertrag'"));
  fire($("final-review-adopt-imp-btn"), "click");
  ses = await session(); v1 = ses.final.versions[0];
  check("Veröffentlichter Stand: Übernahme als Verbesserung gesperrt", $("toast").textContent.includes("veröffentlicht") && !v1.improvements[CH1].some((t) => t.includes("Begriff")));

  // ===================== Review-Ergebnisse je Stand =====================
  check("Review-Ergebnisse am Stand gespeichert (Sitzung)", v1.lastReview && v1.lastReview.results.content && v1.lastReview.results.structure && /\d/.test(v1.lastReview.at));
  await build("Release 2");
  check("Neuer Stand: keine Ergebnisse, keine Befunde", results().length === 0 && $("final-review-findings").hidden);
  const rs = $("final-review-version-select");
  rs.value = String(v1.id); fire(rs, "change");
  check("Zurück zu Release 1: gespeicherte Ergebnisse wiederhergestellt", results().length === 5 && $("final-review-status").textContent.startsWith("Gespeicherte Review-Ergebnisse vom") && !$("final-review-findings").hidden);
  check("Übernahme-Markierungen bleiben sichtbar", fRow("Fahrzeugklasse").textContent.includes("als Verbesserung übernommen"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE REVIEW-BEFUNDE-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
