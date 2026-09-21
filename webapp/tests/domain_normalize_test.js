const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  // Basiszustand: "Documents & Communications" Domain-Count vor Releaseinfo-Import
  function domainCounts() {
    const counts = {};
    Array.from(doc.querySelectorAll("#domain-chart .domain-row")).forEach((row) => {
      const name = row.querySelector(".name").textContent;
      const count = parseInt(row.querySelector(".count").textContent, 10);
      counts[name] = count;
    });
    return counts;
  }

  const before = domainCounts();
  console.log("Vorher 'Documents & Communications':", before["Documents & Communications"]);
  check("'Documents and Communication' NICHT als eigene Domain vorhanden (vorher)", !("Documents and Communication" in before));

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="releaseinfo"]').click();
  const releaseinfoText = fs.readFileSync(path.join(FIXTURES, "releaseinfo_full.txt"), "utf-8");
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new dom.window.File([releaseinfoText], "release_notes.txt", { type: "text/plain" })] , configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const after = domainCounts();
  console.log("Nachher 'Documents & Communications':", after["Documents & Communications"]);
  console.log("Nachher 'Customer & Partner Management':", after["Customer & Partner Management"]);
  console.log("Alle Domains nachher:", Object.keys(after).sort());

  check("KEINE separate Domain 'Documents and Communication' mehr", !("Documents and Communication" in after));
  check("KEINE separate Domain 'Documents and Communications' mehr", !("Documents and Communications" in after));
  check("'Documents & Communications' um genau 6 gestiegen (46+6=52)", after["Documents & Communications"] === (before["Documents & Communications"] || 0) + 6);
  check("KEINE separate Domain 'Customer and Partner Management' mehr", !("Customer and Partner Management" in after));
  check("KEINE fehlerhafte Domain 'Customer&Partner Management' (ohne Leerzeichen) mehr", !("Customer&Partner Management" in after));
  check("'Customer & Partner Management' (mit Leerzeichen) vorhanden", "Customer & Partner Management" in after);
  check("Summe Customer & Partner Management = alt(38) + releaseinfo(13)", after["Customer & Partner Management"] === 38 + 13);

  // Absichtlich NICHT gemergte, zweideutige Domains bleiben getrennt
  check("'Revenue Management' und 'Revenue and Cost Management' bleiben getrennt", ("Revenue Management" in after) && ("Revenue and Cost Management" in after));
  check("'Contract Management' und 'Contract Generation and Contract Management' bleiben getrennt", ("Contract Management" in after) && ("Contract Generation and Contract Management" in after));

  // Dateiverwaltung: Alias-Tabelle sichtbar
  doc.querySelector('.nav-item[data-view="dateiverwaltung"]').click();
  const aliasRows = doc.querySelectorAll("#domain-aliases-tbody tr");
  check("Alias-Tabelle in Dateiverwaltung zeigt Einträge", aliasRows.length >= 3);
  check("Alias-Tabelle enthält 'documents and communication'", doc.getElementById("domain-aliases-tbody").textContent.includes("documents and communication"));

  if (errors.length) { console.error("JS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE DOMAIN-NORMALISIERUNGS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
