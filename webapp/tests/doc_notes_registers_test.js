// v2.121.0 Interne Mitteilungen in den Registern Releaseletter, Benutzerhandbuch,
// Prozessbild, Clickanweisung (nie in deren Vorschau/Exporten) und
// Dashboard-Uebersicht aller faelligen Mitteilungen (Register + FINAL-Staende).
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
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(e.message); });
const savedFiles = [];
const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
  beforeParse(window) {
    window.JSZip = JSZipNode;
    window.jspdf = { jsPDF: jsPDF };
    window.claude = { use: (name) => Promise.resolve(name === "downloads" ? { save: (req) => { savedFiles.push(req); return Promise.resolve({ status: "saved" }); } } : null) };
  },
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
async function waitUntil(fn, t) { const s = Date.now(); while (Date.now() - s < t) { if (fn()) return true; await wait(20); } return false; }
const SECRET = "INTERN-NOTIZ-9931";

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const host = (h) => doc.querySelector('[data-doc-notes-host="' + h + '"]');
  const cards = (h) => Array.from(host(h).querySelectorAll("[data-note-id]"));
  const count = (h) => doc.querySelector('[data-doc-notes-count="' + h + '"]').textContent;
  function addNote(h, cat, title, iv, text) {
    const b = host(h);
    b.querySelector(".doc-note-new-category").value = cat;
    b.querySelector(".doc-note-new-title").value = title;
    b.querySelector(".doc-note-new-interval").value = iv;
    b.querySelector(".doc-note-new-text").value = text;
    fire(b.querySelector("[data-doc-note-add]"), "click");
  }

  // Tickets fuer den Releaseletter
  nav("import");
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File(['<?xml version="1.0"?><rss><channel><item><key>ONESCM-8282</key><summary>Vertragsänderung online</summary><status>Fertig</status></item></channel></rss>'], "t.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await waitUntil(() => doc.getElementById("stat-tickets").textContent === "1", 5000);

  // ===================== Widget in allen vier Registern =====================
  for (const h of ["releaseletter", "benutzerhandbuch", "prozessbild", "clickanweisung"]) {
    nav(h);
    check(h + ": Abschnitt 'Interne Mitteilungen (0)' vorhanden", !!host(h) && count(h).startsWith("(0)") && host(h).textContent.includes("Noch keine internen Mitteilungen"));
  }
  nav("releaseletter");
  doc.querySelector('[data-doc-notes-wrap="releaseletter"]').open = true;
  addNote("releaseletter", "Neue Features", "Massenänderung", "7", SECRET + " – Massenänderung kommt mit 2026.5.");
  addNote("releaseletter", "Version Screen", "Screens 4.3", "30", "Screens für den Releaseletter mit 4.3 aufgenommen.");
  check("Releaseletter: 2 Mitteilungen, Zähler (2)", cards("releaseletter").length === 2 && count("releaseletter").startsWith("(2)"));
  cards("releaseletter")[1].querySelector('[data-note-field="text"]').value = "Screens mit 4.4 erneuert.";
  fire(cards("releaseletter")[1].querySelector("[data-note-save]"), "click");
  fire(cards("releaseletter")[1].querySelector("[data-note-history]"), "click");
  check("Bearbeiten mit Verlauf (vorheriger Text sichtbar)", cards("releaseletter")[1].querySelector(".final-note-history").textContent.includes("vorher: „Screens für den Releaseletter mit 4.3"));

  // ===================== Nie in Releaseletter-Vorschau/Exporten =====================
  doc.getElementById("releaseletter-keys").value = "ONESCM-8282";
  doc.getElementById("releaseletter-use-filtered").checked = false;
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  const preview = doc.getElementById("releaseletter-preview").textContent;
  check("Releaseletter-Vorschau ohne interne Mitteilungen", preview.includes("ONESCM-8282") && !preview.includes(SECRET) && !preview.includes("Massenänderung"));
  savedFiles.length = 0;
  fire(doc.getElementById("releaseletter-download-btn"), "click");
  await waitUntil(() => savedFiles.length === 1, 3000);
  const md = savedFiles[0] ? (typeof savedFiles[0].data === "string" ? savedFiles[0].data : Buffer.from(await savedFiles[0].data.arrayBuffer()).toString("utf-8")) : "";
  check("Markdown-Export ohne interne Mitteilungen", md.includes("ONESCM-8282") && !md.includes(SECRET));
  fire(doc.getElementById("releaseletter-download-docx-btn"), "click");
  await waitUntil(() => savedFiles.length === 2, 5000);
  const dx = savedFiles[1] ? await (await JSZipNode.loadAsync(Buffer.from(await savedFiles[1].data.arrayBuffer()))).file("word/document.xml").async("string") : "";
  check("Word-Export ohne interne Mitteilungen", dx.includes("ONESCM-8282") && !dx.includes(SECRET));

  // ===================== Weitere Register =====================
  nav("benutzerhandbuch");
  addNote("benutzerhandbuch", "Ideenspeicher", "Glossar", "90", "Glossar als Anhang ergänzen.");
  check("Benutzerhandbuch: eigene Mitteilung, Releaseletter unberührt", cards("benutzerhandbuch").length === 1 && count("benutzerhandbuch").startsWith("(1)") && cards("releaseletter").length === 2);
  check("Dashboard ohne Fälliges: Hinweis ausgeblendet", doc.getElementById("dashboard-notes-due").hidden);

  // ===================== Sitzung + Faelligkeit =====================
  savedFiles.length = 0;
  fire(doc.getElementById("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  const session = JSON.parse(savedFiles[0].data);
  check("Sitzung enthält die Mitteilungen der Register", session.docNotes.releaseletter.length === 2 && session.docNotes.benutzerhandbuch.length === 1);
  session.docNotes.releaseletter[0].updatedAt = new Date(Date.now() - 9 * 86400000).toISOString();
  const si = doc.getElementById("session-import-input");
  Object.defineProperty(si, "files", { value: [new win.File([JSON.stringify(session)], "s.json")], configurable: true });
  fire(si, "change");
  await wait(80);
  if (!doc.getElementById("confirm-modal-overlay").hidden) fire(doc.getElementById("confirm-modal-ok-btn"), "click");
  await wait(400);
  nav("dashboard");
  const dueList = doc.getElementById("dashboard-notes-due-list");
  check("Dashboard: 1 fällige Mitteilung mit Ort 'Releaseletter'", !doc.getElementById("dashboard-notes-due").hidden && doc.getElementById("dashboard-notes-due-count").textContent === "1" && dueList.textContent.includes("Massenänderung") && dueList.textContent.includes("Releaseletter"));
  fire(dueList.querySelector("[data-notes-due-open]"), "click");
  check("'Öffnen' springt ins Register Releaseletter und klappt die Mitteilungen auf", !doc.querySelector('[data-view-panel="releaseletter"]').hidden && doc.querySelector('[data-doc-notes-wrap="releaseletter"]').open);
  check("Zähler am Register zeigt '1 fällig', Karte hervorgehoben", count("releaseletter").includes("1 fällig") && cards("releaseletter")[0].classList.contains("final-note-overdue"));
  fire(cards("releaseletter")[0].querySelector("[data-note-confirm]"), "click");
  check("Nach 'Geprüft – unverändert' nicht mehr fällig", !cards("releaseletter")[0].classList.contains("final-note-overdue") && doc.getElementById("dashboard-notes-due").hidden);
  fire(cards("releaseletter")[1].querySelector("[data-note-delete]"), "click");
  await wait(40); fire(doc.getElementById("confirm-modal-ok-btn"), "click"); await wait(200);
  check("Löschen im Register", cards("releaseletter").length === 1);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE REGISTER-MITTEILUNGEN-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
