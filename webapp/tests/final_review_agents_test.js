// v2.123.0 FINAL Schritt 9: Gesamtdokument (Word + PDF) aus dem gewaehlten Stand und Review mit
// verschiedenen Agenten (wie Register Editor, Stufe 6): Struktur-Pruefung ohne KI, Inhalt & Qualitaet,
// Sprache & Stil, Konsistenz, Vollstaendigkeit; Auswahl, Stopp, Gesamtbericht anhaengen/exportieren,
// interne Mitteilungen nie im Dokument oder in Agenten-Prompts.
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
  if (p.includes("Du prüfst ein internes Dokument")) text = "INHALT-BERICHT: Kapitel 2 fehlt ein Schritt.";
  else if (p.includes("Prüfe das unten stehende Gesamtdokument sprachlich")) text = "STIL-BERICHT: Keine gefunden.";
  else if (p.includes("Vergleiche die Kapitel UNTEREINANDER")) text = "KONSISTENZ-BERICHT: Keine gefunden.";
  else if (p.includes("Nicht umgesetzte Verbesserungen")) text = "VOLLSTAENDIGKEIT-BERICHT: Keine gefunden.";
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
  const results = () => Array.from(doc.querySelectorAll("#final-review-results [data-final-review-result]"));
  const result = (k) => doc.querySelector('#final-review-results [data-final-review-result="' + k + '"]');
  async function build(name) {
    setVal("final-build-name-input", name);
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + name + "“"), 10000);
  }

  nav("final"); await wait(50);
  check("Schritt 9 steht am Ende von FINAL (nach Schritt 8 Design)", !!$("final-review-step") &&
    !!($("final-design-status-note").compareDocumentPosition($("final-review-step")) & win.Node.DOCUMENT_POSITION_FOLLOWING) &&
    $("final-review-step").textContent.includes("9. Gesamtdokument & Review mit Agenten"));
  check("Ohne Stand: Zusammenführen und Agenten deaktiviert", $("final-review-merge-btn").disabled && $("final-review-run-btn").disabled);
  const agentCbs = () => Array.from(doc.querySelectorAll("[data-final-review-agent]"));
  check("5 Agenten zur Auswahl, alle vorausgewählt", agentCbs().length === 5 && agentCbs().every((c) => c.checked) &&
    ["Struktur-Prüfung", "Inhalt & Qualität", "Sprache & Stil", "Kapitelübergreifende Konsistenz", "Vollständigkeit & Abdeckung"].every((t) => $("final-review-agents").textContent.includes(t)));

  const input = $("final-manual-file-input");
  Object.defineProperty(input, "files", { value: [new win.File([await buildDocx(
    heading("Kapitel 1: Verträge") + para("Verträge werden online geändert.") + para("[Bild]") +
    heading("Kapitel 2: Fahrzeuge") + para("Fahrzeuge werden im Fuhrpark angelegt."))], "h.docx")], configurable: true });
  fire(input, "change");
  await waitUntil(() => $("final-manuals-tbody").children.length === 1, 5000);
  await build("Release 1");
  setVal("final-reviewer-input", "Rita Redakteurin");

  // interne Mitteilung am Stand – darf nirgends auftauchen
  fire(versionRows()[0].querySelector("[data-final-version-notes]"), "click");
  setVal("final-note-new-title", "Idee");
  setVal("final-note-new-text", SECRET + " – Video ergänzen.");
  fire($("final-note-add-btn"), "click");

  check("Stand 'Release 1' im Schritt-9-Auswahlfeld, Zusammenführen aktiv", $("final-review-version-select").selectedOptions[0].textContent.includes("Release 1") && !$("final-review-merge-btn").disabled);

  // ===================== Gesamtdokument =====================
  fire($("final-review-merge-btn"), "click");
  await waitUntil(() => $("final-review-merge-note").textContent.includes("Seite"), 15000);
  const note = $("final-review-merge-note").textContent;
  check("Gesamtdokument zusammengeführt: 2 Kapitel, Seitenzahl der PDF-Fassung", note.startsWith("2 Kapitel") && /PDF: \d+ Seite/.test(note) && !$("final-review-merge-section").hidden);
  const preview = $("final-review-merge-preview").textContent;
  check("Vorschau mit beiden Kapiteln, ohne interne Mitteilung", preview.includes("## Kapitel 1: Verträge") && preview.includes("## Kapitel 2: Fahrzeuge") && !preview.includes(SECRET));
  savedFiles.length = 0;
  fire($("final-review-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const dz = savedFiles[0] ? await JSZipNode.loadAsync(await blobBuf(savedFiles[0].data)) : null;
  const dxml = dz ? await dz.file("word/document.xml").async("string") : "";
  check("Word-Gesamtdokument: Dateiname mit Stand, beide Kapitel, keine interne Mitteilung",
    savedFiles[0] && /^FINAL_Gesamtdokument_Release_1_.*\.docx$/.test(savedFiles[0].filename) && dxml.includes("Kapitel 1: Verträge") && dxml.includes("Fahrzeuge werden im Fuhrpark") && !dxml.includes(SECRET));
  fire($("final-review-pdf-btn"), "click");
  await waitUntil(() => savedFiles.length === 2, 5000);
  const pdfBuf = savedFiles[1] ? await blobBuf(savedFiles[1].data) : Buffer.alloc(0);
  check("PDF-Gesamtdokument heruntergeladen (%PDF, ohne interne Mitteilung)", savedFiles[1] && /\.pdf$/.test(savedFiles[1].filename) && pdfBuf.slice(0, 4).toString() === "%PDF" && !pdfBuf.toString("latin1").includes(SECRET));

  // ===================== Agenten =====================
  const styleCb = doc.querySelector('[data-final-review-agent="style"]');
  styleCb.checked = false; fire(styleCb, "change");
  prompts.length = 0;
  fire($("final-review-run-btn"), "click");
  await waitUntil(() => $("final-review-status").textContent.includes("Agent(en) ausgeführt"), 15000);
  check("4 ausgewählte Agenten ausgeführt (Sprache & Stil abgewählt)", $("final-review-status").textContent.startsWith("4 von 4 Agent(en) ausgeführt") && results().length === 4 && !result("style"));
  check("KI-Agenten: 3 Aufrufe (Struktur-Prüfung ohne KI)", prompts.length === 3);
  const st = result("structure") ? result("structure").textContent : "";
  check("Struktur-Prüfung: reale Seitenzahl, Kapitel, Screens-Lücke, ROVO, Inhaltsverzeichnis",
    /Gesamtdokument: \d+ Seite/.test(st) && st.includes("2 Kapitel") && st.includes("Kapitel 1: Verträge: 1 [Bild]-Platzhalter ohne Screen") &&
    st.includes("Keine offenen Verbesserungen") && st.includes("### Inhaltsverzeichnis") && st.includes("Hinweis(e)"));
  check("Inhalt & Qualität: Bericht angezeigt", result("content") && result("content").textContent.includes("INHALT-BERICHT"));
  check("Konsistenz: Bericht angezeigt", result("consistency") && result("consistency").textContent.includes("KONSISTENZ-BERICHT"));
  check("Vollständigkeit: Bericht angezeigt", result("completeness") && result("completeness").textContent.includes("VOLLSTAENDIGKEIT-BERICHT"));
  const pc = prompts.find((p) => p.includes("Du prüfst ein internes Dokument")) || "";
  const pv = prompts.find((p) => p.includes("Nicht umgesetzte Verbesserungen")) || "";
  check("Prompts enthalten Stand und Kapitel (Inhalt) bzw. Screens/Tickets/ROVO je Kapitel (Vollständigkeit)",
    pc.includes("DOKUMENT: Release 1") && pc.includes("## Kapitel 2: Fahrzeuge") && pv.includes("Zugeordnete Screens: 0") && pv.includes("Zugeordnete Tickets (0)") && pv.includes("Verbesserungen aus ROVO (0)"));
  check("Interne Mitteilung in keinem Agenten-Prompt", prompts.every((p) => !p.includes(SECRET)));
  check("Gesamtbericht-Aktionen sichtbar", !$("final-review-report-actions").hidden);

  // Gesamtbericht
  savedFiles.length = 0;
  fire($("final-review-report-md-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = savedFiles[0] ? (typeof savedFiles[0].data === "string" ? savedFiles[0].data : (await blobBuf(savedFiles[0].data)).toString("utf-8")) : "";
  check("Gesamtbericht als Markdown: alle Agenten-Abschnitte", md.startsWith("# Prüfbericht – Release 1") && md.includes("## Struktur-Prüfung (ohne KI)") && md.includes("## Inhalt & Qualität") && md.includes("KONSISTENZ-BERICHT") && md.includes("Rita Redakteurin"));
  fire($("final-review-attach-btn"), "click");
  const repBtn = versionRows()[0].querySelector("[data-final-version-report]");
  check("Gesamtbericht an Stand angehängt: 'Prüfbericht (1)' in den Ständen", !!repBtn && repBtn.textContent === "Prüfbericht (1)");
  savedFiles.length = 0;
  fire(repBtn, "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  const rz = savedFiles[0] ? await JSZipNode.loadAsync(await blobBuf(savedFiles[0].data)) : null;
  const rx = rz ? await rz.file("word/document.xml").async("string") : "";
  check("Angehängter Bericht als Word aus den Ständen abrufbar", rx.includes("INHALT-BERICHT") && rx.includes("Struktur-Prüfung"));

  // Erneuter Lauf eines Agenten + Stopp
  agentCbs().forEach((c) => { c.checked = c.getAttribute("data-final-review-agent") === "style"; fire(c, "change"); });
  slow = true;
  fire($("final-review-run-btn"), "click");
  await waitUntil(() => !$("final-review-stop-btn").hidden, 3000);
  check("Während des Laufs: Stopp sichtbar, Start gesperrt", !$("final-review-stop-btn").hidden && $("final-review-run-btn").disabled);
  fire($("final-review-stop-btn"), "click");
  await waitUntil(() => $("final-review-status").textContent.startsWith("Gestoppt"), 3000);
  check("Stopp bricht ab, bisherige Berichte bleiben", $("final-review-status").textContent.startsWith("Gestoppt – 0 von 1") && results().length === 4 && $("final-review-stop-btn").hidden);
  slow = false;
  fire($("final-review-select-all-btn"), "click");
  check("'Alle auswählen' setzt alle Agenten", agentCbs().every((c) => c.checked));

  // Wechsel des Stands setzt den Review zurueck
  await build("Release 2");
  check("Neuer Stand aktiv → Review-Ergebnisse und Gesamtdokument zurückgesetzt", $("final-review-version-select").selectedOptions[0].textContent.includes("Release 2") && results().length === 0 && $("final-review-merge-section").hidden && $("final-review-report-actions").hidden);
  setVal("final-review-version-select", String(versionRows().length && doc.querySelector('#final-review-version-select option').value));
  check("Auswahl im Schritt-9-Feld setzt den aktiven Stand (auch Schritt 7/8)", $("final-result-version-select").value === $("final-review-version-select").value && $("final-design-version-select").value === $("final-review-version-select").value);

  // Editor
  fire($("final-review-editor-btn"), "click");
  check("'Stand im Editor optimieren' öffnet das Register Editor", !doc.querySelector('[data-view-panel="edito"]').hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-REVIEW-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
