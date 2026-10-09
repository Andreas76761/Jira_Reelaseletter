// Kapitel-Generator: Zielordner-Export (File System Access API) + "Alle
// Kapitel zusammenführen". Deckt ab: Zielordner-Button ist ohne
// window.showDirectoryPicker deaktiviert; nach Ordnerauswahl wird JEDES
// fertige Kapitel sofort als eigene .md-Datei im (gemockten) Ordner
// abgelegt; "Alle Kapitel zusammenführen" baut ein Gesamtdokument in
// Gliederungsreihenfolge und legt es bei gewähltem Ordner zusätzlich als
// "Gesamtdokument.md" dort ab; ohne Ordnerwahl bleibt das bisherige
// Verhalten (nur Browser-Zustand) unverändert.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

// In-memory gemockter Ordner: Dateiname -> zuletzt geschriebener Inhalt.
const writtenFiles = {};
function makeFakeDirHandle(name) {
  return {
    name: name,
    getFileHandle: async function (filename) {
      return {
        createWritable: async function () {
          return {
            write: async function (data) { writtenFiles[filename] = data; },
            close: async function () {},
          };
        },
      };
    },
  };
}

let sampleImpl = async (input) => {
  if (input.indexOf("Servicevertrag anlegen") !== -1) return { text: "Kapitel-4-Inhalt.", truncated: false, modelTierApplied: "default" };
  if (input.indexOf("Zahlung, Rechnung") !== -1) return { text: "Kapitel-5-Inhalt.", truncated: false, modelTierApplied: "default" };
  return { text: "Generischer-Inhalt.", truncated: false, modelTierApplied: "default" };
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

const xmlFixture = `<?xml version="1.0"?><rss><channel>
  <item><key>MCE-1</key><summary>Servicevertrag anlegen Fall A</summary><description>Beschreibung MCE-1.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Contract Generation</customfieldvalue></customfieldvalues></customfield></customfields></item>
  <item><key>MCE-2</key><summary>Zahlung Rechnung Fall B</summary><description>Beschreibung MCE-2.</description><status>Offen</status><type>Bug</type>
    <customfields><customfield><customfieldname>Domain</customfieldname><customfieldvalues><customfieldvalue>Revenue Management</customfieldvalue></customfieldvalues></customfield></customfields></item>
</channel></rss>`;

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== (0) Reset + Import =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const delBtn = doc.getElementById("delete-all-data-btn");
  if (delBtn) {
    fire(delBtn, "click");
    await wait(30);
    const okBtn = doc.getElementById("confirm-modal-ok-btn");
    if (okBtn) { fire(okBtn, "click"); await wait(200); }
  }

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xmlFixture], "mce.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);
  check("(0) 2 Tickets geladen", doc.getElementById("stat-tickets").textContent === "2");

  // ===================== (1) Zielordner-Button ohne showDirectoryPicker deaktiviert =====================
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(100);
  check("(1) Kein window.showDirectoryPicker in jsdom -> Button deaktiviert", doc.getElementById("manual-choose-dir-btn").disabled === true);
  check("(1) Standardtext ohne Zielordner sichtbar", doc.getElementById("manual-dir-status-note").textContent.indexOf("Kein Zielordner gewählt") !== -1);

  // ===================== (2) Zielordner per Mock "wählen" (simuliert window.showDirectoryPicker) =====================
  win.showDirectoryPicker = async function () { return makeFakeDirHandle("Handbuch-Export"); };
  // Button war beim Laden deaktiviert (kein API vorhanden) - für den Test den Klick-Handler direkt
  // auslösen, statt das Element neu zu rendern (entspricht: Browser mit echter API hätte den Button
  // von Anfang an aktiv).
  doc.getElementById("manual-choose-dir-btn").disabled = false;
  fire(doc.getElementById("manual-choose-dir-btn"), "click");
  await wait(80);
  check("(2) Zielordner-Status zeigt gewählten Ordnernamen", doc.getElementById("manual-dir-status-note").textContent.indexOf("Handbuch-Export") !== -1);

  // ===================== (3) Beide Kapitel erzeugen -> je eine .md-Datei automatisch abgelegt =====================
  const chapterSelect = doc.getElementById("manual-chapter-select");
  Array.from(chapterSelect.options).forEach((o) => {
    o.selected = o.value === "Kapitel 4: Servicevertrag anlegen" || o.value === "Kapitel 5: Zahlung, Rechnung und Unterschrift";
  });
  fire(chapterSelect, "change");
  await wait(50);
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(400);

  // startsWith statt exakter Gleichheit: manualGenerateChapters() haengt an
  // jeden Kapiteltext eine "Quellen"-Fussnote an (ticketSourcesFooter()).
  check("(3) Kapitel 4 als eigene Datei im gewählten Ordner abgelegt", (writtenFiles["Kapitel_4_Servicevertrag_anlegen.md"] || "").indexOf("Kapitel-4-Inhalt.") === 0);
  check("(3) Kapitel 5 als eigene Datei im gewählten Ordner abgelegt", (writtenFiles["Kapitel_5_Zahlung_Rechnung_und_Unterschrift.md"] || "").indexOf("Kapitel-5-Inhalt.") === 0);
  check("(3) Statuszeile nennt Anzahl automatisch gespeicherter Kapitel", doc.getElementById("manual-status-note").textContent.indexOf("2 Kapitel automatisch im gewählten Ordner gespeichert") !== -1);

  // ===================== (4) "Alle Kapitel zusammenführen" -> Gesamtdokument in Gliederungsreihenfolge =====================
  fire(doc.getElementById("manual-merge-btn"), "click");
  await wait(100);
  const mergedText = doc.getElementById("manual-merge-output").value;
  check("(4) Gesamtdokument enthält beide Kapitelüberschriften", mergedText.indexOf("## Kapitel 4: Servicevertrag anlegen") !== -1 && mergedText.indexOf("## Kapitel 5: Zahlung, Rechnung und Unterschrift") !== -1);
  check("(4) Kapitel 4 steht vor Kapitel 5 (Gliederungsreihenfolge)", mergedText.indexOf("Kapitel 4:") < mergedText.indexOf("Kapitel 5:"));
  check("(4) Download-Button aktiviert", doc.getElementById("manual-merge-download-btn").disabled === false);
  check("(4) Gesamtdokument zusätzlich im gewählten Ordner gespeichert", writtenFiles["Gesamtdokument.md"] === mergedText);
  check("(4) Statuszeile bestätigt Ordner-Speicherung", doc.getElementById("manual-merge-status-note").textContent.indexOf("Gesamtdokument.md") !== -1);

  // ===================== (5) "Sitzung zurücksetzen" leert Zielordner-Status und Gesamtdokument =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const resetBtn = doc.getElementById("reset-session-btn") || doc.getElementById("delete-all-data-btn");
  fire(resetBtn, "click");
  await wait(30);
  const okBtn2 = doc.getElementById("confirm-modal-ok-btn");
  if (okBtn2) { fire(okBtn2, "click"); await wait(200); }
  check("(5) Zielordner-Status nach Reset wieder auf Standardtext", doc.getElementById("manual-dir-status-note").textContent.indexOf("Kein Zielordner gewählt") !== -1);
  check("(5) Gesamtdokument-Feld nach Reset geleert", doc.getElementById("manual-merge-output").value === "");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ZIELORDNER-EXPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
