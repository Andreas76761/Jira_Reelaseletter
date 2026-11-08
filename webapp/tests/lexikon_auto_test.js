// v2.187.0: Glossar, Synonyme und Abkürzungen erweitern sich automatisch um neue Begriffe aus den Inhalten (Tickets,
// FINAL-Handbuchdateien, Editor/Unterkapitel/Dokument-Review, ROVO); Neuerungen sind markiert („neu“, Liste „Neu erkannt“,
// „+n“ in der Navigation) und lassen sich übernehmen oder verwerfen (verworfene kommen nicht wieder). Regelwerk: Regeln
// bearbeiten (ergänzen) zusätzlich zu Anlegen/Löschen.
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

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
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
  const newRows = (k) => Array.from(doc.querySelectorAll("#lex-auto-" + k + " [data-lex-idx]"));
  const newTerms = (k) => newRows(k).map((r) => r.querySelector("b").textContent);
  const lexBadge = (v) => { const sp = doc.querySelector('.nav-item[data-view="' + v + '"] .nav-lexnew'); return sp ? sp.getAttribute("data-n") : ""; };

  // ===================== Inhalte: Tickets + FINAL-Handbuch + ROVO =====================
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>LEX-1</key><summary>Market Operation (MO) prüft den Servicevertrag</summary><description>Die Fahrzeug-Identifizierungsnummer (FIN) wird im Servicevertrag gespeichert. Danach folgt die MO-Freigabe.</description><status>Offen</status></item>
    <item><key>LEX-2</key><summary>Service-Vertrag kündigen</summary><description>Der Service-Vertrag wird über die Vertragsübersicht gekündigt. Die FIN bleibt erhalten. Siehe ONESCM-1234.</description><status>Offen</status></item>
    <item><key>LEX-3</key><summary>E-Mail an MO</summary><description>Nach der Kündigung geht eine Email an die MO. Die Vertragsübersicht zeigt den Status.</description><status>Offen</status></item>
  </channel></rss>`;
  nav("import");
  const input = $("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "lex.xml", { type: "text/xml" })], configurable: true });
  fire(input, "change");
  await wait(500);
  let s = await session();
  const ch = (title, text) => ({ title, level: 1, fullText: text, cleanText: text, markedText: text });
  s.final.manuals = [{ id: 1, filename: "Handbuch.docx", addedAt: "8.11.2026", pageCount: 2, design: null, chapters: [
    ch("1 Vertrag", "Anschließend weiter. In der Vertragsübersicht öffnen Sie den Servicevertrag. Die E-Mail-Adresse steht im Kundenstamm. Kurzbezeichnung siehe Glossar. Rückfragen bitte per E-Mail."),
    ch("2 Kunden", "Der Kundenstamm enthält alle Kunden. Die Vertragsübersicht verlinkt den Kundenstamm. Anschließend speichern.\nAnschließend prüfen. Rückfragen klären.") ] }];
  s.rovoEntries = [{ id: 1, when: "8.11.2026", chatText: "Wie funktioniert der Kundenstamm?", answerText: "Anschließend suchen. Der Kundenstamm wird über die Email-Adresse gefunden.", chapter: "", subchapter: "", labels: ["ROVO"], jiraKeys: [], jiraVisible: false }];
  s.synonyms = [{ term: "Kündigung", synonyms: "Vertragskündigung", en: "Termination", sk: "", hi: "", fr: "", fixed: false }];
  s.abbrevTranslations = [{ term: "FIN", de: "Fahrzeug-Identifizierungsnummer", en: "VIN", sk: "", hi: "", fr: "", fixed: true }];
  s.lexAuto = { autoAccept: false, autoAi: false }; // v2.189: Prüf-Ablauf (Übernehmen/Verwerfen) testen
  await load(s);
  await wait(1600); // automatischer Lauf (verzögert)

  s = await session();
  const ab = s.abbrevTranslations, syn = s.synonyms, gl = s.glossaryTranslations;
  check("Automatischer Lauf nach Inhaltsänderung (Zeitpunkt + Anzahl Texte gespeichert)", !!s.lexAuto && s.lexAuto.enabled === true && s.lexAuto.lastRun && s.lexAuto.lastRun.texts === 6);
  const mo = ab.find((e) => e.term === "MO");
  check("Abkürzung MO neu mit Bedeutung aus dem Text („Market Operation (MO)“)", !!mo && mo.de === "Market Operation" && mo.isNew === true && mo.auto === true && /Tickets/.test(mo.lexSrc));
  check("Bereits vorhandene Abkürzung (FIN, fixiert) unverändert, nicht doppelt", ab.filter((e) => e.term === "FIN").length === 1 && ab.find((e) => e.term === "FIN").de === "Fahrzeug-Identifizierungsnummer" && !ab.find((e) => e.term === "FIN").isNew);
  check("Jira-Schlüssel (ONESCM-1234) wird nicht als Abkürzung erkannt", !ab.some((e) => e.term === "ONESCM"));
  const sv = syn.find((e) => /^service-?vertrag$/i.test(e.term));
  check("Synonym-Gruppe aus Schreibvarianten: Servicevertrag = Service-Vertrag", !!sv && sv.isNew && [sv.term].concat(sv.synonyms.split(",").map((x) => x.trim())).map((x) => x.toLowerCase()).sort().join("|") === "service-vertrag|servicevertrag");
  const em = syn.find((e) => /^e-?mail$/i.test(e.term));
  check("Synonym-Gruppe E-Mail = Email", !!em && /e-?mail/i.test(em.synonyms));
  check("Vorhandener Synonym-Eintrag bleibt unverändert, wenn nichts Neues", syn.find((e) => e.term === "Kündigung").synonyms === "Vertragskündigung" && !syn.find((e) => e.term === "Kündigung").isNew);
  const vu = gl.find((e) => e.term === "Vertragsübersicht"), ks = gl.find((e) => e.term === "Kundenstamm");
  check("Glossar: häufiger Fachbegriff Vertragsübersicht (in ≥ 3 Texten) neu, mit Fundstellen und Beispiel", !!vu && vu.isNew && vu.lexCount >= 3 && /Tickets/.test(vu.lexSrc) && /FINAL/.test(vu.lexSrc) && vu.lexExample.includes("Vertragsübersicht"));
  check("Glossar: Kundenstamm aus Handbuch und ROVO", !!ks && /ROVO/.test(ks.lexSrc));
  check("Glossar: seltener Begriff (nur 1 Text) wird nicht aufgenommen", !gl.some((e) => e.term === "Kurzbezeichnung"));
  check("Glossar: Wort nur am Satzanfang groß (z. B. „Anschließend“) zählt nicht", !gl.some((e) => /^(Anschließend|Rückfragen)$/.test(e.term)));

  // ===================== Neuerungen sichtbar =====================
  await wait(500);
  check("Navigation zeigt „+n“ bei Glossar, Synonyme, Abkürzungen", /^\+\d+$/.test(lexBadge("glossar")) && /^\+\d+$/.test(lexBadge("synonyme")) && /^\+\d+$/.test(lexBadge("abkuerzungen")));
  check("Registername in der Navigation bleibt reiner Text", doc.querySelector('.nav-item[data-view="glossar"] .nav-lexnew').textContent === "");
  nav("abkuerzungen"); await wait(50);
  check("Register Abkürzungen: Liste „Neu erkannt“ mit MO, Bedeutung und Fundstellen", newTerms("abbrev").includes("MO") && newRows("abbrev").find((r) => r.textContent.includes("Market Operation")) !== undefined && $("lex-auto-abbrev").textContent.includes("Neu erkannt"));
  check("Tabelle markiert neue Einträge mit „neu“", Array.from(doc.querySelectorAll("#abbrev-translations-tbody tr.lex-row-new")).some((r) => r.querySelector("input").value === "MO" && r.textContent.includes("neu")));
  // übernehmen
  fire(newRows("abbrev").find((r) => r.textContent.includes("Market Operation")).querySelector("[data-lex-accept]"), "click"); await wait(30);
  check("Übernehmen: MO nicht mehr neu, bleibt in der Liste", !newTerms("abbrev").includes("MO") && Array.from(doc.querySelectorAll("#abbrev-translations-tbody input")).some((i) => i.value === "MO"));
  nav("synonyme"); await wait(50);
  const emRow = newRows("syn").find((r) => /e-?mail/i.test(r.textContent));
  fire(emRow.querySelector("[data-lex-reject]"), "click"); await wait(30);
  s = await session();
  check("Verwerfen: E-Mail-Gruppe entfernt und gemerkt", !s.synonyms.some((e) => /^e-?mail$/i.test(e.term)) && s.lexAuto.ignored.syn.includes("email"));
  fire($("lex-auto-syn").querySelector("[data-lex-run]"), "click"); await wait(30);
  s = await session();
  check("Erneut prüfen: verworfene Gruppe kommt nicht wieder", !s.synonyms.some((e) => /^e-?mail$/i.test(e.term)));
  nav("glossar"); await wait(50);
  const nGloss = newRows("gloss").length;
  fire($("lex-auto-gloss").querySelector("[data-lex-accept-all]"), "click"); await wait(30);
  check("Glossar: „Alle übernehmen“", nGloss >= 2 && newRows("gloss").length === 0 && !!$("lex-auto-gloss").querySelector("[data-lex-none]"));
  await wait(500);
  check("Navigation: „+n“ beim Glossar verschwindet", lexBadge("glossar") === "");

  // Neue Inhalte -> neue Begriffe, bestehende Synonym-Gruppe bekommt neue Schreibweise
  s = await session();
  s.final.manuals[0].chapters.push(ch("3 Abrechnung", "Die Abrechnungsübersicht zeigt die Abrechnungsübersicht je Monat. Vertrags-Kündigung erfolgt schriftlich. Das Zahlungsziel (ZZ) gilt."));
  s.final.manuals[0].chapters.push(ch("4 Mahnung", "Die Abrechnungsübersicht nennt das Zahlungsziel. Die Vertragskündigung wird bestätigt."));
  s.final.manuals[0].chapters.push(ch("5 Export", "Export der Abrechnungsübersicht als Datei. Eine Vertragskündigung wird nicht exportiert."));
  await load(s); await wait(1600);
  s = await session();
  const kd = s.synonyms.find((e) => e.term === "Kündigung");
  check("Bestehende Synonym-Gruppe: neue Schreibweise ergänzt und als neu markiert", /Vertrags-Kündigung/.test(kd.synonyms) && kd.isNew === true && kd.lexAddedSynonyms.includes("Vertrags-Kündigung"));
  check("Neue Abkürzung ZZ = Zahlungsziel, neuer Glossar-Begriff Abrechnungsübersicht", s.abbrevTranslations.some((e) => e.term === "ZZ" && e.de === "Zahlungsziel" && e.isNew) && s.glossaryTranslations.some((e) => e.term === "Abrechnungsübersicht" && e.isNew));
  check("Bereits übernommene Einträge bleiben übernommen", !s.abbrevTranslations.find((e) => e.term === "MO").isNew);
  nav("synonyme"); await wait(50);
  fire(newRows("syn").find((r) => r.textContent.includes("Kündigung")).querySelector("[data-lex-reject]"), "click"); await wait(30);
  s = await session();
  check("Verwerfen bei bestehendem Eintrag: nur die ergänzte Schreibweise wird entfernt", s.synonyms.find((e) => e.term === "Kündigung").synonyms === "Vertragskündigung");
  // automatisch aus
  const cb = $("lex-auto-syn").querySelector("[data-lex-enabled]"); cb.checked = false; fire(cb, "change"); await wait(20);
  s = await session();
  s.final.manuals[0].chapters.push(ch("6 Neu", "Die Rechnungsprüfung prüft Rechnungen. Rechnungsprüfung und Rechnungsprüfung."), ch("7 Neu", "Erneut die Rechnungsprüfung."), ch("8 Neu", "Zuletzt die Rechnungsprüfung."));
  await load(s); await wait(1600);
  s = await session();
  check("Automatik aus: keine neuen Begriffe bei Inhaltsänderung", s.lexAuto.enabled === false && !s.glossaryTranslations.some((e) => e.term === "Rechnungsprüfung"));
  nav("glossar"); await wait(30);
  fire($("lex-auto-gloss").querySelector("[data-lex-run]"), "click"); await wait(30);
  s = await session();
  check("„Jetzt prüfen“ funktioniert auch bei ausgeschalteter Automatik", s.glossaryTranslations.some((e) => e.term === "Rechnungsprüfung" && e.isNew));
  // Löschen über die Tabelle merkt den automatisch erkannten Begriff als verworfen
  const delRow = Array.from(doc.querySelectorAll("#glossary-translations-tbody tr")).find((r) => r.querySelector("input") && r.querySelector("input").value === "Rechnungsprüfung");
  fire(delRow.querySelector('[data-action="delete"]'), "click"); await wait(20);
  fire($("lex-auto-gloss").querySelector("[data-lex-run]"), "click"); await wait(30);
  s = await session();
  check("In der Tabelle gelöschter automatischer Begriff kommt nicht wieder", !s.glossaryTranslations.some((e) => e.term === "Rechnungsprüfung"));

  // ===================== Regelwerk: bearbeiten =====================
  nav("regelwerk"); await wait(50);
  $("rules-kind-select").value = "forbid"; fire($("rules-kind-select"), "change");
  $("rules-value-input").value = "Testsystem"; fire($("rules-add-btn"), "click"); await wait(20);
  $("rules-kind-select").value = "ai"; fire($("rules-kind-select"), "change");
  $("rules-value-input").value = "Leser siezen."; fire($("rules-add-btn"), "click"); await wait(20);
  const editBtn = () => Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Testsystem")).querySelector("[data-rule-edit]");
  fire(editBtn(), "click"); await wait(20);
  check("Bearbeiten lädt die Regel ins Formular", $("rules-form-label").textContent === "1. Regel bearbeiten" && $("rules-add-btn").textContent === "Änderung speichern" && !$("rules-edit-cancel-btn").hidden &&
    $("rules-value-input").value === "Testsystem" && $("rules-kind-select").value === "forbid" && $("rules-scope-select").value === "" && !$("rules-replace-wrap").hidden);
  const opt = Array.from($("rules-scope-select").options).find((o) => o.value === "1 Vertrag");
  $("rules-scope-select").value = opt ? "1 Vertrag" : "__rules_custom__"; fire($("rules-scope-select"), "change");
  if (!opt) $("rules-scope-custom").value = "1 Vertrag";
  $("rules-value-input").value = "Testumgebung"; $("rules-replace-input").value = "Schulungsumgebung";
  fire($("rules-add-btn"), "click"); await wait(20);
  s = await session();
  const r1 = s.rules.items.find((r) => r.value === "Testumgebung");
  check("Regel geändert (Kapitel, Wert, Ersatz) statt neu angelegt", s.rules.items.length === 2 && !!r1 && r1.scope === "1 Vertrag" && r1.replace === "Schulungsumgebung" && r1.kind === "forbid" && !s.rules.items.some((r) => r.value === "Testsystem"));
  check("Formular wieder im Modus „hinzufügen“", $("rules-form-label").textContent === "1. Regel hinzufügen" && $("rules-add-btn").textContent === "Regel hinzufügen" && $("rules-edit-cancel-btn").hidden && /Regel geändert/.test($("rules-add-note").textContent));
  fire(Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("siezen")).querySelector("[data-rule-edit]"), "click"); await wait(20);
  $("rules-value-input").value = "Leser duzen."; fire($("rules-edit-cancel-btn"), "click"); await wait(20);
  s = await session();
  check("Abbrechen lässt die Regel unverändert", s.rules.items.some((r) => r.value === "Leser siezen.") && $("rules-value-input").value === "" && $("rules-add-btn").textContent === "Regel hinzufügen");
  fire(Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("siezen")).querySelector("[data-rule-edit]"), "click"); await wait(20);
  $("rules-kind-select").value = "maxWords"; fire($("rules-kind-select"), "change"); $("rules-value-input").value = "viele"; fire($("rules-add-btn"), "click"); await wait(20);
  check("Bearbeiten prüft die Eingabe wie beim Anlegen", /Zahl/.test($("rules-add-note").textContent) && $("rules-add-btn").textContent === "Änderung speichern");
  $("rules-value-input").value = "300"; fire($("rules-add-btn"), "click"); await wait(20);
  s = await session();
  check("Regelart geändert (KI-Regel → höchstens 300 Wörter)", s.rules.items.some((r) => r.kind === "maxWords" && r.value === "300") && s.rules.items.length === 2);
  fire(Array.from($("rules-tbody").querySelectorAll("tr")).find((r) => r.textContent.includes("Testumgebung")).querySelector("[data-rule-delete]"), "click"); await confirmModal();
  s = await session();
  check("Löschen weiterhin möglich", s.rules.items.length === 1);
  check("Regelwerk liegt im Bereich Operation (Validierung)", doc.querySelector('.nav-item[data-view="regelwerk"]').closest("li").getAttribute("data-nav-group") === "Operation");

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
