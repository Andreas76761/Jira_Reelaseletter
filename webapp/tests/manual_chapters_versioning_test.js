// Benutzerhandbuch-Kapitel-Generator: Erweiterungen auf "Kapitel erstellen".
// (1) Gruppierung "nach Label-Themengebiet" statt nur "nach Kapitel".
// (2) Versionierung: erneutes Erzeugen überschreibt eine vorhandene Fassung
//     nicht, sondern legt sie als benannte, datierte Version ab (Vergleich/
//     Wiederherstellen möglich).
// (3) Zwischenstand im Protokoll nach je 20 fertiggestellten Kapiteln/Labels
//     eines Laufs.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCallCount = 0;
let sampleImpl = async () => {
  sampleCallCount++;
  return { text: "Generierter Text Nr. " + sampleCallCount + ".", truncated: false, modelTierApplied: "default" };
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
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  fire(doc.getElementById("delete-all-data-btn"), "click");
  await confirmViaModal(doc);

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>MV-1</key><summary>Servicevertrag anlegen</summary>
      <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "manual_versioning_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(150);

  // ===================== Gruppierung: Umschalter vorhanden, Standard "Kapitel" =====================
  const groupSelect = doc.getElementById("manual-group-select");
  check("Gruppierungs-Select vorhanden", !!groupSelect);
  check("Standardwert 'chapter'", groupSelect.value === "chapter");

  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach((o) => { if (o.value === "Contract Management") o.selected = true; });
  fire(domainSelect, "change");
  await wait(30);

  groupSelect.value = "label";
  fire(groupSelect, "change");
  sampleCallCount = 0;
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(150);
  const listAfterLabelGen = doc.getElementById("manual-chapters-list");
  check("Im Label-Modus mindestens 1 Kapitel-Karte erzeugt (je Label-Themengebiet der matchenden Tickets)", listAfterLabelGen.querySelectorAll(".manual-chapter-card").length > 0);
  check("Karten-Titel zeigt '(Label-Themengebiet)' statt eines Kapiteltitels", listAfterLabelGen.textContent.includes("(Label-Themengebiet)"));

  // ===================== Versionierung: erneutes Erzeugen legt eine Version an =====================
  groupSelect.value = "chapter";
  fire(groupSelect, "change");
  const chapterSelect = doc.getElementById("manual-chapter-select");
  await wait(30);
  const targetChapterOpt = Array.from(chapterSelect.options).find((o) => o.value.includes("Kapitel 7"));
  targetChapterOpt.selected = true;
  fire(chapterSelect, "change");
  await wait(30);

  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(150);
  function chapterCard(doc, titleFragment) {
    return Array.from(doc.getElementById("manual-chapters-list").querySelectorAll("[data-manual-chapter]")).find((c) => c.getAttribute("data-manual-chapter").includes(titleFragment));
  }
  const firstGenCard = chapterCard(doc, "Kapitel 7");
  check("Erste Generierung für Kapitel 7 vorhanden, keine Versionen-Liste (erste Fassung)", !!firstGenCard && !firstGenCard.textContent.includes("Versionen ("));
  // Text dynamisch erfassen statt eine feste "Nr. X" zu erwarten - der
  // Aufrufzaehler des sample()-Stubs laeuft bereits durch die vorherigen
  // Label-Modus-Generierungen weiter (mehrere Label-Themengebiete = mehrere
  // Aufrufe), die exakte Nummer ist hier daher kein verlaesslicher Wert.
  const firstGenText = firstGenCard.querySelector(".manual-chapter-textarea[data-lang='de']").value;

  fire(doc.getElementById("manual-generate-btn"), "click"); // erneut fuer dasselbe Kapitel
  await wait(150);
  const secondGenCard = chapterCard(doc, "Kapitel 7");
  check("Nach erneutem Erzeugen: Versionen-Button mit '(1)' vorhanden (alte Fassung gesichert statt überschrieben)", secondGenCard.textContent.includes("Versionen (1)"));
  const secondGenText = secondGenCard.querySelector(".manual-chapter-textarea[data-lang='de']").value;
  check("Zweite Generierung liefert einen ANDEREN Text als die erste (Stub liefert je Aufruf einen neuen Text)", secondGenText !== firstGenText);

  fire(secondGenCard.querySelector("[data-manual-history-toggle]"), "click");
  await wait(30);
  const expandedCard = chapterCard(doc, "Kapitel 7");
  check("Versionsliste zeigt Datum + Wortzahl", /·.+Wörter.+·.+Tickets/.test(expandedCard.textContent));
  check("Versionsliste zeigt einen Standard-Versionsnamen ('Version vom ...')", expandedCard.querySelector("[data-manual-history-name]").value.startsWith("Version vom"));

  fire(expandedCard.querySelector("[data-manual-history-view]"), "click");
  await wait(30);
  const withTextShown = chapterCard(doc, "Kapitel 7");
  const historyTextarea = withTextShown.querySelector('textarea[readonly]');
  check("'Text anzeigen' zeigt den TEXT DER ERSTEN Generierung (Version 1) readonly an", !!historyTextarea && historyTextarea.value === firstGenText);

  const renameInput = withTextShown.querySelector("[data-manual-history-name]");
  setValue(renameInput, "Erster Entwurf");
  fire(renameInput, "change");
  await wait(30);
  check("Version umbenennbar", chapterCard(doc, "Kapitel 7").querySelector("[data-manual-history-name]").value === "Erster Entwurf");

  fire(chapterCard(doc, "Kapitel 7").querySelector("[data-manual-history-restore]"), "click");
  await wait(30);
  const afterRestoreCard = chapterCard(doc, "Kapitel 7");
  const afterRestoreText = afterRestoreCard.querySelector(".manual-chapter-textarea[data-lang='de']").value;
  check("'Wiederherstellen' setzt den Text der alten (ersten) Version als aktuellen Text", afterRestoreText === firstGenText);
  check("Der vorherige aktuelle Text (zweite Generierung) landet dabei selbst in der Versionsliste (kein Datenverlust)", afterRestoreCard.textContent.includes("Versionen (1)"));

  // ===================== Zwischenstand im Protokoll nach 20 fertiggestellten Kapiteln =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(50);
  function outlineChapterIdByTitle(title) {
    const rows = Array.from(doc.querySelectorAll(".outline-chapter-row"));
    const row = rows.find((r) => r.textContent.includes(title));
    const delBtn = row ? row.querySelector('[data-action="delete-chapter"]') : null;
    return delBtn ? delBtn.getAttribute("data-chapter-id") : null;
  }
  for (let i = 1; i <= 20; i++) {
    const title = "ZZZ-Test-Kapitel " + i;
    setValue(doc.getElementById("outline-new-chapter-input"), title);
    fire(doc.getElementById("outline-add-chapter-btn"), "click");
    await wait(10);
    const chapterId = outlineChapterIdByTitle(title);
    const domainInput = doc.querySelector('.outline-new-domain-input[data-chapter-id="' + chapterId + '"]');
    setValue(domainInput, "ZZZ-Checkpoint-Domain");
    fire(doc.querySelector('[data-action="add-domain"][data-chapter-id="' + chapterId + '"]'), "click");
    await wait(10);
  }
  check("20 Test-Kapitel für den Zwischenstand-Test angelegt", doc.querySelectorAll(".outline-chapter-row").length >= 20);

  const xmlCheckpoint = `<?xml version="1.0"?><rss><channel>
    <item><key>MV-2</key><summary>Checkpoint-Ticket</summary>
      <description>Dient nur dem Zwischenstand-Test.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>ZZZ-Checkpoint-Domain</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input2 = doc.getElementById("file-input");
  Object.defineProperty(input2, "files", { value: [new win.File([xmlCheckpoint], "manual_checkpoint_test.xml", { type: "application/xml" })], configurable: true });
  fire(input2, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  const domainSelect2 = doc.getElementById("manual-domain-select");
  Array.from(domainSelect2.options).forEach((o) => { o.selected = o.value === "ZZZ-Checkpoint-Domain"; });
  fire(domainSelect2, "change");
  const chapterSelect2 = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect2.options).forEach((o) => { o.selected = false; });
  fire(chapterSelect2, "change");
  await wait(30);
  check("Match-Anzahl-Basis: Domäne 'ZZZ-Checkpoint-Domain' auswählbar", Array.from(domainSelect2.options).some((o) => o.value === "ZZZ-Checkpoint-Domain" && o.selected));

  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(1500);
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  await wait(50);
  const protokollText = (doc.getElementById("log-list") || doc.body).textContent;
  check("Protokoll enthält einen Zwischenstand-Eintrag nach 20 fertiggestellten Kapiteln", protokollText.includes("Zwischenstand nach 20 Kapiteln"));
  check("Zwischenstand nennt erstes und letztes Kapitel des 20er-Blocks", protokollText.includes("ZZZ-Test-Kapitel 1") && protokollText.includes("ZZZ-Test-Kapitel 20"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE KAPITEL-GENERATOR-VERSIONIERUNG-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
