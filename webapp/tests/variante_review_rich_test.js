// v2.139.0 VARIANTE Dokument-Review: Formatierung des Entwurfs bleibt in der Word-Ausgabe erhalten (fett, kursiv,
// Aufzaehlungen, Tabellen), Inhalt bereinigen (Planungen/Test-Hinweise als intern markieren, interne Vermerke
// loeschen), Design korrigieren (Ziel-Design waehlen und Ausgabe pruefen, Tipps/Hinweise markieren, Icon-Vielfalt).
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
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const R = (t, rpr) => "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + esc(t) + "</w:t></w:r>";
const P = (...runs) => "<w:p>" + runs.join("") + "</w:p>";
const LI = (numId, lvl, t) => '<w:p><w:pPr><w:numPr><w:ilvl w:val="' + lvl + '"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>' + R(t) + "</w:p>";
const TC = (t) => "<w:tc><w:p>" + R(t) + "</w:p></w:tc>";
const NUMBERING = '<?xml version="1.0"?><w:numbering ' + NS + '>' +
  '<w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num></w:numbering>';
async function draft() {
  const z = new JSZipNode();
  const body = H("1 Vertrag anlegen") +
    P(R("Klicken Sie auf "), R("Neuer Vertrag", "<w:b/>"), R(" und wählen Sie "), R("Leasing", "<w:i/>"), R(".")) +
    LI(1, 0, "Kunde auswählen") + LI(1, 1, "Adresse prüfen") + LI(1, 0, "Fahrzeug wählen") +
    P(R("Ablauf:")) + LI(2, 0, "Daten erfassen") + LI(2, 0, "Speichern") +
    '<w:tbl><w:tr>' + TC("Feld") + TC("Bedeutung") + "</w:tr><w:tr>" + TC("Laufzeit") + TC("Monate (ONESCM-55)") + "</w:tr></w:tbl>" +
    P(R("Tipp: Vorlagen sparen Zeit.")) + P(R("Achtung: Pflichtfelder ausfüllen.")) +
    P(R("Der Export ist geplant für Q4/2026.")) + P(R("Im Testsystem mit Testdaten prüfen.")) +
    P(R("TODO: Screenshot ergänzen")) +
    P(R("Symbole: ⚠ ℹ ✓ ✎ → ★ ☎"));
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/numbering.xml", NUMBERING);
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return z.generateAsync({ type: "nodebuffer" });
}
async function docXml(data) {
  const z = await JSZipNode.loadAsync(Buffer.from(await data.arrayBuffer()));
  return { xml: await z.file("word/document.xml").async("string"), styles: z.file("word/styles.xml") ? await z.file("word/styles.xml").async("string") : "" };
}
const plain = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const rows = () => Array.from(doc.querySelectorAll("#vrev-docs-tbody tr"));
  const act = (a) => { const b = $("vrev-stage").querySelector('[data-vrev-act="' + a + '"]'); if (b && !b.disabled) { b.click(); return true; } return false; };
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();
  const chk = (id) => { const r = doc.querySelector('#vrev-stage [data-vrev-check="' + id + '"]'); return r ? r.querySelector(".vrev-pill").textContent : ""; };
  const det = (id) => { const r = doc.querySelector('#vrev-stage [data-vrev-check="' + id + '"]'); return r ? r.children[2].textContent : ""; };
  const text0 = () => { $("vrev-text-chapter").value = "0"; fire($("vrev-text-chapter"), "change"); return $("vrev-text-edit").value; };
  async function word(sel) {
    savedFiles.length = 0;
    $("vrev-stage").querySelector('[data-vrev-act="' + sel + '"]').click();
    await waitUntil(() => savedFiles.length === 1, 8000);
    return docXml(savedFiles[0].data);
  }

  nav("variante"); await wait(30);
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Formatiert.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => rows().length === 1, 8000);

  const t = text0();
  check("Fett und kursiv als **…** / __…__ übernommen", t.includes("Klicken Sie auf **Neuer Vertrag** und wählen Sie __Leasing__."));
  check("Aufzählung mit Ebenen (• / ◦) übernommen", t.includes("• Kunde auswählen\n◦ Adresse prüfen\n• Fahrzeug wählen"));
  check("Nummerierte Liste (1. 2.) übernommen", t.includes("1. Daten erfassen\n2. Speichern"));
  check("Tabelle als [Tabelle]-Platzhalter, Zellen gesichert", t.includes("\n[Tabelle]\n") && !t.includes("Laufzeit\tMonate"));
  check("Überschrift ohne Fett-Markierung", $("vrev-text-chapter").options[0].textContent === "1 Vertrag anlegen");
  gotoStage(2); await wait(10);
  check("Jira-Nummer in der Tabelle wird gezählt", det("C1").startsWith("1 Jira-Nummer"));

  // Word: Formatierung erhalten
  gotoStage(7); await wait(10);
  let w = await word("word-dist");
  check("Word: fetter Lauf „Neuer Vertrag“", /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Neuer Vertrag<\/w:t><\/w:r>/.test(w.xml));
  check("Word: kursiver Lauf „Leasing“", /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">Leasing<\/w:t><\/w:r>/.test(w.xml));
  check("Word: keine Markierungszeichen ** / __ im Text", !/\*\*|__/.test(plain(w.xml)));
  check("Word: Aufzählung eingerückt (Ebene 1 und 2)", w.xml.includes('<w:ind w:left="720" w:hanging="360"/>') && w.xml.includes('<w:ind w:left="1080" w:hanging="360"/>') && w.xml.includes("<w:tab/><w:t xml:space=\"preserve\">Adresse prüfen"));
  check("Word: echte Tabelle mit Zellen, Jira-Nummer in der Zelle entfernt", /<w:tbl>[\s\S]*Laufzeit[\s\S]*Monate[\s\S]*<\/w:tbl>/.test(w.xml) && !/ONESCM-55/.test(w.xml) && !w.xml.includes("Tabelle 1:"));
  w = await word("word-intern");
  check("Word intern: Jira-Nummer in der Tabelle bleibt", w.xml.includes("ONESCM-55"));

  // Stufe 2: Inhalt bereinigen
  gotoStage(2); await wait(10);
  check("C2/C4 vor der Bereinigung: Hinweise", chk("C2") === "Hinweis" && chk("C4") === "Hinweis");
  check("Knöpfe mit Anzahl", $("vrev-stage").querySelector('[data-vrev-act="mark-plan"]').textContent.includes("(1)") && $("vrev-stage").querySelector('[data-vrev-act="mark-test"]').textContent.includes("(1)"));
  act("mark-plan"); await wait(10);
  act("mark-test"); await wait(10);
  check("Planungen/Test-Hinweise als intern markiert: C2 und C4 OK, C3 zählt sie mit", chk("C2") === "OK" && chk("C4") === "OK" && det("C3").startsWith("3 interne(r) Vermerk(e)"));
  check("Text: Zeilen in [[INTERN]] eingeschlossen", text0().includes("[[INTERN]]Der Export ist geplant für Q4/2026.[[/INTERN]]") && text0().includes("[[INTERN]]Im Testsystem mit Testdaten prüfen.[[/INTERN]]"));
  gotoStage(7); await wait(10);
  w = await word("word-dist");
  check("Verteilfassung ohne Planung, Test-Hinweis und TODO", !plain(w.xml).includes("Q4/2026") && !plain(w.xml).includes("Testsystem") && !plain(w.xml).includes("TODO"));
  w = await word("word-intern");
  check("Interne Fassung mit [Intern: …]", plain(w.xml).includes("[Intern: Der Export ist geplant für Q4/2026.]"));
  gotoStage(2); await wait(10);
  $("vrev-stage").querySelector('[data-vrev-act="del-intern"]').click();
  await waitUntil(() => !$("confirm-modal-ok-btn").closest("[hidden]"), 2000);
  $("confirm-modal-ok-btn").click();
  await waitUntil(() => chk("C3") === "OK", 3000);
  check("Interne Vermerke gelöscht (nach Bestätigung): C3 OK, Text bereinigt", chk("C3") === "OK" && !text0().includes("Q4/2026") && !text0().includes("TODO"));

  // Stufe 1: Design korrigieren
  gotoStage(1); await wait(10);
  check("D5: 2 unmarkierte Tipps/Hinweise und zu viele verschiedene Icons", chk("D5") === "Hinweis" && det("D5").includes("7 verschiedene") && det("D5").includes("unmarkierte Tipps/Hinweise: 2"));
  check("Knopf „Tipps/Hinweise markieren (2)“", $("vrev-stage").querySelector('[data-vrev-act="mark-tips"]').textContent.includes("(2)"));
  act("mark-tips"); await wait(10);
  check("Tipps markiert: [Tipp] / [Warnung]", text0().includes("[Tipp] Vorlagen sparen Zeit.") && text0().includes("[Warnung] Pflichtfelder ausfüllen.") && det("D5").includes("markierte Tipps/Hinweise: 2"));
  check("D5 bleibt Hinweis wegen 7 verschiedener Icons", chk("D5") === "Hinweis" && det("D5").includes("uneinheitlich"));
  const sel = $("vrev-stage").querySelector("[data-vrev-design]");
  check("Design-Auswahl: Entwurf ohne Formatvorlagen → „Design aus FINAL“ + App-Designs", sel.options[0].textContent.startsWith("Design aus FINAL") && Array.from(sel.options).some((o) => o.value === "app:klassisch"));
  sel.value = "app:klassisch"; fire(sel, "change");
  await waitUntil(() => det("D1").startsWith("Ausgabe ("), 8000);
  check("Ausgabe im Design „Klassisch“ geprüft: D1–D4 bewerten die Ausgabe (Cambria)", det("D1").includes("Cambria") && chk("D1") === "OK" && det("D3").startsWith("Ausgabe"));
  gotoStage(7); await wait(10);
  w = await word("word-dist");
  check("Word nutzt das gewählte Design (Cambria) und hebt [Tipp] farbig hervor", w.styles.includes("Cambria") && w.xml.includes('w:fill="E3F5E9"') && plain(w.xml).includes("[Tipp] Vorlagen sparen Zeit."));

  // Sitzung
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sd = JSON.parse(savedFiles[0].data).vrev.docs[0];
  check("Sitzung: Design-Wahl und Tabellen gespeichert", sd.designKey === "app:klassisch" && sd.chapters[0].tables && sd.chapters[0].tables[0].rows[1][0] === "Laufzeit");

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
