// Gliederung (neue Navigation, oberhalb Verarbeitung): Stichwort-Register
// je Unterkapitel + optionalem Label-Themengebiet, deterministisch aus den
// zugeordneten Jira-Tickets extrahiert (kein KI-Aufruf) mit Auffüllung aus
// der Label-Begriffsliste bis mindestens 80 Stichwörter. CRUD (anlegen/
// umformulieren/löschen), aufklappbare Box (Text+Quelle+Ticket-Liste),
// Chat/"Grill me" (KI, ephemer) und erweiterte Suche mit Trefferanzahl +
// benachbarten Themenfeldern.
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
  return { text: "## Offene Themen\nKeine Auffälligkeiten.\n\n## Widersprüche\nKeine Auffälligkeiten.\n\n## Verbesserungen\nMehr Beispiele ergänzen.", truncated: false, modelTierApplied: "default" };
};
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function () { return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function setValue(el, v) { el.value = v; fire(el, "input"); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Eigene, kleine Ticketmenge - vorher Demo-Daten leeren (sonst
  // Kontamination der Auswahl/Zählung durch die 663 Beispiel-Tickets).
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>GL-1</key><summary>Servicevertrag über API an oneERP anbinden</summary>
      <description>Die Blueprint-Vorlage für Indien nutzt eine eigene Preismatrix, angebunden über die oneERP-API.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
    <item><key>GL-2</key><summary>Preismatrix für Indien validieren</summary>
      <description>Die Preismatrix aus dem Blueprint muss für den Markt Indien geprüft werden.</description>
      <status>Offen</status><type>Bug</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new dom.window.File([xml], "gliederung_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Navigation: neuer Punkt "Gliederung" oberhalb Verarbeitung =====================
  const navItems = Array.from(doc.querySelectorAll(".nav-item"));
  const glIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "gliederung");
  const verarbeitungIdx = navItems.findIndex((b) => b.getAttribute("data-view") === "verarbeitung");
  check("Nav-Punkt 'Gliederung' vorhanden", glIdx !== -1);
  check("'Gliederung' steht VOR 'Verarbeitung' in der Navigation", glIdx !== -1 && verarbeitungIdx !== -1 && glIdx < verarbeitungIdx);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  check("Gliederung-Ansicht sichtbar", !doc.querySelector('[data-view-panel="gliederung"]').hidden);

  // ===================== Filter-Selects befüllt aus Einstellungen (Gliederung/Labels) =====================
  const subSelect = doc.getElementById("gl-subchapter-select");
  const labelSelect = doc.getElementById("gl-label-select");
  check("Unterkapitel-Select hat Optionen (aus Benutzerhandbuch-Gliederung)", subSelect.options.length > 10);
  check("Ein Unterkapitel von Kapitel 4 vorhanden (z. B. '4.1 Vertragsarten')", Array.from(subSelect.options).some((o) => o.value.indexOf("4.1 Vertragsarten") !== -1));
  check("Label-Select hat 'Alle Themengebiete' + echte Kategorien", labelSelect.options.length > 5 && labelSelect.options[0].value === "alle");

  // ===================== Stichwörter erzeugen: mindestens 80, aus Tickets + aufgefüllt =====================
  const targetOpt = Array.from(subSelect.options).find((o) => o.value.indexOf("4.1 Vertragsarten") !== -1);
  subSelect.value = targetOpt.value;
  fire(doc.getElementById("gl-generate-btn"), "click");
  await wait(50);
  const list1 = doc.getElementById("gl-keywords-list");
  check("Mindestens 80 Stichwörter erzeugt", list1.querySelectorAll(".gl-term-input").length >= 80);
  const termValues = Array.from(list1.querySelectorAll(".gl-term-input")).map((i) => i.value);
  check("Aus Ticket-Text extrahiertes Stichwort 'API' vorhanden", termValues.indexOf("API") !== -1);
  check("Aus Ticket-Text extrahiertes Stichwort 'Blueprint' vorhanden", termValues.some((t) => t.toLowerCase() === "blueprint"));
  check("Aus Ticket-Text extrahiertes Stichwort 'Preismatrix' vorhanden (Mehrfachnennung dedupliziert)", termValues.filter((t) => t.toLowerCase() === "preismatrix").length === 1);
  check("Status-Hinweis zeigt Ticketanzahl", doc.getElementById("gl-status-note").textContent.indexOf("Tickets") !== -1);

  // Innerhalb von #gl-keywords-list loest jeder Klick (Toggle/Löschen) ein
  // komplettes Neu-Rendern (innerHTML-Ersetzung) aus - der Container selbst
  // bleibt derselbe DOM-Knoten, seine Kinder aber nicht: nach jeder
  // render-ausloesenden Aktion daher IMMER frisch aus dem Container
  // nachfragen statt zuvor erfasste Kind-Referenzen weiterzuverwenden
  // (sonst "stale DOM reference", Ereignisse verpuffen ins Leere).
  function glCardByTerm(term) {
    const inputEl = Array.from(doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input")).find((i) => i.value === term);
    return inputEl ? inputEl.closest(".manual-chapter-card") : null;
  }

  // ===================== Stichwort aufklappen: Text + Quelle + Ticket-Liste =====================
  fire(doc.getElementById("gl-keywords-list").querySelector("[data-gl-toggle]"), "click");
  await wait(30);
  const expandedCard = doc.getElementById("gl-keywords-list").querySelector('[data-gl-toggle][aria-expanded="true"]').closest(".manual-chapter-card");
  check("Aufgeklappte Box zeigt einen Text", expandedCard.textContent.length > 50);
  check("Aufgeklappte Box zeigt eine Datenquelle", expandedCard.textContent.indexOf("Quelle:") !== -1);
  fire(expandedCard.querySelector("[data-gl-toggle]"), "click"); // wieder einklappen
  await wait(30);

  // ===================== Stichwort mit echten Ticket-Treffern hat Ticket-Buttons =====================
  fire(glCardByTerm("API").querySelector("[data-gl-toggle]"), "click");
  await wait(30);
  const apiCard = glCardByTerm("API");
  check("Stichwort 'API' hat mindestens 1 zugeordnetes Ticket (GL-1)", apiCard.querySelector('[data-gl-open-ticket="GL-1"]') !== null);
  fire(apiCard.querySelector('[data-gl-open-ticket="GL-1"]'), "click");
  await wait(50);
  check("Klick auf Ticket-Button öffnet das Ticket-Modal", !doc.getElementById("modal-overlay").hidden && doc.getElementById("modal-key").textContent === "GL-1");
  fire(doc.getElementById("modal-close"), "click");
  await wait(30);

  // ===================== CRUD: umbenennen, löschen, manuell hinzufügen =====================
  const apiInputEl = glCardByTerm("API").querySelector(".gl-term-input");
  setValue(apiInputEl, "API-Schnittstelle");
  fire(apiInputEl, "change");
  await wait(30);
  check("Umbenennen persistiert im State (kein Reset bei Re-Render)", (function () {
    fire(doc.getElementById("gl-label-select"), "change"); // Re-Render auslösen ohne neue Generierung
    const again = Array.from(doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input")).map((i) => i.value);
    return again.indexOf("API-Schnittstelle") !== -1 && again.indexOf("API") === -1;
  })());

  const beforeDeleteCount = doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input").length;
  fire(doc.getElementById("gl-keywords-list").querySelector("[data-gl-delete]"), "click");
  await wait(30);
  check("Löschen entfernt genau 1 Stichwort", doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input").length === beforeDeleteCount - 1);

  setValue(doc.getElementById("gl-new-term-input"), "Sonderregel Indien");
  fire(doc.getElementById("gl-add-term-btn"), "click");
  await wait(30);
  check("Manuell hinzugefügtes Stichwort erscheint in der Liste", Array.from(doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input")).some((i) => i.value === "Sonderregel Indien"));

  // ===================== Label-Filter grenzt die Ticket-Basis ein =====================
  const categories = Array.from(labelSelect.options).map((o) => o.value);
  const fahrzeugCat = categories.find((c) => c === "Fahrzeuge & Fahrzeugdaten");
  if (fahrzeugCat) {
    labelSelect.value = fahrzeugCat;
    fire(doc.getElementById("gl-generate-btn"), "click");
    await wait(50);
    check("Mit Label-Filter (kein Treffer in Tickets): weiterhin mindestens 80 Stichwörter (aus Begriffsliste aufgefüllt)",
      doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input").length >= 80);
  }
  labelSelect.value = "alle";
  fire(doc.getElementById("gl-generate-btn"), "click");
  await wait(50);

  // ===================== Datenquelle: im Dashboard ausgewählte Tickets =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(50);
  Array.from(doc.querySelectorAll("#table-body input.row-select-checkbox")).forEach((cb) => {
    if (cb.getAttribute("data-key") === "GL-1" || cb.getAttribute("data-key") === "GL-2") {
      cb.checked = true;
      fire(cb, "click");
    }
  });
  await wait(30);

  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  const useSelectionCb = doc.getElementById("gl-use-selection-cb");
  useSelectionCb.checked = true;
  fire(useSelectionCb, "change");
  await wait(30);
  check("Checkbox 'Ausgewählte Tickets verwenden' aktiviert", useSelectionCb.checked);
  check("Live-Zähler zeigt 2 ausgewählte Tickets", doc.getElementById("gl-selection-count").textContent.indexOf("2 Tickets") !== -1);
  check("Unterkapitel-/Label-Selects deaktiviert, solange Dashboard-Auswahl aktiv ist", doc.getElementById("gl-subchapter-select").disabled && doc.getElementById("gl-label-select").disabled);

  fire(doc.getElementById("gl-generate-btn"), "click");
  await wait(50);
  const selectionList = doc.getElementById("gl-keywords-list");
  check("Stichwörter aus Dashboard-Auswahl erzeugt (mindestens 80)", selectionList.querySelectorAll(".gl-term-input").length >= 80);
  check("Status-Hinweis nennt die Dashboard-Auswahl als Quelle", doc.getElementById("gl-status-note").textContent.indexOf("Dashboard-Auswahl") !== -1);
  const selectionTerms = Array.from(selectionList.querySelectorAll(".gl-term-input")).map((i) => i.value);
  check("Enthält aus GL-1/GL-2 extrahiertes Stichwort 'Preismatrix' (nur die 2 ausgewählten Tickets, nicht die ganze Kapitel-Basis)", selectionTerms.some((t) => t.toLowerCase() === "preismatrix"));

  fire(doc.getElementById("gl-keywords-list").querySelector("[data-gl-toggle]"), "click");
  await wait(30);
  const expandedSelectionCard = doc.getElementById("gl-keywords-list").querySelector('[data-gl-toggle][aria-expanded="true"]').closest(".manual-chapter-card");
  check("Aufgeklappte Box im Auswahl-Modus verweist auf die Dashboard-Auswahl als Datenquelle (kein Unterkapitel-Bezug)", expandedSelectionCard.textContent.indexOf("Dashboard-Auswahl") !== -1);

  useSelectionCb.checked = false;
  fire(useSelectionCb, "change");
  await wait(30);
  check("Deaktivieren der Checkbox gibt Unterkapitel-/Label-Selects wieder frei", !doc.getElementById("gl-subchapter-select").disabled && !doc.getElementById("gl-label-select").disabled);
  check("Nach Deaktivieren: wieder die Unterkapitel-basierte Stichwortliste sichtbar (eigener Sitzungseintrag je Datenquelle, unabhängig von der Dashboard-Auswahl-Liste)",
    Array.from(doc.getElementById("gl-keywords-list").querySelectorAll(".gl-term-input")).some((i) => i.value === "API"));

  // ===================== Chat (KI, mehrstufig) =====================
  fire(doc.getElementById("gl-chat-btn"), "click");
  await wait(30);
  check("Chat-Panel öffnet sich", !doc.getElementById("gl-chat-panel").hidden);
  setValue(doc.getElementById("gl-chat-input"), "Welche Länder sind betroffen?");
  sampleCalls = [];
  fire(doc.getElementById("gl-chat-send-btn"), "click");
  await wait(150);
  check("sample() für Chat aufgerufen", sampleCalls.length === 1);
  check("Chat-Kontext enthält Unterkapitel-Bezug", JSON.stringify(sampleCalls[0].input).indexOf("Vertragsarten") !== -1);
  check("Chat-Verlauf zeigt Nutzerfrage und Antwort", doc.getElementById("gl-chat-history").textContent.indexOf("Welche Länder") !== -1 && doc.getElementById("gl-chat-history").children.length >= 2);

  // ===================== Grill me (KI, einmalig) =====================
  sampleCalls = [];
  fire(doc.getElementById("gl-grill-btn"), "click");
  await wait(150);
  check("Grill-me-Panel öffnet sich", !doc.getElementById("gl-grill-panel").hidden);
  check("sample() für Grill me aufgerufen", sampleCalls.length === 1);
  check("Grill-me-Prompt fragt nach offenen Themen/Widersprüchen/Verbesserungen", sampleCalls[0].input.indexOf("Offene Themen") !== -1 && sampleCalls[0].input.indexOf("Widersprüche") !== -1 && sampleCalls[0].input.indexOf("Verbesserungen") !== -1);
  check("Grill-me-Ausgabe zeigt die 3 Abschnitte", doc.getElementById("gl-grill-output").textContent.indexOf("Verbesserungen") !== -1);

  // ===================== Erweiterte Suche: Trefferanzahl + benachbarte Themenfelder =====================
  setValue(doc.getElementById("gl-search-input"), "Preismatrix");
  await wait(300);
  check("Suchzusammenfassung zeigt Trefferanzahl", /\d+ Treffer/.test(doc.getElementById("gl-search-summary").textContent));
  check("Suche findet mindestens 1 Treffer (GL-1/GL-2 enthalten 'Preismatrix')", doc.getElementById("gl-search-summary").textContent.indexOf("0 Treffer") === -1);
  check("Benachbarte Themenfelder werden angezeigt (z. B. 'API', da gleiche Tickets)", doc.getElementById("gl-search-neighbors").textContent.indexOf("API") !== -1);

  // ===================== XSS-Schutz: Stichwort mit HTML-Sonderzeichen =====================
  setValue(doc.getElementById("gl-new-term-input"), '</div><img src=x onerror="window.__xss_gl=true">');
  fire(doc.getElementById("gl-add-term-btn"), "click");
  await wait(30);
  check("Kein echtes <img>-Element im DOM nach XSS-Versuch", !doc.getElementById("gl-keywords-list").querySelector("img"));
  check("Kein window.__xss_gl gesetzt (kein Script ausgeführt)", dom.window.__xss_gl === undefined);

  // ===================== Sitzung: Stichwörter sind Sitzungsdatensatz =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  doc.querySelector('.nav-item[data-view="gliederung"]').click();
  await wait(50);
  subSelect.value = targetOpt.value;
  fire(subSelect, "change");
  check("Nach 'Alle Daten löschen': keine Stichwörter mehr für diese Auswahl (Sitzungsdatensatz zurückgesetzt)",
    !doc.getElementById("gl-keywords-empty").hidden);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE GLIEDERUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
