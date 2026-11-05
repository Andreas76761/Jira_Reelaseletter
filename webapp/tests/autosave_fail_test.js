// v2.160.0/v2.168.0 Automatisches Speichern fehlgeschlagen → sichtbare Warnleiste oben (Grund, Sitzungsgröße, freier Speicher,
// letztes erfolgreiches Speichern), einmal je Fehlerserie Hinweis + Protokoll, Knöpfe (Datei speichern, Speicher sparen,
// Dashboard, erneut versuchen, ausblenden), Kachel im Dashboard; nach Erfolg verschwindet die Leiste.
// Echte IndexedDB-Implementierung (fake-indexeddb); „Speicher voll“ wird über put() → QuotaExceededError nachgestellt.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const FIDB = require("fake-indexeddb");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid|opencv/i)) errors.push(e.message); });
const savedFiles = [];

let failMode = null; // null | "quota" | "other"
const origPut = FIDB.IDBObjectStore.prototype.put;
FIDB.IDBObjectStore.prototype.put = function () {
  if (failMode === "quota") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  if (failMode === "other") throw new DOMException("Data clone failed.", "DataCloneError");
  return origPut.apply(this, arguments);
};

(async () => {
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: function () {} };
      window.indexedDB = new FIDB.IDBFactory();
      window.__est = { usage: 49.9 * 1048576, quota: 50 * 1048576 };
      window.navigator.storage = { estimate: () => Promise.resolve(window.__est) };
      window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
    },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(25); } return false; }
  await wait(600);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const visible = (v) => !doc.querySelector('[data-view-panel="' + v + '"]').hidden;
  const status = () => $("autosave-status").textContent;
  const logText = () => Array.from(doc.querySelectorAll("#log-list li")).map((li) => li.textContent).join("\n");
  const tile = (i) => doc.querySelectorAll("#dash-store-tiles .vrev-tile")[i];
  async function change() { fire(doc.body, "change"); }

  check("Warnleiste anfangs verborgen", $("autosave-fail").hidden);

  // 1) Erfolgreiches Speichern
  await change();
  check("Automatisches Speichern erfolgreich", await waitUntil(() => /Zuletzt automatisch gespeichert/.test(status()), 6000) && $("autosave-fail").hidden);

  // 2) Speicher voll
  failMode = "quota";
  await change();
  await waitUntil(() => !$("autosave-fail").hidden, 6000);
  const msg = $("autosave-fail-msg").textContent;
  check("Speicher voll: Warnleiste sichtbar mit Grund, Sitzungsgröße, freiem Speicher und letztem Erfolg",
    !$("autosave-fail").hidden && /^Der Browser lehnt weitere Daten ab \(Speicher voll\) – die Sitzung \([\d,]+ (KB|MB), frei laut Browser 102,4 KB\) ist nur noch in diesem Fenster\./.test(msg) && !/nicht verlässlich/.test(msg) && /Zuletzt erfolgreich gespeichert: /.test(msg) && /Speicher freigeben/.test(msg));
  check("Status in den Einstellungen nennt den Grund", /fehlgeschlagen – Browser-Speicher voll/.test(status()));
  check("Fehler-Hinweis (Toast) einmal", $("toast").classList.contains("error") && /Browser-Speicher voll/.test($("toast").textContent));
  await wait(100);

  // 3) Zweiter Fehlversuch: zaehlt mit, kein zweiter Protokolleintrag
  await change();
  await waitUntil(() => /2 Versuche fehlgeschlagen/.test($("autosave-fail-msg").textContent), 6000);
  check("Zweiter Fehlversuch wird gezählt", /\(2 Versuche fehlgeschlagen\)/.test($("autosave-fail-msg").textContent));
  check("Protokoll: genau ein Eintrag je Fehlerserie", (logText().match(/Automatisches Speichern fehlgeschlagen \(Browser-Speicher voll/g) || []).length === 1);

  // 4) Dashboard-Kachel
  doc.querySelector('.nav-item[data-view="dashboard"]').click(); await wait(30);
  $("dash-store-refresh-btn").click(); await wait(200);
  check("Dashboard: Kachel „Automatisch gespeichert“ rot mit Grund", tile(4) && tile(4).querySelector("b").textContent === "fehlgeschlagen" && /Browser-Speicher voll · zuletzt ok/.test(tile(4).textContent) && tile(4).classList.contains("vrev-tile-fail"));

  // 5) Knoepfe der Warnleiste
  savedFiles.length = 0;
  $("autosave-fail-export-btn").click();
  check("„Sitzung als Datei speichern“ exportiert die Sitzung", await waitUntil(() => savedFiles.length === 1 && /\.json$/.test(savedFiles[0].filename), 5000));
  $("autosave-fail-shrink-btn").click(); await wait(30);
  check("„Speicher sparen (Bilder)“ öffnet Bilder", visible("bilder"));
  $("autosave-fail-dash-btn").click(); await wait(30);
  check("„Speicher je Register“ öffnet das Dashboard", visible("dashboard"));

  // 6) Ausblenden: bleibt bei weiteren Fehlern verborgen
  $("autosave-fail-close-btn").click(); await wait(20);
  check("Ausblenden verbirgt die Leiste", $("autosave-fail").hidden);
  await change(); await wait(3200);
  check("Ausgeblendet bleibt sie bei weiteren Fehlversuchen verborgen", $("autosave-fail").hidden && /fehlgeschlagen/.test(status()));

  // 7) Wieder erfolgreich (Erneut versuchen)
  failMode = null;
  $("autosave-fail-retry-btn").click();
  await waitUntil(() => /Zuletzt automatisch gespeichert/.test(status()), 6000);
  check("Nach Erfolg: Leiste weg, Hinweis „wieder“, Protokoll", $("autosave-fail").hidden && /funktioniert wieder/.test($("toast").textContent) && /Automatisches Speichern wieder erfolgreich/.test(logText()));
  $("dash-store-refresh-btn").click(); await wait(200);
  check("Dashboard-Kachel wieder grün „ok“", tile(4).querySelector("b").textContent === "ok" && tile(4).classList.contains("vrev-tile-ok"));

  // 8) Anderer Fehler nach Erfolg: Leiste erscheint wieder (Ausblenden gilt nur fuer die alte Serie)
  failMode = "other";
  await change();
  await waitUntil(() => !$("autosave-fail").hidden, 6000);
  check("Anderer Fehler: Leiste wieder sichtbar mit Grund", !$("autosave-fail").hidden && /^Grund: DataCloneError – die Sitzung/.test($("autosave-fail-msg").textContent) && !/Speicher freigeben/.test($("autosave-fail-msg").textContent));
  failMode = null;
  $("autosave-fail-retry-btn").click();
  await waitUntil(() => /Zuletzt automatisch gespeichert/.test(status()), 6000);

  // 9) v2.168: Browser schaetzt viel frei, lehnt aber ab → ehrliche Meldung; „Erneut versuchen“ entfernt zuerst die alte Sicherung
  dom.window.__est = { usage: 1048576, quota: 3 * 1073741824 };
  failMode = "quota";
  await change();
  await waitUntil(() => !$("autosave-fail").hidden, 6000);
  const m2 = $("autosave-fail-msg").textContent;
  check("Schätzung „3 GB frei“ trotz Ablehnung: als nicht verlässlich benannt, keine widersprüchliche Angabe", /^Der Browser lehnt weitere Daten ab \(Speicher voll\) – die Sitzung \([\d,]+ (KB|MB)\) ist nur/.test(m2) && /Die Schätzung des Browsers \(3,00 GB frei\) ist hier nicht verlässlich\./.test(m2) && /„Erneut versuchen“ gibt auch den Platz frei/.test(m2));
  doc.querySelector('.nav-item[data-view="dashboard"]').click(); await wait(30);
  $("dash-store-refresh-btn").click(); await wait(200);
  check("Dashboard: Warnung trotz großer Schätzung, Kachel „Frei“ rot", !$("dash-store-warn").hidden && /scheitert am Browser-Speicher, obwohl der Browser 3,00 GB frei schätzt/.test($("dash-store-warn").textContent) && tile(3).classList.contains("vrev-tile-fail"));
  const deletes = [];
  const origDel = FIDB.IDBObjectStore.prototype.delete;
  FIDB.IDBObjectStore.prototype.delete = function (k) { deletes.push(k); return origDel.apply(this, arguments); };
  failMode = null;
  $("autosave-fail-retry-btn").click();
  await waitUntil(() => /Zuletzt automatisch gespeichert/.test(status()), 6000);
  check("„Erneut versuchen“ nach „Speicher voll“: alte Sicherung zuerst entfernt, dann gespeichert, Leiste weg", deletes.includes("current") && $("autosave-fail").hidden && /alte Sicherung entfernt, um belegten Speicher freizugeben/.test(logText()));
  FIDB.IDBObjectStore.prototype.delete = origDel;
  $("dash-store-refresh-btn").click(); await wait(200);
  check("Dashboard danach ohne Warnung", $("dash-store-warn").hidden);

  check("Keine JS-Fehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]).length;
  console.log("\n" + (checks.length - failed) + "/" + checks.length + " Checks bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
