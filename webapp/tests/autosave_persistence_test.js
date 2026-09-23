// Persistenter Speicher (automatisches Speichern in IndexedDB, Einstellungen
// → "Persistenter Speicher"): ergänzt "Sitzung speichern/laden" (Datei) um
// automatisches, entprelltes Speichern im Browser selbst. Prüft mit einer
// echten IndexedDB-Implementierung (fake-indexeddb, da jsdom selbst KEINE
// IndexedDB mitbringt - siehe Kommentar in autosave_unavailable_test.js für
// den Fall ohne IndexedDB): (1) Auto-Save feuert nach kurzer Inaktivität
// nach einer Interaktion, Status-Text aktualisiert sich, (2) "Automatisch
// gespeicherte Sitzung löschen" funktioniert, (3) Deaktivieren stoppt
// weitere Auto-Saves, (4) ein neu geöffneter Tab (zweite JSDOM-Instanz,
// dieselbe zugrundeliegende Fake-IndexedDB) findet die zuvor automatisch
// gespeicherte Sitzung und bietet die Wiederherstellung per Bestätigungs-
// dialog an - Annehmen stellt die Daten wieder her, Ablehnen lädt
// stattdessen die Ausgangsdaten UND lässt die gespeicherte Sitzung
// unangetastet (kein stilles Überschreiben/Löschen bei Ablehnung).
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { IDBFactory } = require("fake-indexeddb");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(win, el, type) { el.dispatchEvent(new win.Event(type, { bubbles: true })); }
async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}
async function confirmViaModal(win, doc, accept) {
  await wait(50);
  fire(win, doc.getElementById(accept ? "confirm-modal-ok-btn" : "confirm-modal-cancel-btn"), "click");
  await waitUntil(() => doc.getElementById("confirm-modal-overlay").hidden === true, 2000);
  await wait(300); // Zeit fuer die async Weiterverarbeitung NACH dem Schliessen des Dialogs (z.B. IndexedDB-Zugriff)
}

function makeDom(sharedIndexedDb) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: function () {} };
      window.claude = { use: function () { return Promise.resolve(null); } };
      window.indexedDB = sharedIndexedDb;
    },
  });
  return { dom, errors };
}

(async () => {
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Eine Fake-IndexedDB-Instanz, geteilt zwischen mehreren JSDOM-Fenstern -
  // simuliert "derselbe Browser/dasselbe Profil, mehrere Tabs/Neuladen".
  const sharedDb = new IDBFactory();

  // ===================== Tab 1: normales Auto-Save =====================
  const { dom: dom1, errors: errors1 } = makeDom(sharedDb);
  await wait(500);
  const doc1 = dom1.window.document;
  const win1 = dom1.window;

  check("Persistenter-Speicher-Bereich vorhanden", !!doc1.getElementById("autosave-enabled-cb"));
  check("Checkbox 'Automatisches Speichern aktiv' initial aktiviert (IndexedDB verfügbar)", doc1.getElementById("autosave-enabled-cb").checked === true && doc1.getElementById("autosave-enabled-cb").disabled === false);

  // Eine Interaktion loest den entprellten Auto-Save aus.
  doc1.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  check("Vor dem Auto-Save: Status-Text noch leer", (doc1.getElementById("autosave-status").textContent || "").trim() === "");
  await wait(2900); // AUTOSAVE_DEBOUNCE_MS (2500ms) + Puffer
  check("Nach Debounce-Zeit: Status-Text meldet erfolgreiches Auto-Save", doc1.getElementById("autosave-status").textContent.includes("Zuletzt automatisch gespeichert"));

  // ===================== Löschen der automatisch gespeicherten Sitzung =====================
  fire(win1, doc1.getElementById("autosave-delete-btn"), "click");
  await confirmViaModal(win1, doc1, true);
  check("Nach Löschen: Status-Text bestätigt Löschung", doc1.getElementById("autosave-status").textContent.includes("gelöscht"));
  const toast1 = doc1.getElementById("toast");
  check("Löschen-Toast angezeigt", toast1.textContent.includes("entfernt"));

  // Erneut auslösen, damit fuer den naechsten Teil (Tab 2: Wiederherstellen)
  // wieder ein Datensatz vorhanden ist.
  doc1.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(2900);
  check("Erneutes Auto-Save nach Löschen funktioniert wieder", doc1.getElementById("autosave-status").textContent.includes("Zuletzt automatisch gespeichert"));

  // ===================== Deaktivieren stoppt weitere Auto-Saves =====================
  const cb1 = doc1.getElementById("autosave-enabled-cb");
  cb1.checked = false;
  fire(win1, cb1, "change");
  await wait(50);
  check("Nach Deaktivieren: Status-Text meldet 'deaktiviert'", doc1.getElementById("autosave-status").textContent.includes("deaktiviert"));
  const statusBeforeIdleWait = doc1.getElementById("autosave-status").textContent;
  doc1.querySelector('.nav-item[data-view="import"]').click();
  await wait(2900);
  check("Bei deaktiviertem Auto-Save: Status-Text ändert sich durch weitere Klicks NICHT mehr", doc1.getElementById("autosave-status").textContent === statusBeforeIdleWait);

  if (errors1.length) { console.error("\nJS-Fehler (Tab 1):", errors1); checks.push(["keine Fehler (Tab 1)", false]); }

  // ===================== Tab 2: findet die gespeicherte Sitzung, bietet Wiederherstellung an =====================
  const { dom: dom2, errors: errors2 } = makeDom(sharedDb);
  const doc2 = dom2.window.document;
  const win2 = dom2.window;
  const dialogShown2 = await waitUntil(() => doc2.getElementById("confirm-modal-overlay").hidden === false, 2000);
  check("Tab 2: Bestätigungsdialog zur Wiederherstellung erscheint automatisch", dialogShown2);
  check("Tab 2: Dialogtext erwähnt Wiederherstellung", doc2.getElementById("confirm-modal-message").textContent.includes("wiederherstellen"));
  fire(win2, doc2.getElementById("confirm-modal-ok-btn"), "click");
  await wait(300);
  check("Tab 2: Nach Annehmen ist die Sitzung wiederhergestellt (Log-Eintrag vorhanden)", doc2.getElementById("log-list").textContent.includes("wiederhergestellt"));
  check("Tab 2: Status-Text bestätigt Wiederherstellung", doc2.getElementById("autosave-status").textContent.includes("Wiederhergestellt"));

  if (errors2.length) { console.error("\nJS-Fehler (Tab 2):", errors2); checks.push(["keine Fehler (Tab 2)", false]); }

  // ===================== Tab 3: Ablehnen lädt Ausgangsdaten, lässt Autosave-Datensatz unangetastet =====================
  const { dom: dom3, errors: errors3 } = makeDom(sharedDb);
  const doc3 = dom3.window.document;
  const win3 = dom3.window;
  const dialogShown3 = await waitUntil(() => doc3.getElementById("confirm-modal-overlay").hidden === false, 2000);
  check("Tab 3: Bestätigungsdialog erscheint erneut (Datensatz noch vorhanden)", dialogShown3);
  fire(win3, doc3.getElementById("confirm-modal-cancel-btn"), "click");
  await wait(300);
  check("Tab 3: Nach Ablehnen sind die Ausgangsdaten (Demo-Tickets) geladen", parseInt(doc3.getElementById("stat-tickets").textContent, 10) > 0);
  check("Tab 3: Kein 'wiederhergestellt'-Log-Eintrag (da abgelehnt)", !doc3.getElementById("log-list").textContent.includes("wiederhergestellt"));

  if (errors3.length) { console.error("\nJS-Fehler (Tab 3):", errors3); checks.push(["keine Fehler (Tab 3)", false]); }

  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PERSISTENTER-SPEICHER-TESTS BESTANDEN");
  // Auto-Save-Timer (setTimeout ohne unref-Möglichkeit über window.setTimeout)
  // würde den Node-Prozess sonst bis zu AUTOSAVE_DEBOUNCE_MS laenger am
  // Leben halten als noetig - fuer diesen einen Test (der IndexedDB bewusst
  // verfuegbar macht) hier explizit sauber beenden.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
