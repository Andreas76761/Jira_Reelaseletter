// v2.176.0: Sparten Pkw/Van/beide (Bus/Truck entfernt), Register Regelwerk (allgemeine und Kapitel-Regeln: KI-Regeln in
// den Prompts, feste Regeln in FINAL, Editor, Unterkapitel und Dokument-Review R1) und im FINAL-Ergebnis die Kapitel
// „Intern“ / „In Planung“ (markierten Text vormerken = aus dem Handbuch entfernen, zurückholen, neu entfernen in neuen
// Ständen, Word-Export).
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

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.claude = {
        use: (name) => {
          if (name === "sample") return Promise.resolve(function (input) { prompts.push(String(input)); return Promise.resolve({ text: "Neuer Kapiteltext im Testsystem.", truncated: false }); });
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
  async function confirmModal() { if (await waitUntil(() => !$("confirm-modal-overlay").hidden, 3000)) fire($("confirm-modal-ok-btn"), "click"); await waitUntil(() => $("confirm-modal-overlay").hidden, 3000); await wait(30); }
  // Text im Ergebnis („Neue Zusammenführung“) markieren wie mit der Maus
  function selectInMaster(text) {
    const out = $("final-result-master-output"), walker = doc.createTreeWalker(out, 4);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.data.indexOf(text);
      if (i !== -1) { const r = doc.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length); const sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; }
    }
    return false;
  }

  const CH1 = "Vertrag anlegen und speichern.\nGeplant für Q3: Export nach SAP.\n[Bild]\nWeitere Schritte im Testsystem folgen.";
  let s = await session();
  s.labels = (s.labels || []).concat([{ category: "Sparte", de: "Bus", en: "Bus" }, { category: "Sparte", de: "Truck", en: "Truck" }]);
  s.uploadedImages = [{ id: 301, filename: "maske.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", mimeType: "image/png", description: "Maske Vertrag" }];
  s.final.versions = [{ id: 1, name: "Basis", createdAt: "1.11.2026, 10:00:00", status: "Entwurf", statusChangedAt: "1.11.2026, 10:00:00", history: [], config: {}, origin: "FINAL", improvements: {}, improvementStatus: {}, reviews: [], notes: [],
    chapters: [{ title: "1 Vertrag", level: 1, text: CH1, markedText: CH1, screenIds: [301] }, { title: "2 Liste", level: 1, text: "Liste ansehen.\n\u0001Interner Hinweis zur Liste\u0002", markedText: "Liste ansehen.\n\u0001Interner Hinweis zur Liste\u0002", screenIds: [] },
      { title: "3 Doppelt", level: 1, text: "Hinweis beachten.\nErster Schritt ausführen.\nHinweis beachten.\nZweiter Schritt ausführen.", markedText: "Hinweis beachten.\nErster Schritt ausführen.\nHinweis beachten.\nZweiter Schritt ausführen.", screenIds: [] }] }];
  s.final.activeVersionId = 1;
  s.vrev = { docs: [{ id: 1, name: "Handbuch", version: "1.0", status: "Entwurf", source: "Upload", lang: "DE", chapters: [{ title: "1 Vertrag", level: 1, text: "Vertrag im Testsystem anlegen." }], ph: {}, checks: {}, steps: {}, history: [] }], activeId: null };
  await load(s);

  // ===================== Sparten =====================
  s = await session();
  const sp = s.labels.filter((l) => l.category === "Sparte").map((l) => l.de);
  check("Sparten: Bus und Truck beim Laden aus den Stammdaten entfernt, Pkw/Van bleiben", !sp.includes("Bus") && !sp.includes("Truck") && sp.includes("Pkw") && sp.includes("Van"));
  nav("final"); await wait(100);
  check("FINAL: Sparte-Filter voreingestellt auf „Pkw und Van (beide)“, Optionen genau Pkw/Van", $("final-filter-sparte-select").options[0].textContent === "Pkw und Van (beide)" && $("final-filter-sparte-select").value === "" &&
    Array.from($("final-filter-sparte-select").options).map((o) => o.value).join("|") === "|Pkw|Van");
  nav("edito"); await wait(80);
  check("Editor: Rolle/Sparte-Auswahl bietet „Pkw und Van (beide)“", Array.from($("edito-version-select").options).some((o) => o.value === "beide" && o.textContent === "Pkw und Van (beide)"));

  // ===================== Regelwerk anlegen =====================
  nav("regelwerk"); await wait(50);
  check("Register Regelwerk vorhanden, noch keine Regeln", !!$("rules-scope-select") && $("rules-count").textContent === "0" && !$("rules-empty").hidden);
  check("Geltungsbereich bietet Allgemein, Kapitel aus FINAL und „Anderes Kapitel“", $("rules-scope-select").options[0].textContent.startsWith("Allgemein") &&
    Array.from($("rules-scope-select").options).some((o) => o.value === "1 Vertrag") && Array.from($("rules-scope-select").options).some((o) => /Anderes Kapitel/.test(o.textContent)));
  async function addRule(scope, kind, value, custom) {
    $("rules-scope-select").value = scope; fire($("rules-scope-select"), "change");
    if (custom != null) $("rules-scope-custom").value = custom;
    $("rules-kind-select").value = kind; fire($("rules-kind-select"), "change");
    $("rules-value-input").value = value; fire($("rules-add-btn"), "click"); await wait(20);
  }
  await addRule("", "forbid", "");
  check("Leere Regel wird abgewiesen", /Bitte die Regel eingeben/.test($("rules-add-note").textContent) && $("rules-count").textContent === "0");
  await addRule("", "maxWords", "viele");
  check("„Höchstens N Wörter“ verlangt eine Zahl", /Zahl/.test($("rules-add-note").textContent) && $("rules-count").textContent === "0");
  await addRule("", "forbid", "Testsystem");
  await addRule("1 Vertrag", "maxWords", "8");
  await addRule("1 Vertrag", "require", "Servicevertrag");
  await addRule("", "ai", "Leser immer mit „Sie“ ansprechen.");
  await addRule("__rules_custom__", "forbid", "Liste", "Kapitel 2: Liste");
  check("5 Regeln angelegt und aufgelistet (allgemeine zuerst)", $("rules-count").textContent === "5" && $("rules-tbody").querySelectorAll("tr").length === 5 && $("rules-tbody").querySelector("tr").textContent.includes("Allgemein"));

  // ===================== Feste Regeln prüfen =====================
  fire($("rules-check-btn"), "click"); await wait(30);
  const res = Array.from($("rules-result-tbody").querySelectorAll("tr")).map((r) => Array.from(r.children).map((c) => c.textContent));
  const fin = res.filter((r) => r[0] === "FINAL");
  check("FINAL 1 Vertrag: verbotener Begriff, zu viele Wörter, Pflichtbegriff fehlt", fin.some((r) => r[2] === "1 Vertrag" && /Verbotener Begriff „Testsystem“ 1×/.test(r[4])) &&
    fin.some((r) => r[2] === "1 Vertrag" && /Wörter – erlaubt sind höchstens 8/.test(r[4])) && fin.some((r) => r[2] === "1 Vertrag" && /Pflichtbegriff „Servicevertrag“ fehlt/.test(r[4])));
  check("Kapitel-Regel greift auch bei abweichender Nummerierung („Kapitel 2: Liste“ = „2 Liste“)", fin.some((r) => r[2] === "2 Liste" && /Verbotener Begriff „Liste“/.test(r[4])));
  check("Kapitelregeln nur im eigenen Kapitel (2 Liste ohne Wörter-/Pflicht-Befund)", !fin.some((r) => r[2] === "2 Liste" && /Wörter|Pflicht/.test(r[4])));
  check("Dokument-Review-Dokument wird mitgeprüft", res.some((r) => r[0] === "Dokument-Review" && r[2] === "1 Vertrag" && /Testsystem/.test(r[4])));
  check("Status nennt Anzahl", /Geprüft am .*: \d+ Kapiteltext\(e\), \d+ Verstoß/.test($("rules-check-status").textContent));
  const cbMax = doc.querySelector('#rules-tbody tr:nth-child(4) [data-rule-active]');
  // Regel deaktivieren -> wird nicht mehr geprüft
  const maxRow = Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Höchstens"));
  const maxCb = maxRow.querySelector("[data-rule-active]"); maxCb.checked = false; fire(maxCb, "change");
  fire($("rules-check-btn"), "click"); await wait(30);
  check("Deaktivierte Regel wird nicht geprüft", !$("rules-result-tbody").textContent.includes("erlaubt sind höchstens") && !!cbMax);
  const maxCb2 = Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Höchstens")).querySelector("[data-rule-active]");
  maxCb2.checked = true; fire(maxCb2, "change");

  // ===================== FINAL-Ergebnis: Regelwerk-Hinweis =====================
  nav("final"); await wait(100);
  const csel = $("final-result-chapter-select");
  csel.value = "1 Vertrag"; fire(csel, "change"); await wait(30);
  check("FINAL-Ergebnis zeigt Regelwerk-Verstöße des Kapitels", !$("final-rules-note").hidden && /Regelwerk: 3 Verstoß/.test($("final-rules-note").textContent));

  // ===================== Intern / In Planung =====================
  check("Kapitelauswahl enthält „Intern“ und „In Planung“ (0 vorgemerkt)", Array.from(csel.options).some((o) => o.textContent === "Intern (0 vorgemerkt)") && Array.from(csel.options).some((o) => o.textContent === "In Planung (0 vorgemerkt)"));
  fire($("final-reserve-plan-btn"), "click"); await wait(20);
  check("Ohne Markierung: Hinweis statt Änderung", /zuerst .* markieren/.test($("final-reserve-note").textContent));
  check("Text markieren möglich", selectInMaster("Geplant für Q3: Export nach SAP."));
  fire($("final-reserve-plan-btn"), "click"); await wait(30);
  s = await session();
  let ch1 = s.final.versions[0].chapters[0];
  check("Als „In Planung“ vorgemerkt: ganze Zeile entfernt (keine Leerzeile), Rest unverändert", ch1.text === "Vertrag anlegen und speichern.\n[Bild]\nWeitere Schritte im Testsystem folgen." && ch1.markedText === ch1.text && ch1.screenIds.length === 1);
  check("Eintrag gespeichert mit Herkunft", s.final.reserved.length === 1 && s.final.reserved[0].kind === "planung" && s.final.reserved[0].chapter === "1 Vertrag" && s.final.reserved[0].versionName === "Basis");
  check("Ergebnis-Ansicht ohne den Abschnitt, Kapitelauswahl zählt 1", !$("final-result-master-output").textContent.includes("Geplant für Q3") && Array.from(csel.options).some((o) => o.textContent === "In Planung (1 vorgemerkt)"));
  // mit Bild: Abschnitt über das Bild hinweg
  csel.value = "1 Vertrag"; fire(csel, "change"); await wait(20);
  const bildText = Array.from($("final-result-master-output").childNodes).map((n) => n.textContent).join("").match(/\[Bild: [^\]]*\]/);
  check("Bild als Hinweis im Ergebnis", !!bildText);
  check("Abschnitt mit Bild markiert", selectInMaster(bildText[0] + "\nWeitere Schritte"));
  fire($("final-reserve-intern-btn"), "click"); await wait(30);
  s = await session(); ch1 = s.final.versions[0].chapters[0];
  check("Als „Intern“ vorgemerkt: Bildzeile und Screen mit entfernt", !ch1.text.includes("[Bild]") && ch1.screenIds.length === 0 && /^Vertrag anlegen und speichern\.\n+ im Testsystem folgen\.$/.test(ch1.text) && s.final.reserved[1].screenIds.join() === "301");
  // interner Vermerk (Markierung \u0001…\u0002) in Kapitel 2
  csel.value = "2 Liste"; fire(csel, "change"); await wait(20);
  check("Interner Vermerk markiert", selectInMaster("Interner Hinweis zur Liste"));
  fire($("final-reserve-intern-btn"), "click"); await wait(30);
  // v2.178: Markierung über 60 % des Kapitels -> Rückfrage
  check("v2.178: große Markierung (über 60 % des Kapitels) erst nach Rückfrage", !$("confirm-modal-overlay").hidden && /% des Kapitels „2 Liste“/.test($("confirm-modal-message").textContent));
  await confirmModal();
  s = await session();
  const ch2 = s.final.versions[0].chapters[1];
  check("Markierter interner Vermerk vorgemerkt, Markierungen bleiben ausgeglichen", !ch2.text.includes("Interner Hinweis") && (ch2.markedText.match(/\u0001/g) || []).length === (ch2.markedText.match(/\u0002/g) || []).length);

  // v2.178: mehrdeutige Markierung wird nicht geraten; aufgehobene Markierung zählt nicht mehr
  csel.value = "3 Doppelt"; fire(csel, "change"); await wait(20);
  selectInMaster("Hinweis beachten.");
  fire($("final-reserve-intern-btn"), "click"); await wait(30);
  s = await session();
  check("v2.178: Text kommt mehrfach vor -> Hinweis, nichts entfernt", /mehrfach vor/.test($("final-reserve-note").textContent) && s.final.versions[0].chapters[2].text.split("Hinweis beachten.").length === 3);
  selectInMaster("Zweiter Schritt ausführen.");
  win.getSelection().removeAllRanges(); fire(doc, "selectionchange"); await wait(20);
  fire($("final-reserve-intern-btn"), "click"); await wait(30);
  s = await session();
  check("v2.178: aufgehobene Markierung wird nicht nachträglich vorgemerkt", /zuerst .* markieren/.test($("final-reserve-note").textContent) && s.final.versions[0].chapters[2].text.includes("Zweiter Schritt"));

  // Kapitel „Intern“ ansehen, als Word exportieren
  csel.value = "__final_intern__"; fire(csel, "change"); await wait(30);
  const list = $("final-result-master-output");
  check("Kapitel „Intern“ zeigt 2 Abschnitte mit Herkunft", list.querySelectorAll("[data-final-reserve-id]").length === 2 && list.textContent.includes("Aus „1 Vertrag“") && list.textContent.includes("Aus „2 Liste“") && list.textContent.includes("1 Bild(er)"));
  savedFiles.length = 0;
  fire(list.querySelector("[data-final-reserve-export]"), "click");
  await waitUntil(() => savedFiles.length === 1, 5000);
  let docxText = "";
  if (savedFiles[0]) { const z = await JSZipNode.loadAsync(savedFiles[0].data instanceof win.Blob ? Buffer.from(await savedFiles[0].data.arrayBuffer()) : savedFiles[0].data, { base64: typeof savedFiles[0].data === "string" }); docxText = await z.file("word/document.xml").async("string"); }
  check("Word-Export „Intern“ mit beiden Abschnitten", savedFiles.length === 1 && /FINAL_Intern_\d{4}-\d{2}-\d{2}\.docx/.test(savedFiles[0].filename) && docxText.includes("Interner Hinweis zur Liste") && docxText.includes("Weitere Schritte") && !docxText.includes("[Bild]"));

  // Zurückholen (Kapitel 1, Abschnitt mit Bild) -> wieder an alter Stelle mit Screen
  const restoreBtn = Array.from(list.querySelectorAll("[data-final-reserve-id]")).find((e) => e.textContent.includes("Aus „1 Vertrag“")).querySelector("[data-final-reserve-restore]");
  fire(restoreBtn, "click"); await wait(30);
  s = await session(); ch1 = s.final.versions[0].chapters[0];
  check("Zurückgeholt: Bildzeile und Screen wieder an alter Stelle", ch1.text === "Vertrag anlegen und speichern.\n[Bild]\nWeitere Schritte im Testsystem folgen." && ch1.screenIds.join() === "301" && s.final.reserved.length === 2);
  // In Planung zurückholen -> Originaltext exakt
  csel.value = "__final_planung__"; fire(csel, "change"); await wait(20);
  fire($("final-result-master-output").querySelector("[data-final-reserve-restore]"), "click"); await wait(30);
  s = await session(); ch1 = s.final.versions[0].chapters[0];
  check("Beide zurückgeholt: Kapitel 1 wieder exakt wie vorher", ch1.text === CH1 && ch1.markedText === CH1);

  // v2.179: mehrere Abschnitte (auch benachbarte und mit Bild) vormerken und in beliebiger Reihenfolge zurückholen -> exakt
  const CH4 = "A erste Zeile.\nB zweite Zeile.\nC dritte Zeile.\n[Bild]\nD vierte Zeile.\nE fünfte Zeile.";
  s = await session();
  s.final.versions[0].chapters.push({ title: "4 Reihenfolge", level: 1, text: CH4, markedText: CH4, screenIds: [301] });
  await load(s);
  nav("final"); await wait(80);
  async function markIn4(text, kind) {
    const cs = $("final-result-chapter-select"); cs.value = "4 Reihenfolge"; fire(cs, "change"); await wait(20);
    if (!selectInMaster(text)) return false;
    fire($(kind === "intern" ? "final-reserve-intern-btn" : "final-reserve-plan-btn"), "click"); await wait(30);
    if (!$("confirm-modal-overlay").hidden) await confirmModal();
    return true;
  }
  const bildIn4 = () => { const m = $("final-result-master-output").textContent.match(/\[Bild: [^\]]*\]/); return m ? m[0] : ""; };
  await markIn4("B zweite Zeile.", "intern");
  await markIn4("C dritte Zeile.", "intern");      // direkt anschließend (gleiche Verankerung wie B)
  const cs4 = $("final-result-chapter-select"); cs4.value = "4 Reihenfolge"; fire(cs4, "change"); await wait(20);
  await markIn4(bildIn4() + "\nD vierte Zeile.", "planung");
  await markIn4("A erste Zeile.", "planung");
  s = await session();
  let ch4 = s.final.versions[0].chapters.filter((c) => c.title === "4 Reihenfolge")[0];
  check("v2.179: vier Abschnitte vorgemerkt, Rest „E fünfte Zeile.“, Screen mit entfernt", ch4.text === "E fünfte Zeile." && ch4.screenIds.length === 0);
  async function restore4(prefix) {
    for (const k of ["__final_intern__", "__final_planung__"]) {
      const cs = $("final-result-chapter-select"); cs.value = k; fire(cs, "change"); await wait(20);
      const e = Array.from($("final-result-master-output").querySelectorAll("[data-final-reserve-id]")).find((x) => x.textContent.includes("Aus „4 Reihenfolge“") && x.textContent.includes(prefix));
      if (e) { fire(e.querySelector("[data-final-reserve-restore]"), "click"); await wait(30); return true; }
    }
    return false;
  }
  // Reihenfolge bewusst durcheinander: C, A, D(+Bild), B
  await restore4("C dritte"); await restore4("A erste"); await restore4("D vierte"); await restore4("B zweite");
  s = await session();
  ch4 = s.final.versions[0].chapters.filter((c) => c.title === "4 Reihenfolge")[0];
  check("v2.179: in beliebiger Reihenfolge zurückgeholt – Kapitel wieder exakt wie vorher (Text, Bild, Screen)", ch4.text === CH4 && ch4.markedText === CH4 && ch4.screenIds.join() === "301");
  for (const order of [["D vierte", "C dritte", "B zweite", "A erste"], ["B zweite", "D vierte", "A erste", "C dritte"]]) {
    await markIn4("B zweite Zeile.", "intern"); await markIn4("C dritte Zeile.", "intern");
    const c4 = $("final-result-chapter-select"); c4.value = "4 Reihenfolge"; fire(c4, "change"); await wait(20);
    await markIn4(bildIn4() + "\nD vierte Zeile.", "planung"); await markIn4("A erste Zeile.", "planung");
    for (const p of order) await restore4(p);
    s = await session();
    ch4 = s.final.versions[0].chapters.filter((c) => c.title === "4 Reihenfolge")[0];
    check("v2.179: Reihenfolge " + order.map((x) => x[0]).join("-") + " – Kapitel exakt wie vorher", ch4.text === CH4 && ch4.screenIds.join() === "301");
  }

  // Erneut vormerken und neuen Stand anlegen (Dokument-Review -> FINAL): Abschnitt bleibt entfernt
  csel.value = "1 Vertrag"; fire(csel, "change"); await wait(20);
  selectInMaster("Geplant für Q3: Export nach SAP.");
  fire($("final-reserve-plan-btn"), "click"); await wait(30);
  s = await session();
  s.vrev.docs[0].chapters = [{ title: "1 Vertrag", level: 1, text: "Einleitung.\nGeplant für Q3: Export nach SAP.\nEnde." }];
  await load(s);
  nav("variante"); await wait(100);
  fire(doc.querySelector('[data-vrev-act="open"][data-id="1"]'), "click"); await wait(50);
  fire($("vrev-run-btn"), "click"); await wait(100);
  s = await session();
  const r1 = s.vrev.docs[0].checks.R1;
  check("Dokument-Review: Prüfung R1 Regelwerk meldet Verstöße (Pflichtbegriff fehlt)", r1 && r1.s === "fail" && /Pflichtbegriff „Servicevertrag“ fehlt/.test(r1.d));
  check("v2.178: Regelwerk-Verstoß blockiert „Bereit für die Verteilung“ (F1 nennt R1)", s.vrev.docs[0].checks.F1 && /Offene Fehler: .*R1/.test(s.vrev.docs[0].checks.F1.d));
  check("Dokument-Review: 21 Prüfungen", Object.keys(s.vrev.docs[0].checks).length === 21 && /^21 Prüfungen ausgeführt/.test($("vrev-status").textContent));
  fire(doc.querySelector('.vrev-stage-btn[data-stage="7"]'), "click"); await wait(50);
  const toFinal = doc.querySelector('[data-vrev-act="to-final"]');
  check("Übernahme nach FINAL verfügbar", !!toFinal);
  if (toFinal) { fire(toFinal, "click"); await wait(80); }
  s = await session();
  const nv = s.final.versions[s.final.versions.length - 1];
  check("Neuer Stand: vorgemerkter Abschnitt automatisch wieder entfernt", s.final.versions.length === 2 && nv.chapters[0].text.replace(/\n+/g, " ") === "Einleitung. Ende." && s.final.reserved.length === 2);

  // KI-Regeln im Prompt (Editor-Kapitel erzeugen)
  nav("edito"); await wait(80);
  $("edito-version-select").value = "beide"; fire($("edito-version-select"), "change"); await wait(100);
  const genBtn = $("edito-chapters-tbody").querySelector("[data-edito-generate]");
  const genTitle = genBtn && genBtn.getAttribute("data-edito-generate");
  if (genBtn) { fire(genBtn, "click"); await waitUntil(() => prompts.length > 0, 3000); await wait(100); }
  const pr = prompts[prompts.length - 1] || "";
  check("Editor-Prompt enthält das Regelwerk (allgemeine KI-Regel und verbotenen Begriff)", /REGELWERK \(vom Nutzer festgelegt, verbindlich; beim Schreiben einhalten\)/.test(pr) && pr.includes("[allgemein] Leser immer mit „Sie“ ansprechen.") && pr.includes("Den Begriff „Testsystem“ nicht verwenden."));
  check("Editor-Prompt ohne Kapitel-Regeln fremder Kapitel", !pr.includes("Servicevertrag") || /Vertrag/.test(genTitle || ""));
  // v2.177: Hinweis unter der Vorschau und in der Kapitelliste, live beim Bearbeiten
  check("v2.177: Editor-Vorschau zeigt Regelwerk-Verstoß", !$("edito-rules-note").hidden && /Regelwerk: \d+ Verstoß/.test($("edito-rules-note").textContent) && $("edito-rules-note").textContent.includes("Testsystem"));
  check("v2.177: Kapitelliste markiert das Kapitel mit „Regelwerk: n“", !!$("edito-chapters-tbody").querySelector('[data-edito-rules="' + genTitle + '"]'));
  $("edito-preview-output").value = "Neuer Kapiteltext ohne verbotene Begriffe."; fire($("edito-preview-output"), "input"); await wait(20);
  check("v2.177: nach dem Bearbeiten live neu geprüft", /alle festen Regeln eingehalten/.test($("edito-rules-note").textContent));
  $("edito-preview-output").value = "Neuer Kapiteltext im Testsystem."; fire($("edito-preview-output"), "input"); await wait(20);
  s = await session();
  check("Editor: Regelverstoß gleich nach der Erzeugung vermerkt", s.editoChapters[genTitle] && (s.editoChapters[genTitle].ruleIssues || []).some((m) => /Testsystem/.test(m)));

  // v2.177: Unterkapitel-Werkstatt – Hinweis unter der aktuellen Fassung (Regeln des Kapitels und allgemeine)
  nav("unterkapitel"); await wait(100);
  $("subchapter-version-select").value = "beide"; fire($("subchapter-version-select"), "change"); await wait(80);
  $("subchapter-chapter-select").value = "Kapitel 4: Servicevertrag anlegen"; fire($("subchapter-chapter-select"), "change"); await wait(50);
  $("subchapter-select").value = "4.1 Vertragsarten"; fire($("subchapter-select"), "change"); await wait(50);
  check("v2.177: Unterkapitel ohne Fassung – kein Regelwerk-Hinweis", $("subchapter-rules-note").hidden);
  const before = prompts.length;
  fire($("subchapter-edit-btn"), "click"); await waitUntil(() => prompts.length > before, 3000); await wait(150);
  check("v2.177: Unterkapitel-Prompt enthält das Regelwerk", /REGELWERK/.test(prompts[prompts.length - 1]) && prompts[prompts.length - 1].includes("Den Begriff „Testsystem“ nicht verwenden."));
  check("v2.177: Unterkapitel zeigt Regelwerk-Verstoß unter der aktuellen Fassung", !$("subchapter-rules-note").hidden && $("subchapter-rules-note").textContent.includes("Testsystem"));

  // Sitzung: Regeln gespeichert und nach dem Laden wieder da; Löschen
  check("Sitzung speichert die Regeln", s.rules && s.rules.items.length === 5 && s.rules.items.some((r) => r.kind === "ai") && s.rules.lastCheck && s.rules.lastCheck.results.length > 0);
  await load(s);
  nav("regelwerk"); await wait(50);
  check("Nach dem Laden: 5 Regeln", $("rules-count").textContent === "5");
  fire($("rules-tbody").querySelector("[data-rule-delete]"), "click"); await confirmModal();
  check("Regel löschen (nach Bestätigung)", $("rules-count").textContent === "4");

  // v2.180: Regelwerk exportieren / importieren (doppelte werden übersprungen)
  savedFiles.length = 0;
  fire($("rules-export-btn"), "click"); await waitUntil(() => savedFiles.length === 1, 5000);
  const exp = savedFiles[0] ? JSON.parse(typeof savedFiles[0].data === "string" ? savedFiles[0].data : await savedFiles[0].data.text()) : null;
  check("v2.180: Export als JSON mit 4 Regeln", !!exp && /^Regelwerk_\d{4}-\d{2}-\d{2}\.json$/.test(savedFiles[0].filename) && exp.format === "ticket-cockpit-regelwerk" && exp.items.length === 4 && exp.items.some((r) => r.kind === "ai"));
  async function importRules(obj, name) {
    const inp = $("rules-import-input");
    Object.defineProperty(inp, "files", { value: [new win.File([JSON.stringify(obj)], name, { type: "application/json" })], configurable: true });
    fire(inp, "change"); await waitUntil(() => /übernommen|fehlgeschlagen/.test($("rules-io-note").textContent) && $("rules-io-note").textContent.includes(name.replace(".json", "")) || /fehlgeschlagen/.test($("rules-io-note").textContent), 3000); await wait(20);
  }
  await importRules(exp, "gleich.json");
  check("v2.180: Import derselben Datei – nichts doppelt", $("rules-count").textContent === "4" && /0 Regel\(n\) übernommen, 4 bereits vorhanden/.test($("rules-io-note").textContent));
  await importRules({ items: [{ scope: "", kind: "forbid", value: "Beta-Version" }, { scope: "x", kind: "unbekannt", value: "y" }] }, "neu.json");
  check("v2.180: Import ergänzt neue Regel, ungültige werden ignoriert", $("rules-count").textContent === "5" && /1 Regel\(n\) übernommen/.test($("rules-io-note").textContent));
  await importRules({ items: [{ scope: "", kind: "maxWords", value: "abc" }, { scope: "  1 Vertrag ", kind: "maxWords", value: "250 Wörter" }] }, "zahlen.json");
  s = await session();
  check("v2.182: Import – „Höchstens N Wörter“ ohne gültige Zahl ignoriert, „250 Wörter“ als 250 übernommen", $("rules-count").textContent === "6" && s.rules.items.some((r) => r.kind === "maxWords" && r.value === "250" && r.scope === "1 Vertrag") && !s.rules.items.some((r) => r.value === "abc"));
  $("rules-io-note").textContent = "";
  await importRules({ foo: 1 }, "kaputt.json");
  check("v2.180: ungültige Datei -> Fehlermeldung", /Import fehlgeschlagen/.test($("rules-io-note").textContent) && $("rules-count").textContent === "6");

  // v2.180: Veröffentlichen eines Stands mit Regelwerk-Verstößen erst nach Rückfrage
  nav("final"); await wait(100);
  $("final-reviewer-input").value = "A. Muster"; fire($("final-reviewer-input"), "input"); fire($("final-reviewer-input"), "change");
  const stSel = doc.querySelector("#final-versions-tbody tr [data-final-version-status]");
  stSel.value = "Veröffentlicht"; fire(stSel, "change"); await wait(50);
  check("v2.180: Veröffentlichen mit Verstößen -> Rückfrage nennt die Verstöße", !$("confirm-modal-overlay").hidden && /verletzt \d+ feste Regel/.test($("confirm-modal-message").textContent));
  fire($("confirm-modal-cancel-btn"), "click"); await wait(80);
  s = await session();
  check("v2.180: abgebrochen -> Stand bleibt unveröffentlicht", s.final.versions.every((v) => v.status !== "Veröffentlicht"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
