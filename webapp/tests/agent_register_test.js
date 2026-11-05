// v2.141.0 Register AGENT: 8 Agenten (Extraction, Classification, Quality, Media, Knowledge, Translation, Impact,
// Publishing) mit Orchestrator – Reihenfolge, automatisch ergaenzte Vorgaenger, Fehlerbehandlung, KI-Verfeinerung,
// Uebernahmen (Untertitel, Rovo Knowledge, Review-Dokument), Rendering, Bericht/Excel, Sitzung.
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];
const prompts = [];
async function sample(input) {
  const p = typeof input === "string" ? input : input[input.length - 1].content;
  prompts.push(p);
  if (p.includes("ZIELSPRACHE:")) {
    const title = (p.match(/\nTITEL: (.*)\n/) || [])[1] || "";
    return { text: "TITEL: EN " + title + "\n\nEN: " + p.slice(p.indexOf("\nTEXT:\n") + 7) };
  }
  if (p.includes("Classification Agent")) {
    const out = {};
    for (const m of p.matchAll(/^#(\d+) \[[^\]]*\] (.*)$/gm)) if (/Kartenzahlung erfolgt/.test(m[2])) out[m[1]] = { domain: "Zahlung", market: "Österreich", role: "Unbekannt" };
    return { text: JSON.stringify(out) };
  }
  if (p.includes("Quality Agent")) return { text: '[{"type":"Lücke","chapter":"Entwurf › 1 Verträge anlegen","text":"KI: Speichern-Schritt fehlt"}]' };
  if (p.includes("Media Agent")) { const out = {}; for (const m of p.matchAll(/^ID (\d+) \|/gm)) out[m[1]] = "KI-Untertitel " + m[1]; return { text: JSON.stringify(out) }; }
  if (p.includes("Knowledge Agent")) { const out = {}; for (const m of p.matchAll(/^#(\d+) ([^:]+):/gm)) out[m[1]] = { title: "KI " + m[2], summary: "KI-Zusammenfassung " + m[1], type: "FAQ" }; return { text: JSON.stringify(out) }; }
  return { text: "" };
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
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r></w:p>";
const DUP = "Der Vertrag wird nach der Prüfung durch das Backoffice automatisch aktiviert und per E-Mail bestätigt.";
async function docx(body, media) {
  const z = new JSZipNode();
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  let rels = "";
  (media || []).forEach((m, i) => { rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (i + 1) + '.png"/>'; z.file("word/media/image" + (i + 1) + ".png", Buffer.concat([PNG, Buffer.from([i])])); });
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>");
  return z.generateAsync({ type: "nodebuffer" });
}
const draftBody = H("1 Verträge anlegen") + P("Der Händler legt im Autohaus in Deutschland neue Verträge an (ONESCM-12).") + P("[Bild: Vertragsübersicht mit Filtern]") + P(DUP) + P("Die Laufzeit ist TBD.") + P("Im Testsystem prüfen.") + P("TODO: Abstimmung mit dem Fachbereich") +
  H("2 Kartenzahlung") + P("Die Kartenzahlung erfolgt per QR-Code. Sie ist geplant für Q3/2026 und steht ab sofort zur Verfügung.") + P("Screenshot: QR-Code für die Kartenzahlung") + P(DUP) +
  H("3 Leeres Kapitel") +
  H("4 Overview") + P("The overview shows all contracts and you can filter them by status.") +
  H("5 Begriffe") + P("Ein Leasingvertrag ist ein Vertrag über die Nutzung eines Fahrzeugs gegen monatliche Raten.");
const manualBody = H("1 Verträge anlegen") + P("Neue Verträge werden online angelegt und anschließend vom Backoffice geprüft.") + H("2 Kunden verwalten") + P("Kundendaten werden zentral gepflegt.");

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const setVal = (id, v) => { const el = $(id); el.value = v; fire(el, "change"); };
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
  const row = (k) => doc.querySelector('#agent-tbody tr[data-agent-row="' + k + '"]');
  const st = (k) => row(k).children[4].textContent;
  const res = (k) => row(k).children[5].textContent;
  const tab = async (k) => { doc.querySelector('#agent-tabs [data-agent-tab="' + k + '"]').click(); await wait(10); return $("agent-output"); };
  const sel = (keys) => { doc.querySelectorAll("[data-agent-sel]").forEach((c) => { c.checked = keys.includes(c.getAttribute("data-agent-sel")); fire(c, "change"); }); };
  async function orchestrate() { $("agent-run-btn").click(); await waitUntil(() => /^Orchestrator fertig/.test($("agent-status").textContent), 20000); await wait(20); }

  // Vorbereitung: Bildarchiv, Domaenen, FINAL-Staende, Review-Dokument
  nav("editor"); await wait(20);
  setFiles($("editor-file-input"), [new win.File([await docx(H("Vertragsübersicht mit Filtern") + '<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>' + H("QR-Code Kartenzahlung") + '<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>', [1, 2])], "archiv.docx")]);
  await waitUntil(() => $("editor-screens-count").textContent === "2", 8000);
  nav("variante"); await wait(20);
  for (const d of ["Verträge", "Zahlung"]) { $("variante-domain-new-input").value = d; $("variante-domain-add-btn").click(); }
  nav("final"); await wait(20);
  setFiles($("final-manual-file-input"), [new win.File([await docx(manualBody)], "basis.docx")]);
  await waitUntil(() => $("final-manual-tbody") ? true : $("final-manuals-tbody").children.length === 1, 5000);
  for (const n of ["Basis", "Kopie"]) {
    $("final-build-name-input").value = n; fire($("final-build-name-input"), "input");
    fire($("final-build-master-btn"), "click");
    await waitUntil(() => $("final-build-master-status-note").textContent.includes("„" + n + "“"), 10000);
  }
  nav("variante"); await wait(20);
  const exSel = $("vrev-existing-select");
  exSel.value = Array.from(exSel.options).find((o) => o.textContent.startsWith("Basis")).value;
  $("vrev-existing-btn").click();
  await waitUntil(() => doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]").length === 1, 8000);
  $("vrev-text-chapter").value = "0"; fire($("vrev-text-chapter"), "change");
  $("vrev-text-edit").value = "Neue Verträge werden im Portal angelegt. Die Vertragsprüfung übernimmt das Backoffice innerhalb von zwei Tagen.";
  $("vrev-text-save-btn").click(); await wait(20);
  const stSel = doc.querySelector("#vrev-docs-tbody [data-vrev-status]"); stSel.value = "Freigegeben"; fire(stSel, "change"); await wait(20);

  // Register AGENT
  nav("agent"); await wait(20);
  check("Register AGENT in der Navigation und sichtbar", !!doc.querySelector('.nav-item[data-view="agent"]') && !doc.querySelector('[data-view-panel="agent"]').hidden);
  const rows = Array.from(doc.querySelectorAll("#agent-tbody tr"));
  const spec = [["Extraction Agent", "Dateien, Quellen", "Strukturierte Blöcke"], ["Classification Agent", "Extrahierte Inhalte", "Domäne, Rolle, Markt, Sprache"], ["Quality Agent", "Inhalte und Gültigkeitsregeln", "Lücken, Konflikte, Dubletten"],
    ["Media Agent", "Bilder, OCR, Textumfeld", "Bildzuordnung, Untertitelvorschläge"], ["Knowledge Agent", "Geprüfte Inhalte", "Wissensobjektvorschläge"], ["Translation Agent", "Freigegebene Ausgangsrevision", "Übersetzungsvorschlag"],
    ["Impact Agent", "Geänderte Revisionen", "Betroffene Handbücher"], ["Publishing Agent", "Publikationsentwurf", "Vorprüfung und Renderingauftrag"]];
  check("8 Agenten mit Eingabe und Ausgabe wie vorgegeben", rows.length === 8 && spec.every((s, i) => rows[i].children[1].textContent.startsWith((i + 1) + ". " + s[0]) && rows[i].children[2].textContent === s[1] && rows[i].children[3].textContent === s[2]));
  check("Quellen: FINAL-Stände, Review-Dokument; noch keine Datei", $("agent-sources").textContent.includes("FINAL „Basis“") && $("agent-sources").textContent.includes("Review „Basis“ v1.0 (Freigegeben)"));
  check("Gültigkeitsregeln (7 Standardregeln) und Märkte vorbelegt", doc.querySelectorAll("[data-agent-rule]").length === 7 && $("agent-markets").value.includes("Deutschland"));

  // Orchestrator ohne Quelle: Fehler, abhaengige uebersprungen
  sel(["classification"]);
  await orchestrate();
  check("Ohne Quelle: Extraction Fehler, Classification übersprungen, Vorgänger automatisch ergänzt", st("extraction") === "Fehler" && res("extraction").startsWith("Keine Quellen ausgewählt") && st("classification") === "übersprungen" &&
    $("agent-log").textContent.includes("automatisch ergänzt – benötigt von Classification Agent"));

  // Quelle hochladen
  setFiles($("agent-file-input"), [new win.File([await docx(draftBody)], "Entwurf.docx")]);
  await waitUntil(() => $("agent-sources").textContent.includes("Datei „Entwurf.docx“"), 5000);
  check("Datei als Quelle übernommen und angekreuzt (FINAL/Review nicht)", doc.querySelector('[data-agent-src="U:1"]').checked && !doc.querySelector('[data-agent-src="F:1"]').checked);
  $("agent-rule-term").value = "Testsystem"; $("agent-rule-add-btn").click(); await wait(10);
  check("Eigene Regel „Verbotener Begriff“ hinzugefügt", doc.querySelectorAll("[data-agent-rule]").length === 8);

  // Nur Knowledge waehlen -> Extraction + Quality werden ergaenzt
  sel(["knowledge"]);
  await orchestrate();
  check("Knowledge allein: Extraction und Quality automatisch ergänzt und ausgeführt", st("extraction") === "OK" && st("quality") === "Hinweise" && st("knowledge") === "OK" &&
    Array.from(doc.querySelectorAll("#agent-log li")).map((l) => l.textContent).join("|").includes("Extraction Agent – automatisch ergänzt"));
  let out = await tab("extraction");
  check("Extraction: strukturierte Blöcke (Überschriften, Absätze, Bilder)", /^\d+ Blöcke aus 1 Quelle\(n\): .*Überschriften.*Absätze.*Bilder/.test(res("extraction")) && out.querySelectorAll("tbody tr").length > 10);

  // Alle Agenten ohne KI
  setVal("agent-tr-source", "R:1"); setVal("agent-tr-lang", "EN");
  setVal("agent-imp-a", "F:1"); setVal("agent-imp-b", "R:1");
  setVal("agent-pub-source", "R:1"); const pdfCb = $("agent-pub-pdf"); pdfCb.checked = true; fire(pdfCb, "change");
  sel(["extraction", "classification", "quality", "media", "knowledge", "translation", "impact", "publishing"]);
  await orchestrate();
  check("Orchestrator: alle 8 Agenten in fester Reihenfolge", Array.from(doc.querySelectorAll("#agent-log li")).map((l) => l.querySelector("b").textContent).join(",") === spec.map((s) => s[0]).join(","));

  out = await tab("classification");
  const clsRow = (txt) => Array.from(out.querySelectorAll("tbody tr")).find((r) => r.children[4].textContent.includes(txt));
  const c1 = clsRow("Der Händler legt");
  check("Classification: Domäne Verträge, Rolle Retail (Händler), Markt Deutschland, Sprache DE", c1 && c1.children[5].textContent.startsWith("Verträge") && c1.children[6].textContent === "Retail" && c1.children[7].textContent === "Deutschland" && c1.children[8].textContent === "DE");
  check("Classification: englischer Absatz als EN erkannt", clsRow("The overview shows").children[8].textContent === "EN");

  out = await tab("quality");
  const q = out.textContent;
  check("Quality: Jira-Regel, Lücke TBD, Konflikt Status, leeres Kapitel, Dublette, eigener Begriff", q.includes("Jira-Nummer im Kundentext: ONESCM-12") && q.includes("Lücken-Markierung") && q.includes("Geplantes/in Entwicklung als verfügbar beschrieben") &&
    q.includes("Kapitel „3 Leeres Kapitel“ ohne Inhalt") && q.includes("Interner Vermerk: „TODO: Abstimmung mit dem Fachbereich“") && q.includes("2 gleiche/sehr ähnliche Absätze (≥ 100 %): „Der Vertrag wird nach") && q.includes("Verbotener Begriff „Testsystem“"));

  out = await tab("media");
  const mRows = Array.from(out.querySelectorAll("tbody tr"));
  check("Media: 2 Platzhalter mit Bildvorschlag aus dem Archiv", mRows.length === 2 && mRows[0].querySelector(".screenph-thumb").getAttribute("title") === "Vertragsübersicht mit Filtern" && mRows[1].querySelector(".screenph-thumb").getAttribute("title") === "QR-Code Kartenzahlung");
  check("Media: Untertitelvorschläge (Regel)", mRows[0].children[3].textContent.includes("Vertragsübersicht mit Filtern (Regel)"));

  out = await tab("knowledge");
  const kRows = Array.from(out.querySelectorAll("tbody tr"));
  check("Knowledge: Wissensobjekte nur aus geprüften Blöcken, Typ Begriff erkannt", kRows.some((r) => r.children[1].textContent === "Begriff" && r.children[2].textContent === "Begriffe") && !out.textContent.includes("ONESCM-12") && res("knowledge").includes("mit Qualitätsbefund ausgelassen"));
  out.querySelector("[data-agent-kn-all]").click(); await wait(20);
  check("Knowledge: alle nach Rovo Knowledge übernommen (Label AGENT)", (await tab("knowledge")).querySelectorAll("[data-agent-kn-adopt]").length === 0 && $("agent-status").textContent.endsWith("nach Rovo Knowledge übernommen."));

  out = await tab("translation");
  check("Translation: Vorschlag EN aus freigegebener Revision per KI", res("translation").startsWith("Übersetzungsvorschlag Englisch für „Basis v1.0“: 2 Kapitel per KI") && out.textContent.includes("EN 1 Verträge anlegen"));
  out.querySelector("[data-agent-tr-adopt]").click(); await wait(20);
  check("Translation: als Review-Dokument übernommen", doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]").length === 2 && (await tab("translation")).textContent.includes("als Review-Dokument „Basis v1.0 (EN)“ angelegt"));

  out = await tab("impact");
  check("Impact: geändertes Kapitel erkannt", out.textContent.includes("1 Verträge anlegengeändert"));
  const affected = Array.from(out.querySelectorAll("[data-agent-imp]"));
  check("Impact: FINAL „Kopie“ als betroffen (hoch, gleichnamiges Kapitel)", affected.some((r) => r.getAttribute("data-agent-imp") === "F:2" && r.children[0].textContent === "hoch" && r.children[4].textContent.includes("gleichnamige")));

  out = await tab("publishing");
  check("Publishing: Vorprüfung mit Freigabestatus und Review-Stufen", out.textContent.includes("Vorprüfung: bereit mit Hinweisen") && out.textContent.includes("Status „Freigegeben“") && out.textContent.includes("0/7 Stufen"));
  const order = JSON.parse($("agent-order-json").textContent);
  check("Renderingauftrag: Formate Word+PDF, Dateinamen, Fassung", order.formate.join("+") === "Word+PDF" && order.dateien[0] === "Basis_v1.0.docx" && order.dateien[1] === "Basis_v1.0.pdf" && order.fassung.startsWith("Verteilung"));
  savedFiles.length = 0;
  out.querySelector("[data-agent-render]").click();
  await waitUntil(() => savedFiles.length === 2, 10000);
  check("Rendering ausgeführt: Word und PDF", savedFiles.map((f) => f.filename).join(",") === "Basis_v1.0.docx,Basis_v1.0.pdf");
  savedFiles.length = 0;
  (await tab("publishing")).querySelector("[data-agent-order-dl]").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  check("Renderingauftrag als JSON herunterladbar", /^Renderingauftrag_R-\d{8}-\d+\.json$/.test(savedFiles[0].filename));

  // Mit KI verfeinern
  $("agent-use-ai").checked = true; fire($("agent-use-ai"), "change");
  sel(["classification", "quality", "media", "knowledge"]);
  await orchestrate();
  out = await tab("classification");
  const kc = Array.from(out.querySelectorAll("tbody tr")).find((r) => r.children[4].textContent.includes("Kartenzahlung erfolgt"));
  check("KI-Klassifikation: Domäne/Markt aus erlaubter Liste übernommen, unbekannte Rolle verworfen", kc.children[5].textContent.startsWith("Zahlung") && kc.children[7].textContent === "Österreich" && kc.children[6].textContent !== "Unbekannt" && kc.children[9].textContent === "KI");
  check("KI-Prompts mit erlaubten Werten und Blöcken", prompts.some((p) => p.includes("Classification Agent") && p.includes("Domänen: Verträge, Zahlung") && p.includes("Märkte: Deutschland")));
  check("KI-Qualität: zusätzlicher Befund", (await tab("quality")).textContent.includes("KI: Speichern-Schritt fehlt"));
  out = await tab("media");
  check("KI-Untertitel vorgeschlagen", out.textContent.includes("KI-Untertitel"));
  out.querySelector("[data-agent-caption]").click(); await wait(20);
  check("Untertitel ins Bildarchiv übernommen", $("agent-status").textContent.startsWith("1 Untertitel ins Bildarchiv übernommen"));
  check("KI-Wissensobjekte (Titel/Typ verfeinert)", (await tab("knowledge")).textContent.includes("KI-Zusammenfassung") && res("knowledge").includes("per KI verfeinert"));

  // Bericht + Excel
  savedFiles.length = 0;
  $("agent-report-md-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  const md = await savedFiles[0].data.text();
  check("Laufbericht: alle Agenten, Befunde, Wissensobjekte, Renderingauftrag", md.startsWith("# AGENT – Laufbericht") && spec.every((s) => md.includes("## " + s[0])) && md.includes("## Befunde (Quality Agent)") && md.includes("## Renderingauftrag"));
  savedFiles.length = 0;
  $("agent-xlsx-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  const wb = await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()))).file("xl/workbook.xml").async("string");
  check("Excel: Blöcke, Qualität, Medien, Wissen, Impact, Publishing", ["Blöcke", "Qualität", "Medien", "Wissen", "Impact", "Publishing"].every((t) => wb.includes('name="' + t + '"')));

  // Sitzung
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const sess = JSON.parse(savedFiles[0].data);
  check("Sitzung: Quellen, Ergebnisse und Status gespeichert, Blöcke nicht (neu erzeugbar)", sess.agent.uploads.length === 1 && sess.agent.blocks.length === 0 && sess.agent.blocksDropped > 10 && sess.agent.knowledge.items.length > 0 && sess.agent.status.publishing.s === "warn" && sess.agent.useAi === true);
  check("Rovo Knowledge enthält übernommene Objekte mit Label AGENT", sess.rovoEntries.some((e) => e.labels.includes("AGENT")));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
