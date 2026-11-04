// v2.144.0 Dokument-Review: Bilder in Tabellen (hinter der Tabelle belegt) und Kopf-/Fusszeile (nur Bildarchiv),
// einstellbare Pruef-Grenzwerte, KI-Konsistenzpruefung zwischen Kapiteln (Stufe 6, A1), Uebersetzung mit geschuetzten
// Platzhaltern sowie uebersetzten Bildtexten, Bildunterschriften und Tabellenzellen.
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
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (p.includes("UNTEREINANDER")) return { text: '[{"kapitel":"1 Verträge / 2 Kündigung","widerspruch":"Freigabe einmal durch Backoffice, einmal automatisch","vorschlag":"einheitlich Backoffice"}]' };
  if (p.includes("\nJSON:\n")) { const o = JSON.parse(p.slice(p.indexOf("\nJSON:\n") + 7)); Object.keys(o).forEach((k) => { o[k] = "EN " + o[k]; }); return { text: JSON.stringify(o) }; }
  if (p.includes("ZIELSPRACHE:")) {
    const title = (p.match(/\nTITEL: (.*)\n/) || [])[1] || "", body = p.slice(p.indexOf("\nTEXT:\n") + 7);
    // Kapitel 2: KI "verliert" die Platzhalterzeile – muss wiederhergestellt werden
    const outBody = title.startsWith("2 ") ? body.split("\n").filter((l) => l.trim() !== "[Bild]").join("\n") : body;
    return { text: "TITEL: EN " + title + "\n\n" + outBody.split("\n").map((l) => (l.trim() && l.trim() !== "[Bild]" ? "EN " + l : l)).join("\n") };
  }
  return { text: "[]" };
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
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + t + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + "</w:t></w:r></w:p>";
const TC = (inner) => "<w:tc>" + inner + "</w:tc>";
async function draft() {
  const z = new JSZipNode();
  const body = H("1 Verträge") + P("Die Freigabe erfolgt durch das Backoffice nach der Prüfung des Vertrags.") + P("[Bild: Vertragsübersicht]") +
    "<w:tbl><w:tr>" + TC(P("Feld")) + TC(P("Ansicht")) + "</w:tr><w:tr>" + TC(P("Laufzeit")) + TC('<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' + P("Maske Laufzeit")) + "</w:tr></w:tbl>" +
    H("2 Kündigung") + P("Die Kündigung wird automatisch freigegeben.") + '<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>' +
    H("3 Kurz") + P("Nur zehn Wörter stehen in diesem sehr kurzen Kapitel hier.");
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/></Relationships>');
  z.file("word/header1.xml", '<?xml version="1.0" encoding="UTF-8"?><w:hdr ' + NS + '><w:p><w:r><w:drawing><a:blip r:embed="rIdLogo"/></w:drawing></w:r></w:p></w:hdr>');
  z.file("word/_rels/header1.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>');
  z.file("word/media/image1.png", PNG); z.file("word/media/image2.png", Buffer.concat([PNG, Buffer.from([1])])); z.file("word/media/logo.png", Buffer.concat([PNG, Buffer.from([2])]));
  return z.generateAsync({ type: "nodebuffer" });
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();
  const chk = (id) => { const r = doc.querySelector('#vrev-stage [data-vrev-check="' + id + '"]'); return r ? r.querySelector(".vrev-pill").textContent : ""; };
  const det = (id) => { const r = doc.querySelector('#vrev-stage [data-vrev-check="' + id + '"]'); return r ? r.children[2].textContent : ""; };
  const setLimit = (k, v) => { const i = doc.querySelector('[data-vrev-limit="' + k + '"]'); i.value = String(v); fire(i, "change"); };

  nav("variante"); await wait(20);
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Entwurf.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]").length === 1, 8000);

  // 1) Bilder in Tabellen / Kopfzeile
  check("Hinweis: 3 Bilder übernommen, 2 als Platzhalter, 1 aus Kopfzeile nur im Archiv", $("vrev-import-note").textContent.includes("3 eingebettete(s) Bild(er) ins Bildarchiv übernommen und 2 an ihrer Stelle als Platzhalter belegt; 1 aus Kopf-/Fußzeile nur im Bildarchiv"));
  gotoStage(3); await wait(10);
  const ph = Array.from(doc.querySelectorAll(".vrev-ph-table tbody tr"));
  check("Bild aus Tabellenzelle hinter der Tabelle belegt, Bildtext = Zellentext", ph.length === 3 && ph[1].children[1].textContent === "[Bild: Maske Laufzeit]" && ph[1].querySelectorAll(".screenph-thumb").length === 1);
  check("Text-Platzhalter bleibt leer, Bild aus Kapitel 2 belegt", ph[0].querySelectorAll(".screenph-thumb").length === 0 && ph[2].querySelectorAll(".screenph-thumb").length === 1);
  nav("editor"); await wait(20);
  check("Logo aus der Kopfzeile im Bildarchiv", doc.getElementById("editor-screens-tbody").textContent.includes("Kopfzeile (Entwurf.docx)"));
  nav("variante"); await wait(20);

  // 3) Grenzwerte
  $("vrev-run-btn").click(); await wait(10);
  gotoStage(4); await wait(10);
  check("Q3 Standard: kurzes Kapitel (< 25 Wörter) → Hinweis", chk("Q3") === "Hinweis" && det("Q3").includes("< 25 Wörter"));
  check("Grenzwerte-Bereich mit 22 Feldern", doc.querySelectorAll("[data-vrev-limit]").length === 22);
  setLimit("shortWords", 5); await wait(10);
  check("Grenzwert „kurzes Kapitel unter 5 Wörtern“ → Q3 OK, sofort neu bewertet", chk("Q3") === "OK" && $("vrev-status").textContent.includes("neu bewertet"));
  setLimit("scoreOk", 40); await wait(10);
  gotoStage(6); await wait(10);
  check("Grenzwert Qualität OK ab 40 → A2 OK", chk("A2") === "OK");
  $("vrev-limits-reset-btn").click(); await wait(10);
  gotoStage(4); await wait(10);
  check("Standard wiederherstellen → Q3 wieder Hinweis", chk("Q3") === "Hinweis" && doc.querySelector('[data-vrev-limit="shortWords"]').value === "25");

  // 2) KI-Konsistenz
  gotoStage(6); await wait(10);
  const a1Before = chk("A1");
  $("vrev-stage").querySelector('[data-vrev-act="ai-consistency"]').click();
  await waitUntil(() => /KI-Konsistenzprüfung: \d+ Widerspruch/.test($("vrev-status").textContent), 5000);
  check("KI-Konsistenz: Prompt mit allen Kapiteln", prompts.some((p) => p.includes("UNTEREINANDER") && p.includes("## 1 Verträge") && p.includes("## 2 Kündigung")));
  check("Befund-Tabelle und A1 Hinweis mit offenem Widerspruch", doc.querySelectorAll("#vrev-stage [data-vrev-cons]").length === 1 && chk("A1") === "Hinweis" && det("A1").includes("KI-Konsistenz: 1 offene(r)"));
  $("vrev-stage").querySelector('[data-vrev-act="cons-done"]').click(); await wait(10);
  check("Widerspruch erledigt → A1 wie vorher, Änderung gezählt", chk("A1") === a1Before && det("A1").includes("KI-Konsistenz: 0 offene"));

  // 4) Uebersetzung
  gotoStage(5); await wait(10);
  $("vrev-stage").querySelector("[data-vrev-tr-lang]").value = "EN";
  $("vrev-stage").querySelector('[data-vrev-act="translate"]').click();
  await waitUntil(() => /Kopie/.test($("vrev-status").textContent), 8000);
  check("Statusmeldung nennt übersetzte Bildtexte und Tabellenzellen", /Bildtext\(e\) und \d+ Tabellenzelle\(n\)/.test($("vrev-status").textContent));
  check("Kapitel-Prompts enthalten nur geschützte „[Bild]“-Zeilen", prompts.filter((p) => p.includes("\nTITEL: ")).every((p) => !p.includes("[Bild: ")));
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const en = JSON.parse(savedFiles[0].data).vrev.docs.find((d) => d.source === "Übersetzung");
  check("Platzhalter mit übersetztem Bildtext wiederhergestellt", en.chapters[0].text.includes("[Bild: EN Vertragsübersicht]") && en.chapters[0].text.includes("[Bild: EN Maske Laufzeit]"));
  check("Von der KI weggelassener Platzhalter (Kapitel 2) wieder ergänzt", /\[Bild: EN /.test(en.chapters[1].text));
  check("„[Tabelle]“-Zeile geschützt und wiederhergestellt", en.chapters[0].text.split("\n").some((l) => l.trim() === "[Tabelle]"));
  check("Tabellenzellen übersetzt", en.chapters[0].tables[0].rows[1][0] === "EN Laufzeit" && en.chapters[0].tables[0].rows[0][0] === "EN Feld");
  check("Bildunterschriften der Kopie übersetzt (Word)", Object.values(en.captions).some((c) => c.startsWith("EN ")));
  doc.querySelector('#vrev-docs-tbody > tr[data-vrev-row]:last-child [data-vrev-act="open"]').click(); await wait(20);
  gotoStage(5); await wait(10);
  check("T1 der Übersetzung OK; Bilder weiter zugeordnet", chk("T1") === "OK");
  gotoStage(3); await wait(10);
  check("Übersetzte Kopie: belegte Platzhalter bleiben belegt", Array.from(doc.querySelectorAll(".vrev-ph-table tbody tr")).filter((r) => r.querySelectorAll(".screenph-thumb").length).length === 2);
  gotoStage(7); await wait(10);
  savedFiles.length = 0;
  $("vrev-stage").querySelector('[data-vrev-act="word-dist"]').click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const xml = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("word/document.xml").async("string");
  check("Word der Übersetzung: übersetzte Bildunterschrift und Tabellenzelle", /Abbildung \d+: EN /.test(xml) && xml.includes("EN Laufzeit"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
