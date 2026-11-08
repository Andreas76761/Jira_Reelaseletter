// v2.115.0 FINAL Schritt 7: Kapitel-Auswahl "Gesamtes Dokument", Vollbild-
// Ansicht je Fenster (Quellversion / neue Zusammenfuehrung, auch beide
// nebeneinander) mit Zoom und Blaettern; dazu ein kompletter FINAL-Durchlauf
// mit Seitenreihenfolge: Screens mehrerer Seiten werden im Master in der
// Seitenfolge der Quelle eingebettet.
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
let fullscreenRequests = 0;
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    // Browser-Vollbild ist in eingebetteten Ansichten oft nicht erlaubt -> Ablehnung simulieren.
    window.HTMLElement.prototype.requestFullscreen = function () { fullscreenRequests++; return Promise.reject(new Error("not allowed")); };
    window.HTMLElement.prototype.scrollIntoView = function () { window.__lastScrolledInto = this; };
    window.claude = {
      use: function (name) {
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function key(k) { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (fn()) return true; await wait(20); }
  return false;
}

const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const RPB = "<w:r><w:lastRenderedPageBreak/></w:r>";
function heading(text, prefix) { return '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + (prefix || "") + "<w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function para(text, prefix) { return "<w:p>" + (prefix || "") + "<w:r><w:t>" + esc(text) + "</w:t></w:r></w:p>"; }
function img(rId, prefix) { return "<w:p>" + (prefix || "") + '<w:r><w:drawing><a:blip r:embed="' + rId + '"/></w:drawing></w:r></w:p>'; }
async function buildDocx(bodyXml, opts) {
  opts = opts || {};
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "<w:sectPr/></w:body></w:document>");
  if (opts.pages) zip.file("docProps/app.xml", '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>' + opts.pages + "</Pages></Properties>");
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= (opts.images || 0); i++) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>';
    zip.file("word/media/image" + i + ".png", PNG);
  }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}

const K1 = "Kapitel 1: Verträge", K2 = "Kapitel 2: Kündigung", K3 = "Kapitel 3: Stammdaten";

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  async function upload(inputId, buf, name) {
    const input = doc.getElementById(inputId);
    Object.defineProperty(input, "files", { value: [new win.File([buf], name, { type: "application/octet-stream" })], configurable: true });
    fire(input, "change");
  }
  const rows = () => Array.from(doc.querySelectorAll("#final-screens-tbody tr"));
  const navOf = (r) => r.querySelector(".final-col-nav").textContent;

  doc.querySelector('.nav-item[data-view="final"]').click();
  await wait(100);

  // ===================== Handbuch (3 Kapitel, 9 Seiten) =====================
  await upload("final-manual-file-input", await buildDocx(
    heading(K1) + para("Verträge werden online geändert.") + heading(K2, RPB) + para("Kündigungen werden erfasst.") + heading(K3, RPB) + para("Händlerdaten pflegen."),
    { pages: 9 }), "handbuch.docx");
  await waitUntil(() => doc.getElementById("final-manuals-tbody").children.length === 1, 5000);
  check("Handbuch hochgeladen (9 Seiten)", doc.querySelector("#final-manuals-tbody .final-col-pages").textContent === "9");

  // ===================== Screens: 4 Seiten, Kapitel 1 auf S.1 und S.3 =====================
  await upload("final-screens-file-input", await buildDocx(
    heading("Verträge") + img("rId1") + para("V > Übersicht") +
    heading("Kündigung", RPB) + img("rId2") + para("K > Erfassen") +
    para("Nachtrag Verträge", RPB) + img("rId3") + para("V > Ändern") +
    img("rId4", RPB) + para("V > Speichern"),
    { images: 4, pages: 4 }), "screens.docx");
  await waitUntil(() => rows().length === 4, 5000);
  check("Screens in Seitenreihenfolge", rows().map(navOf).join("|") === "V > Übersicht|K > Erfassen|V > Ändern|V > Speichern");
  check("Seite 3 ohne Überschrift bezieht sich auf die Vorseite (Kündigung)", rows()[2].querySelector(".final-col-headings").textContent.includes("Vorseite"));

  // Kapitel zuordnen: rueckwaerts (S.4, dann S.3, dann S.1), damit die Zuordnungsreihenfolge nicht zufaellig der Seitenfolge entspricht.
  const setChapter = (nav, title) => { const sel = rows().find((r) => navOf(r) === nav).querySelector("select"); sel.value = title; fire(sel, "change"); };
  setChapter("V > Speichern", K1);
  setChapter("V > Ändern", K1);
  setChapter("V > Übersicht", K1);
  setChapter("K > Erfassen", K2);

  // ===================== Master =====================
  fire(doc.getElementById("final-build-master-btn"), "click");
  await waitUntil(() => doc.getElementById("final-build-master-status-note").textContent.includes("zusammengeführt"), 10000);
  check("Ergebnis-Abschnitt sichtbar", !doc.getElementById("final-result-section").hidden);
  const resSel = doc.getElementById("final-result-chapter-select");
  const optValues = Array.from(resSel.options).map((o) => o.textContent);
  check("Kapitel-Auswahl bietet 'Gesamtes Dokument' an erster Stelle", optValues[0] === "— Gesamtes Dokument —");
  check("Vorauswahl bleibt das erste Kapitel", resSel.value === K1);
  resSel.value = K1; fire(resSel, "change");
  const master1 = doc.getElementById("final-result-master-output").textContent;
  const iU = master1.indexOf("V > Übersicht"), iA = master1.indexOf("V > Ändern"), iS = master1.indexOf("V > Speichern");
  check("Master Kapitel 1: Screens in Seitenreihenfolge (S.1, S.3, S.4) trotz umgekehrter Zuordnung", iU !== -1 && iU < iA && iA < iS);

  // ===================== Gesamtes Dokument =====================
  resSel.value = resSel.options[0].value; fire(resSel, "change");
  const srcAll = doc.getElementById("final-result-source-output");
  const masterAll = doc.getElementById("final-result-master-output");
  check("Gesamtes Dokument: Quellversion enthält alle 3 Kapitelüberschriften", srcAll.querySelectorAll("h2.final-doc-chapter").length === 3 && [K1, K2, K3].every((k) => srcAll.textContent.includes(k)));
  check("Gesamtes Dokument: Quellversion enthält Text aller Kapitel", ["Verträge werden online", "Kündigungen werden erfasst", "Händlerdaten pflegen"].every((t) => srcAll.textContent.includes(t)));
  // v2.186: finales Dokument zeigt Screens standardmäßig als Bilder (Hinweis „[Bild: …]“ nur ohne Bild-Daten)
  check("Gesamtes Dokument: neue Zusammenführung mit allen Kapiteln und Bildern", masterAll.querySelectorAll("h2.final-doc-chapter").length === 3 && masterAll.querySelectorAll("figure").length + (masterAll.textContent.match(/\[Bild:/g) || []).length === 4);

  // ===================== Vollbild: einzelnes Fenster =====================
  const viewer = doc.getElementById("final-viewer");
  check("Vollbild-Ansicht anfangs geschlossen", viewer.hidden);
  resSel.value = K1; fire(resSel, "change");
  fire(doc.querySelector('[data-final-result-fullscreen="source"]'), "click");
  const panes = () => Array.from(doc.querySelectorAll("#final-viewer-panes [data-fv-pane]"));
  check("Quellversion öffnet im Vollbild (1 Fenster)", !viewer.hidden && panes().length === 1 && panes()[0].getAttribute("data-fv-kind") === "source");
  check("Browser-Vollbild angefordert; Ablehnung ohne Fehler abgefangen", fullscreenRequests === 1);
  const p0 = () => panes()[0];
  check("Fenster startet beim gewählten Kapitel", p0().querySelector("[data-fv-chapter]").value === K1 && p0().querySelector("[data-fv-content]").textContent.includes("Verträge werden online"));
  check("Positionsanzeige 'Kapitel 1 von 3', Zurück deaktiviert", p0().querySelector("[data-fv-pos]").textContent === "Kapitel 1 von 3" && p0().querySelector("[data-fv-prev]").disabled);
  fire(p0().querySelector("[data-fv-next]"), "click");
  check("Weiter blättert zu Kapitel 2", p0().querySelector("[data-fv-chapter]").value === K2 && p0().querySelector("[data-fv-content]").textContent.includes("Kündigungen werden erfasst"));
  key("ArrowRight");
  check("Pfeil rechts blättert zu Kapitel 3, Weiter deaktiviert", p0().querySelector("[data-fv-chapter]").value === K3 && p0().querySelector("[data-fv-next]").disabled);
  key("ArrowLeft");
  check("Pfeil links blättert zurück zu Kapitel 2", p0().querySelector("[data-fv-chapter]").value === K2);
  const zoomOf = () => p0().querySelector("[data-fv-content]").getAttribute("data-zoom");
  fire(p0().querySelector("[data-fv-zoom-in]"), "click");
  check("Zoom + → 110 %", zoomOf() === "1.1" && p0().querySelector("[data-fv-zoom-label]").textContent === "110 %");
  key("+"); key("+");
  check("Taste + zoomt weiter (150 %)", p0().querySelector("[data-fv-zoom-label]").textContent === "150 %");
  fire(p0().querySelector("[data-fv-zoom-out]"), "click");
  check("Zoom − → 125 %", p0().querySelector("[data-fv-zoom-label]").textContent === "125 %");
  fire(p0().querySelector("[data-fv-zoom-reset]"), "click");
  check("Zoom zurücksetzen → 100 %", zoomOf() === "1");
  const ctrlWheel = new win.WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
  p0().querySelector("[data-fv-content]").dispatchEvent(ctrlWheel);
  check("Strg + Mausrad zoomt (110 %)", p0().querySelector("[data-fv-zoom-label]").textContent === "110 %" && ctrlWheel.defaultPrevented);
  key("0");
  key("Escape");
  check("Esc schließt die Vollbild-Ansicht", viewer.hidden && panes().length === 0);

  // ===================== Vollbild: beide Fenster, unabhaengig =====================
  fire(doc.getElementById("final-result-fullscreen-both-btn"), "click");
  check("Beide im Vollbild: 2 Fenster (Quellversion + neue Zusammenführung)", panes().length === 2 && panes()[0].getAttribute("data-fv-kind") === "source" && panes()[1].getAttribute("data-fv-kind") === "master");
  const [src, mst] = panes();
  check("Neue Zusammenführung zeigt die Screens als Bilder mit Bildunterschrift", mst.querySelectorAll(".final-viewer-figure img").length === 3 && mst.querySelector(".final-viewer-figure figcaption").textContent.includes("V > Übersicht"));
  const figs = Array.from(mst.querySelectorAll(".final-viewer-figure figcaption")).map((f) => f.textContent);
  check("Bilder im Vollbild in Seitenreihenfolge", figs.length === 3 && figs[0].includes("Übersicht") && figs[1].includes("Ändern") && figs[2].includes("Speichern"));
  fire(mst.querySelector("[data-fv-next]"), "click");
  check("Blättern im rechten Fenster ändert nur dieses (rechts Kapitel 2, links Kapitel 1)",
    panes()[1].querySelector("[data-fv-chapter]").value === K2 && panes()[0].querySelector("[data-fv-chapter]").value === K1);
  fire(panes()[0].querySelector("[data-fv-zoom-in]"), "click");
  check("Zoom je Fenster unabhängig", panes()[0].querySelector("[data-fv-zoom-label]").textContent === "110 %" && panes()[1].querySelector("[data-fv-zoom-label]").textContent === "100 %");
  check("Zuletzt bedientes Fenster ist aktiv markiert", panes()[0].classList.contains("active") && !panes()[1].classList.contains("active"));
  key("ArrowRight");
  check("Tastatur blättert im aktiven (linken) Fenster", panes()[0].querySelector("[data-fv-chapter]").value === K2 && panes()[1].querySelector("[data-fv-chapter]").value === K2);

  // Gesamtes Dokument im Vollbild-Fenster: Blaettern springt zur naechsten Kapitelueberschrift.
  const allSel = panes()[1].querySelector("[data-fv-chapter]");
  allSel.value = allSel.options[0].value; fire(allSel, "change");
  check("Fenster-Auswahl 'Gesamtes Dokument' zeigt alle Kapitel", panes()[1].querySelectorAll("h2.final-doc-chapter").length === 3 && panes()[1].querySelectorAll(".final-viewer-figure img").length === 4);
  check("Position 'Gesamtes Dokument · Kapitel 1 von 3'", panes()[1].querySelector("[data-fv-pos]").textContent === "Gesamtes Dokument · Kapitel 1 von 3");
  fire(panes()[1].querySelector("[data-fv-next]"), "click");
  check("Weiter im Gesamtdokument springt zu Kapitel 2", win.__lastScrolledInto && win.__lastScrolledInto.getAttribute("data-final-chapter-anchor") === "1" &&
    panes()[1].querySelector("[data-fv-pos]").textContent === "Gesamtes Dokument · Kapitel 2 von 3");
  fire(panes()[1].querySelector("[data-fv-prev]"), "click");
  check("Zurück im Gesamtdokument springt zu Kapitel 1", win.__lastScrolledInto.getAttribute("data-final-chapter-anchor") === "0");

  fire(doc.getElementById("final-viewer-toggle-btn"), "click");
  check("'Nur aktives Fenster' reduziert auf das aktive Fenster", panes().length === 1);
  fire(doc.getElementById("final-viewer-toggle-btn"), "click");
  check("'Beide Fenster' öffnet das zweite wieder", panes().length === 2);
  fire(doc.getElementById("final-viewer-close-btn"), "click");
  check("Schließen-Button schließt", viewer.hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE FINAL-ERGEBNIS-VOLLBILD-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
