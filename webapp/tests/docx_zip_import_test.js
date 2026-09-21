const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = JSZipNode;
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // ===================== Neue Tabs vorhanden =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  check("Tab 'Word (DOC/DOCX)' vorhanden", !!doc.querySelector('.import-tab[data-mode="docx"]'));
  check("Tab 'ZIP-Archiv' vorhanden", !!doc.querySelector('.import-tab[data-mode="zip"]'));

  // ===================== DOCX-Tab: eigenständiger Import, gleiches Ergebnis wie bisher über 'Andere'/'Releaseinfo' =====================
  doc.querySelector('.import-tab[data-mode="docx"]').click();
  check("DOCX-Tab-Dropzone akzeptiert nur .docx/.doc", doc.getElementById("file-input").getAttribute("accept") === ".docx,.doc");
  check("DOCX-Tab-Titel nennt Word-Dokument", doc.getElementById("dropzone-title").textContent.includes("Word"));

  const docxBuf = fs.readFileSync(path.join(FIXTURES, "releaseinfo_sample.docx"));
  const docxFile = new win.File([docxBuf], "release_notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [docxFile], configurable: true });
  fire(input, "change");
  await wait(400);
  check("DOCX-Tab-Import erfolgreich (Toast)", doc.getElementById("toast").textContent.includes("Import erfolgreich"));

  // ===================== ZIP-Tab: Sanduhr sichtbar während der Verarbeitung =====================
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(200);
  doc.querySelector('.import-tab[data-mode="zip"]').click();
  check("ZIP-Tab-Dropzone akzeptiert nur .zip", doc.getElementById("file-input").getAttribute("accept") === ".zip");

  const xmlEntry = `<?xml version="1.0"?><rss><channel>
    <item><key>ZIP-1</key><summary>Ticket aus XML im ZIP</summary>
      <description>Beschreibung aus dem XML-Eintrag.</description>
      <status>Offen</status><type>Task</type></item>
  </channel></rss>`;
  const txtEntry = `Contract Management ( CM-1.0 ) - Domain: Contract Management
Schlüssel\tStatus\tZusammenfassung
ZIP-2\tFertig\tTicket aus TXT im ZIP`;
  const badEntry = "<html><body>Kein erkennbares Jira-Format, nur Fließtext ohne Struktur.</body></html>";

  const zip = new JSZipNode();
  zip.file("export.xml", xmlEntry);
  zip.file("releaseinfo.txt", txtEntry);
  zip.file("unbekannt.html", badEntry);
  zip.file("readme.md", "Dieser Dateityp wird nicht unterstützt und soll ohne Fehlermeldung übersprungen werden.");
  zip.file("__MACOSX/._export.xml", "macOS-Metadaten, muss ignoriert werden");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  const zipFile = new win.File([zipBuf], "bundle.zip", { type: "application/zip" });

  Object.defineProperty(input, "files", { value: [zipFile], configurable: true });
  fire(input, "change");
  // Direkt nach dem 'change'-Event (noch vor dem ersten await in handleFiles) sollte die
  // Sanduhr bereits sichtbar sein - async-Funktionen laufen synchron bis zum ersten await.
  check("Sanduhr/Spinner erscheint sofort nach Upload-Start", !doc.getElementById("dropzone-spinner").hidden);
  check("Dropzone im Processing-Zustand", doc.getElementById("dropzone").className.includes("processing"));
  check("Datei-Input während Verarbeitung deaktiviert", doc.getElementById("file-input").disabled);

  await wait(500);

  check("Sanduhr/Spinner nach Abschluss wieder versteckt", doc.getElementById("dropzone-spinner").hidden);
  check("Dropzone nicht mehr im Processing-Zustand", !doc.getElementById("dropzone").className.includes("processing"));
  check("Datei-Input wieder aktiviert", !doc.getElementById("file-input").disabled);

  const toast = doc.getElementById("toast");
  check("Toast meldet teilweisen Erfolg (eine Datei im ZIP ist fehlgeschlagen)", toast.textContent.includes("teilweise") || toast.className.includes("error"));
  check("Toast nennt Anzahl gelesener/gesamter Dateien (2/3)", toast.textContent.includes("2/3"));

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const rowZip1 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("ZIP-1"));
  const rowZip2 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("ZIP-2"));
  check("Ticket ZIP-1 (aus export.xml im ZIP) importiert", !!rowZip1);
  check("Ticket ZIP-2 (aus releaseinfo.txt im ZIP) importiert", !!rowZip2 && rowZip2.textContent.includes("Fertig"));

  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="protokoll"]').click();
  const logText = doc.getElementById("log-list").textContent;
  check("Protokoll zeigt Import-Fehler für 'unbekannt.html' aus dem ZIP", logText.includes("unbekannt.html"));
  check("Protokoll nennt 'bundle.zip' als Quelle des Fehlers", logText.includes("bundle.zip"));
  check("readme.md (nicht unterstuetzter Dateityp) erzeugt KEINEN Fehler-Eintrag", !logText.includes("readme.md"));

  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const importRow = Array.from(doc.querySelectorAll("#imports-tbody tr")).find((r) => r.textContent.includes("bundle.zip"));
  check("Dateiverwaltung zeigt 'bundle.zip' als einen Import-Eintrag", !!importRow);
  check("Format-Spalte nennt ZIP-Archiv mit Datei-Zähler (2/3)", importRow && importRow.textContent.includes("2/3"));

  // ===================== Leeres/nicht unterstütztes ZIP-Archiv =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="zip"]').click();
  const emptyZip = new JSZipNode();
  emptyZip.file("nichts.md", "unpassender Dateityp");
  const emptyZipBuf = await emptyZip.generateAsync({ type: "nodebuffer" });
  const emptyZipFile = new win.File([emptyZipBuf], "leer.zip", { type: "application/zip" });
  Object.defineProperty(input, "files", { value: [emptyZipFile], configurable: true });
  fire(input, "change");
  await wait(400);
  const toastEmpty = doc.getElementById("toast");
  check("ZIP ohne unterstützte Dateien zeigt verständliche Fehlermeldung statt Absturz", toastEmpty.className.includes("error"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DOCX/ZIP-IMPORT-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
