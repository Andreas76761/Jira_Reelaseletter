// Negativliste (Einstellungen): kommagetrennte Liste verbotener Woerter/
// Satzbausteine (auch Wortbestandteile) fuer Releaseletter/Benutzerhandbuch.
// Wird NICHT automatisch entfernt (redaktionelle Entscheidung bleibt beim
// Menschen), sondern in der Benutzerhandbuch-Kapitel-Vorschau ("Vorschau
// (Icons)"-Ansicht) gelb markiert. Konfiguration wie languageStyle/
// ragPrompts - bleibt bei "Alle Daten löschen" erhalten, Teil von Sitzung
// speichern/laden.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleImpl = async () => ({ text: "Platzhalter.", truncated: false, modelTierApplied: "default" });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = function () {};
    window.jspdf = { jsPDF: function () {} };
    window.claude = {
      use: function (name) {
        if (name === "sample") return Promise.resolve(function (input, opts) { return sampleImpl(input, opts); });
        if (name === "downloads") return Promise.resolve({ save: function (req) { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } });
        return Promise.resolve(null);
      },
    };
  },
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function confirmViaModal(doc) {
  await wait(30);
  fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(200);
}
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

const xml = `<?xml version="1.0"?><rss><channel>
  <item><key>NEGW-1</key><summary>Vertrag anlegen</summary><description>Diese Funktion ist einfach zu nutzen.</description><status>Offen</status><type>Task</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  // ===================== (1) Leerer Ausgangszustand =====================
  const input = doc.getElementById("negative-words-input");
  check("(1) Negativlisten-Textarea vorhanden", !!input);
  check("(1) Leer am Anfang", input.value === "");
  check("(1) Hinweistext zeigt 'leer' im Ausgangszustand", doc.getElementById("negative-words-count").textContent.includes("leer"));

  // ===================== (2) Eintragen aktualisiert den Zaehler live =====================
  input.value = "einfach, im Rahmen von, Testwort";
  fire(input, "input");
  await wait(30);
  check("(2) Zaehler zeigt 3 Begriffe", doc.getElementById("negative-words-count").textContent.includes("3 Begriff(e)"));
  fire(input, "change");
  await wait(30);
  check("(2) Protokoll vermerkt die Änderung", doc.getElementById("log-list").textContent.includes("Negativliste"));

  // ===================== (3) Import + Benutzerhandbuch-Kapitel generieren, dessen
  // Text einen Negativlisten-Treffer (ganzes Wort) UND einen Wortbestandteil-Treffer
  // ("Testwort" in "Dies ist ein Testwortbeispiel") enthaelt =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const fileInput = doc.getElementById("file-input");
  Object.defineProperty(fileInput, "files", { value: [new win.File([xml], "negwtest.xml", { type: "application/xml" })], configurable: true });
  fire(fileInput, "change");
  await wait(400);
  check("(3) 1 Ticket geladen", doc.getElementById("stat-tickets").textContent === "1");

  sampleImpl = async () => ({
    text: "## Retail\nDas ist einfach zu bedienen. Dies ist ein Testwortbeispiel im Alltag.",
    truncated: false, modelTierApplied: "default"
  });
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  const manualDomainSelect = doc.getElementById("manual-domain-select");
  Array.from(manualDomainSelect.options).forEach((o) => { o.selected = o.value === "Contract Management"; });
  fire(manualDomainSelect, "change");
  await wait(30);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await waitUntil(() => !doc.getElementById("manual-generate-btn").disabled, 3000);
  await wait(50);
  check("(3) Kapitel wurde erzeugt", doc.getElementById("manual-chapters-list").textContent.includes("Das ist einfach zu bedienen"));

  // ===================== (4) "Vorschau (Icons)"-Ansicht markiert Treffer gelb,
  // die rohe Deutsch-Textarea bleibt UNVERAENDERT (reine Anzeige-Markierung).
  // Nach jedem Klick, der renderManualChapters() ausloest, wird die Karte
  // NEU aus dem DOM geholt statt die alte (jetzt verwaiste) Referenz
  // weiterzuverwenden - innerHTML-Zuweisungen ersetzen die Kind-Elemente
  // komplett, eine alte Referenz zeigt sonst auf den Stand VOR dem Klick. =====================
  check("(4) Kapitel-Karte vorhanden", !!doc.querySelector("[data-manual-chapter]"));
  fire(doc.querySelector("[data-manual-chapter] [data-manual-lang=\"preview\"]"), "click");
  await wait(30);
  const previewHtml = doc.querySelector("[data-manual-chapter]").innerHTML;
  check("(4) 'einfach' ist als negword-hit markiert", /<mark class="negword-hit">einfach<\/mark>/.test(previewHtml));
  check("(4) 'Testwort' ist auch als TEIL von 'Testwortbeispiel' markiert (Wortbestandteil)",
    /<mark class="negword-hit">Testwort<\/mark>beispiel/.test(previewHtml));
  check("(4) Rollen-Icon für '## Retail' weiterhin vorhanden (Feature nicht beeinträchtigt)", previewHtml.includes("🚗"));

  fire(doc.querySelector("[data-manual-chapter] [data-manual-lang=\"de\"]"), "click");
  await wait(30);
  const rawTextarea = doc.querySelector("[data-manual-chapter] .manual-chapter-textarea");
  check("(4) Rohtext (Deutsch-Ansicht) enthält KEIN <mark>-Tag (nur Vorschau markiert, Originaltext unveraendert)",
    !rawTextarea.value.includes("<mark"));
  check("(4) Rohtext enthält weiterhin das Wort 'einfach' unveraendert", rawTextarea.value.includes("Das ist einfach zu bedienen"));

  // ===================== (4b) Negativliste auch in den einfachen Entwürfen
  // (Releaseletter/Benutzerhandbuch-Rohgerüst, NICHT der Kapitel-Generator von
  // oben) gelb markiert - urspruengliche Anfrage ("nicht im Releaseletter,
  // Handbuch erscheinen"), bisher nur im Kapitel-Generator umgesetzt. Negativliste
  // ist an dieser Stelle weiterhin "einfach, im Rahmen von, Testwort" (s. (2)). =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(50);
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  const rlPreviewHtml = doc.getElementById("releaseletter-preview").innerHTML;
  check("(4b) Releaseletter-Vorschau markiert 'einfach' gelb", /<mark class="negword-hit">einfach<\/mark>/.test(rlPreviewHtml));
  check("(4b) Releaseletter-Vorschau zeigt weiterhin den vollen Text (textContent unveraendert)",
    doc.getElementById("releaseletter-preview").textContent.includes("Diese Funktion ist einfach zu nutzen."));
  check("(4b) 'Zur Negativliste (Einstellungen)'-Link im Releaseletter vorhanden", !!doc.getElementById("releaseletter-goto-negative-words-btn"));
  fire(doc.getElementById("releaseletter-goto-negative-words-btn"), "click");
  await wait(30);
  check("(4b) Link springt in die Einstellungen", !doc.querySelector('.view-panel[data-view-panel="einstellungen"]').hidden);
  check("(4b) Negativliste-Textarea danach fokussiert", doc.activeElement === doc.getElementById("negative-words-input"));

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  fire(doc.getElementById("benutzerhandbuch-generate-btn"), "click");
  await wait(50);
  const bhPreviewHtml = doc.getElementById("benutzerhandbuch-preview").innerHTML;
  check("(4b) Benutzerhandbuch-Entwurf-Vorschau markiert 'einfach' gelb", /<mark class="negword-hit">einfach<\/mark>/.test(bhPreviewHtml));
  check("(4b) 'Zur Negativliste (Einstellungen)'-Link im Benutzerhandbuch-Entwurf vorhanden", !!doc.getElementById("benutzerhandbuch-goto-negative-words-btn"));

  // Live-Aktualisierung: Negativliste waehrend bereits sichtbarer Vorschau
  // aendern - beide Vorschauen (Releaseletter + Benutzerhandbuch-Entwurf)
  // muessen sich ohne erneutes "Entwurf generieren" sofort nachziehen.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const liveInput = doc.getElementById("negative-words-input");
  liveInput.value = "Testwort";
  fire(liveInput, "input");
  await wait(30);
  check("(4b) Nach Entfernen von 'einfach' aus der Negativliste: Releaseletter-Vorschau live aktualisiert (keine Markierung mehr)",
    !doc.getElementById("releaseletter-preview").innerHTML.includes("negword-hit"));
  check("(4b) ... ebenso die Benutzerhandbuch-Entwurf-Vorschau",
    !doc.getElementById("benutzerhandbuch-preview").innerHTML.includes("negword-hit"));
  // Fuer die Clickanweisung (bewusst NICHT Teil der Negativliste-Markierung,
  // s. Kommentar bei negativeWordsPreviewRefreshers) bleibt die Vorschau
  // reiner Text - keine <mark>-Tags, auch wenn ein Treffer vorkaeme.
  check("(4b) Clickanweisung-Vorschau bleibt bewusst unangetastet (kein data-attribute fuer Negativliste-Link)",
    !doc.getElementById("clickanweisung-goto-negative-words-btn"));

  // Negativliste fuer die folgenden Checks wieder auf den Ausgangsstand von (2).
  liveInput.value = "einfach, im Rahmen von, Testwort";
  fire(liveInput, "input");
  await wait(30);

  // ===================== (5) Leere Negativliste: keine Markierung =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const input2 = doc.getElementById("negative-words-input");
  input2.value = "";
  fire(input2, "input");
  await wait(30);
  check("(5) Zaehler wieder 'leer'", doc.getElementById("negative-words-count").textContent.includes("leer"));
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  fire(doc.querySelector("[data-manual-chapter] [data-manual-lang=\"preview\"]"), "click");
  await wait(30);
  check("(5) Ohne Negativliste: keine negword-hit-Markierung mehr",
    !doc.querySelector("[data-manual-chapter]").innerHTML.includes("negword-hit"));

  // Fuer die folgenden Checks Negativliste wieder setzen.
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  const input3 = doc.getElementById("negative-words-input");
  input3.value = "einfach, Testwort";
  fire(input3, "input");
  await wait(30);

  // ===================== (6) Sitzung speichern/laden sichert die Negativliste =====================
  fire(doc.getElementById("session-export-btn"), "click");
  await wait(200);
  const exportedJson = JSON.parse(savedFiles[savedFiles.length - 1].data);
  check("(6) Export enthält negativeWordsRaw", exportedJson.negativeWordsRaw === "einfach, Testwort");

  // ===================== (7) "Alle Daten löschen": Negativliste bleibt erhalten (Konfiguration) =====================
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);
  check("(7) Negativliste bleibt nach 'Alle Daten löschen' erhalten (Konfiguration, kein Sitzungsdatensatz)",
    doc.getElementById("negative-words-input").value === "einfach, Testwort");

  // ===================== (8) Sitzung laden stellt die Negativliste wieder her (nach manuellem Leeren) =====================
  const input4 = doc.getElementById("negative-words-input");
  input4.value = "";
  fire(input4, "input");
  await wait(30);
  const sessionFile = new win.File([JSON.stringify(exportedJson)], "session.json", { type: "application/json" });
  const sessionInput = doc.getElementById("session-import-input");
  Object.defineProperty(sessionInput, "files", { value: [sessionFile], configurable: true });
  fire(sessionInput, "change");
  await wait(300);
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  check("(8) Negativliste nach Laden wiederhergestellt", doc.getElementById("negative-words-input").value === "einfach, Testwort");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE NEGATIVLISTEN-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
