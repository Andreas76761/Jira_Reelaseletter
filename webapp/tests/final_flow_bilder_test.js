// v2.186.0: FINAL – Ablaufleiste links (vertikaler Prozess mit den Daten je Schritt), Bilder aus dem Register „Bilder“
// mit Zuordnungsvorschlag (Kapitel aus dem Register bzw. Begriffs-Treffer) für den Master, Schritt 7: links frei wählbare
// Originaldatei (mit eingebetteten Bildern), rechts das finale Dokument mit Bildern; Vormerken über Abbildungen hinweg.
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
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.Element.prototype.scrollIntoView = function () { window.__scrolled = this; };
      window.claude = {
        use: (name) => {
          if (name === "downloads") return Promise.resolve({ save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
          return Promise.resolve(null);
        },
      };
    },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  async function session() { savedFiles.length = 0; fire($("session-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 8000); return JSON.parse(savedFiles[0].data); }
  async function load(s) {
    const imp = $("session-import-input");
    Object.defineProperty(imp, "files", { value: [new win.File([JSON.stringify(s)], "s.json")], configurable: true });
    fire(imp, "change");
    if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 15000)) fire($("confirm-modal-ok-btn"), "click");
    await waitUntil(() => $("confirm-modal-overlay").hidden, 5000);
    await wait(400);
  }
  async function confirmModal() { if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 1500)) fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(30); }
  const flowStep = (n) => doc.querySelector('#final-flow-list [data-final-flow-step="' + n + '"]');
  const bilderRow = (id) => doc.querySelector('#final-bilder-tbody [data-final-bilder-row="' + id + '"]');
  const ch = (title, text, emb) => Object.assign({ title, level: 1, fullText: text, cleanText: text, markedText: text }, emb ? { embedded: emb } : {});

  let s = await session();
  s.final.manuals = [
    { id: 1, filename: "Handbuch_A.docx", addedAt: "1.11.2026", pageCount: 3, design: null, embeddedImages: 1,
      chapters: [ch("1 Vertrag anlegen", "Vertrag anlegen und speichern.\n[Bild: Maske A]\nWeiter.", [{ id: 401, ph: "[Bild: Maske A]" }]), ch("2 Kundenliste", "Die Kundenliste zeigt alle Kunden mit Filter.")] },
    { id: 2, filename: "Handbuch_B.docx", addedAt: "1.11.2026", pageCount: 1, design: null, chapters: [ch("1 Vertrag anlegen", "Fassung B: Vertrag anlegen.")] },
  ];
  s.final.versions = []; s.final.activeVersionId = null;
  s.uploadedImages = [
    { id: 401, filename: "Handbuch_A.docx - Bild 1", dataUrl: PNG, description: "Maske A", finalManualId: 1, chapter: "" },
    { id: 402, filename: "kundenliste_filter.png", dataUrl: PNG, description: "Kundenliste mit Filter", chapter: "" },
    { id: 403, filename: "maske2.png", dataUrl: PNG, description: "", chapter: "Vertrag anlegen" },
    { id: 404, filename: "xyz.png", dataUrl: PNG, description: "", chapter: "" },
    { id: 405, filename: "screens.pdf - Bild 1", dataUrl: PNG, description: "Screen", finalScreensFileId: 9, chapter: "" },
  ];
  await load(s);
  nav("final"); await wait(120);

  // ===================== Ablaufleiste =====================
  const layout = doc.querySelector('[data-view-panel="final"] > .final-layout');
  check("Ablaufleiste links neben dem FINAL-Inhalt (alle 9 Schritte im Hauptbereich)", !!layout && layout.firstElementChild.id === "final-flow" && layout.querySelector(".final-main").querySelectorAll(".final-step-label").length === 9);
  check("9 Schritte vertikal aufgelistet", doc.querySelectorAll("#final-flow-list > li").length === 9);
  check("Schritt 1 erledigt: Dateien, Kapitel, eingebettete Bilder", flowStep(1).dataset.finalFlowState === "done" && /2 \.docx-Datei\(en\)/.test(flowStep(1).textContent) && /3 Kapitel erkannt/.test(flowStep(1).textContent) && /1 eingebettete/.test(flowStep(1).textContent));
  check("Schritt 2: 1 Kapitel in mehreren Dateien", flowStep(2).dataset.finalFlowState === "done" && /1 Kapitel in mehreren Dateien/.test(flowStep(2).textContent));
  check("Schritt 3 zeigt die Bereinigung (interne Vermerke / Jira)", /Interne Vermerke: sichtbar/.test(flowStep(3).textContent) && /Jira-Nummern: sichtbar/.test(flowStep(3).textContent));
  check("Schritt 6 offen, Schritt 7 wartet (noch kein Stand)", flowStep(6).dataset.finalFlowState === "open" && flowStep(7).dataset.finalFlowState === "wait" && /wartet auf Schritt 6/.test(flowStep(7).textContent));
  fire(flowStep(1).querySelector("[data-final-flow-goto]"), "click");
  check("Klick springt zum Schritt", !!win.__scrolled && win.__scrolled.querySelector(".final-step-label").textContent.includes("1. Benutzerhandbuch-Dateien"));

  // ===================== Bilder aus dem Register „Bilder“ =====================
  check("Bilder-Liste: nur Register-Bilder (ohne Screens-Datei und eingebettete Handbuch-Bilder)", $("final-bilder-count").textContent === "3" && !!bilderRow(402) && !!bilderRow(403) && !!bilderRow(404) && !bilderRow(401) && !bilderRow(405));
  check("Vorschlag aus dem Kapitel im Register „Bilder“ (100 %)", bilderRow(403).children[2].textContent.includes("1 Vertrag anlegen") && bilderRow(403).children[3].textContent === "100 %");
  const sc402 = parseInt(bilderRow(402).children[3].textContent, 10);
  check("Vorschlag über Begriffe (Überschrift + Text)", bilderRow(402).children[2].textContent.includes("2 Kundenliste") && /kundenliste/.test(bilderRow(402).children[2].textContent) && sc402 > 0 && sc402 <= 90);
  check("Ohne Anhaltspunkte kein Vorschlag", bilderRow(404).children[2].textContent.includes("kein Vorschlag") && bilderRow(404).children[3].textContent === "–");
  check("„Vorschläge übernehmen“ aktiv, 2 offen", !$("final-bilder-apply-btn").disabled && /0 von 3 .* 2 Vorschlag/.test($("final-bilder-note").textContent));
  fire($("final-bilder-apply-btn"), "click"); await wait(20);
  check("Vorschläge übernommen", bilderRow(402).querySelector("select").value === "2 Kundenliste" && bilderRow(403).querySelector("select").value === "1 Vertrag anlegen" && bilderRow(404).querySelector("select").value === "" &&
    bilderRow(403).textContent.includes("übernommen") && /2 von 3/.test($("final-bilder-note").textContent) && $("final-bilder-apply-btn").disabled);
  await wait(10);
  check("Ablaufleiste: Schritt 5 zählt übernommene Register-Bilder", /2\/3 Bilder aus Register/.test(flowStep(5).textContent) && flowStep(5).dataset.finalFlowState === "done");
  let sel402 = bilderRow(402).querySelector("select"); sel402.value = ""; fire(sel402, "change"); await wait(10);
  check("„nicht verwenden“: bleibt beim erneuten Übernehmen abgelehnt", bilderRow(402).textContent.includes("nicht verwenden") && $("final-bilder-apply-btn").disabled);
  sel402 = bilderRow(402).querySelector("select"); sel402.value = "2 Kundenliste"; fire(sel402, "change"); await wait(10);

  // ===================== Master zusammenführen =====================
  fire($("final-build-master-btn"), "click");
  await waitUntil(() => $("final-build-master-status-note").textContent.includes("zusammengeführt"), 10000); await wait(50);
  s = await session();
  const v = s.final.versions[0], c1 = v.chapters.find((c) => c.title === "1 Vertrag anlegen"), c2 = v.chapters.find((c) => c.title === "2 Kundenliste");
  check("Master: eingebettetes Bild an seiner Stelle, Register-Bild am Kapitelende", c1.screenIds.join(",") === "401,403" && c1.text === "Vertrag anlegen und speichern.\n[Bild]\nWeiter.\n[Bild]");
  check("Master: Begriffs-Vorschlag im Kapitel 2", c2.screenIds.join(",") === "402");
  check("Zuordnung gespeichert (Sitzung)", s.uploadedImages.find((i) => i.id === 402).finalUseChapter === "2 Kundenliste" && s.uploadedImages.find((i) => i.id === 404).finalUseChapter === undefined);
  await wait(10);
  check("Ablaufleiste: Schritt 6 erledigt mit Stand, Kapiteln und Bildern", flowStep(6).dataset.finalFlowState === "done" && /2 Kapitel · 3 Bild\(er\)/.test(flowStep(6).textContent));

  // ===================== Schritt 7: Originaldatei vs. finales Dokument =====================
  const cs = $("final-result-chapter-select"); cs.value = "1 Vertrag anlegen"; fire(cs, "change"); await wait(20);
  check("Rechts: finales Dokument mit beiden Bildern", $("final-result-master-output").querySelectorAll("figure img").length === 2 && $("final-result-images-cb").checked);
  check("Links: Original (Quelle des Stands) mit eingebettetem Bild an seiner Stelle", $("final-result-source-output").querySelectorAll("figure img").length === 1 && $("final-result-source-output").textContent.includes("Vertrag anlegen und speichern.") && !$("final-result-source-output").textContent.includes("[Bild: Maske A]"));
  const srcSel = $("final-result-source-file-select");
  check("Auswahl Originaldatei: Quelle des Stands + alle Dateien", Array.from(srcSel.options).map((o) => o.textContent).join("|") === "Quelle des Stands (Konflikt-Auswahl)|Handbuch_A.docx|Handbuch_B.docx");
  srcSel.value = "2"; fire(srcSel, "change"); await wait(20);
  check("Andere Originaldatei links", $("final-result-source-output").textContent.includes("Fassung B: Vertrag anlegen.") && $("final-result-source-head").textContent === "Originaldatei: Handbuch_B.docx");
  cs.value = "2 Kundenliste"; fire(cs, "change"); await wait(20);
  check("Kapitel fehlt in der gewählten Datei -> Hinweis", /kommt in „Handbuch_B\.docx“ nicht vor/.test($("final-result-source-output").textContent));
  await wait(10);
  check("Ablaufleiste: Schritt 7 nennt die Originaldatei", /links: Handbuch_B\.docx/.test(flowStep(7).textContent) && /mit Bildern/.test(flowStep(7).textContent));
  $("final-result-images-cb").checked = false; fire($("final-result-images-cb"), "change"); await wait(20);
  check("Ohne Bilder: Bild als lesbarer Hinweis", $("final-result-master-output").querySelectorAll("figure").length === 0 && $("final-result-master-output").textContent.includes("[Bild: Kundenliste mit Filter]"));
  $("final-result-images-cb").checked = true; fire($("final-result-images-cb"), "change"); await wait(20);
  s = await session();
  check("Originaldatei und Bilder-Schalter in der Sitzung", s.final.resultSourceManualId === 2 && s.final.resultImages === true);
  await load(s); nav("final"); await wait(80);
  check("Nach dem Laden: Originaldatei bleibt gewählt", $("final-result-source-file-select").value === "2");
  srcSel.value = ""; fire($("final-result-source-file-select"), "change"); await wait(20);

  // ===================== Vormerken über eine Abbildung hinweg =====================
  cs.value = "1 Vertrag anlegen"; fire(cs, "change"); await wait(20);
  const out = $("final-result-master-output"), walker = doc.createTreeWalker(out, 4);
  let n, n1 = null, n2 = null;
  while ((n = walker.nextNode())) { if (!n1 && n.data.includes("speichern.")) n1 = n; else if (n1 && !n2 && n.data.includes("Weiter.")) n2 = n; }
  const r = doc.createRange(); r.setStart(n1, n1.data.indexOf("speichern.")); r.setEnd(n2, n2.data.indexOf("Weiter.") + 7);
  win.getSelection().removeAllRanges(); win.getSelection().addRange(r);
  fire($("final-reserve-intern-btn"), "click"); await wait(30);
  if (!$("confirm-modal-overlay").hidden) await confirmModal();
  s = await session();
  let k1 = s.final.versions[0].chapters.find((c) => c.title === "1 Vertrag anlegen");
  check("Markierung über das Bild hinweg vorgemerkt (Bild wandert mit)", !k1.text.includes("speichern") && !k1.text.includes("Weiter.") && k1.screenIds.join(",") === "403" && s.final.reserved.length === 1 && s.final.reserved[0].screenIds.join(",") === "401");
  cs.value = "__final_intern__"; fire(cs, "change"); await wait(20);
  fire($("final-result-master-output").querySelector("[data-final-reserve-restore]"), "click"); await wait(30);
  s = await session(); k1 = s.final.versions[0].chapters.find((c) => c.title === "1 Vertrag anlegen");
  check("Zurückgeholt: Kapitel exakt wie vorher", k1.text === "Vertrag anlegen und speichern.\n[Bild]\nWeiter.\n[Bild]" && k1.screenIds.join(",") === "401,403" && s.final.reserved.length === 0);

  // Register „Bilder“: Bild löschen -> aus der FINAL-Liste
  s = await session(); s.uploadedImages = s.uploadedImages.filter((i) => i.id !== 404); await load(s); nav("final"); await wait(80);
  check("Gelöschtes Register-Bild verschwindet aus der Liste", $("final-bilder-count").textContent === "2" && !bilderRow(404));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
