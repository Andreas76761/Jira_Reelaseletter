const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract/)) errors.push(e.message); });
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

function xmlItem(key, summary, status, created, updated) {
  return (
    "<item><title>[" + key + "] " + summary + "</title>" +
    "<project id=\"1\" key=\"ONESCM\">OneSCM</project>" +
    "<key id=\"1\">" + key + "</key>" +
    "<summary>" + summary + "</summary>" +
    "<type id=\"1\">Bug</type><priority id=\"1\">Hoch</priority>" +
    "<status id=\"1\">" + status + "</status>" +
    "<created>" + created + "</created><updated>" + updated + "</updated>" +
    "</item>"
  );
}

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const testXml =
    '<?xml version="1.0"?><rss><channel>' +
    xmlItem("ONESCM-90001", "OPNV_UMLAUT_PLACEHOLDER Anbindung fehlt komplett im Testfall", "Fertig", "Mon, 1 Jan 2026 09:00:00 +0000", "Mon, 1 Jan 2026 09:00:00 +0000") +
    xmlItem("ONESCM-90002", "Text mit ABC und XYZ Kuerzeln", "in Refinement", "Mon, 1 Jan 2026 09:00:00 +0000", "Mon, 1 Jan 2026 09:00:00 +0000") +
    xmlItem("ONESCM-90003", "Andere Schreibweise desselben Status", "In Refinement", "Mon, 1 Jan 2026 09:00:00 +0000", "Mon, 1 Jan 2026 09:00:00 +0000") +
    xmlItem("ONESCM-90004", "Abgebrochenes Ticket fuer Releaseletter-Test", "Cancelled", "Mon, 1 Jan 2026 09:00:00 +0000", "Mon, 1 Jan 2026 09:00:00 +0000") +
    xmlItem("ONESCM-90005", "Wirklich offenes Ticket fuer Releaseletter-Test", "Offen", "Mon, 1 Jan 2026 09:00:00 +0000", "Mon, 1 Jan 2026 09:00:00 +0000") +
    "</channel></rss>";
  const testXmlFinal = testXml.split("OPNV_UMLAUT_PLACEHOLDER").join("ÖPNV");

  doc.querySelector('.nav-item[data-view="import"]').click();
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([testXmlFinal], "bugfix_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Bug 1: Abkuerzungs-Regex mit Umlauten =====================
  doc.querySelector('.nav-item[data-view="verarbeitung"]').click();
  doc.querySelector('.import-tab[data-vsub="glossar-extrakt"]').click();
  fire(doc.getElementById("extract-glossary-btn"), "click");
  await wait(100);
  const abbrevText = doc.getElementById("abbrev-tbody").textContent;
  check("Umlaut-Abkürzung 'ÖPNV' wird vollständig erkannt (nicht abgeschnitten)", abbrevText.includes("ÖPNV"));
  check("Abgeschnittenes 'PNV' wird NICHT separat als eigenes Kürzel gelistet", !new RegExp("(^|[^Ö])PNV\\b").test(abbrevText.replace("ÖPNV", "")));
  check("Normale Abkürzungen ABC/XYZ weiterhin erkannt", abbrevText.includes("ABC") && abbrevText.includes("XYZ"));

  // ===================== Bug 2: Status-Bucket case-insensitiv =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-90002";
  fire(doc.getElementById("search-input"), "input");
  await wait(200); // Suchfeld ist debounced (150ms) - siehe ticket_cockpit.html
  const pill1 = doc.querySelector("#table-body tr .pill");
  const bucket1 = pill1 ? pill1.className.replace("pill", "").trim() : null;
  doc.getElementById("search-input").value = "ONESCM-90003";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const pill2 = doc.querySelector("#table-body tr .pill");
  const bucket2 = pill2 ? pill2.className.replace("pill", "").trim() : null;
  console.log("  'in Refinement' -> Bucket:", bucket1, " | 'In Refinement' -> Bucket:", bucket2);
  check("'in Refinement' liegt im Bucket 'backlog'", bucket1 === "backlog");
  check("'In Refinement' (andere Gross-/Kleinschreibung) liegt im SELBEN Bucket (Bugfix)", bucket1 === bucket2);
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Bug 3: Releaseletter zaehlt Cancelled nicht als offen =====================
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  doc.getElementById("releaseletter-use-filtered").checked = false;
  fire(doc.getElementById("releaseletter-use-filtered"), "change");
  doc.getElementById("releaseletter-keys").value = "ONESCM-90001\nONESCM-90004\nONESCM-90005";
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(100);
  const letterText = doc.getElementById("releaseletter-preview").textContent;
  const openSection = letterText.split("Bekannte Einschränkungen")[1] || "";
  check("Erledigtes Ticket (ONESCM-90001) NICHT unter offenen Punkten", !openSection.includes("ONESCM-90001"));
  check("Cancelled-Ticket (ONESCM-90004) NICHT unter offenen Punkten (Bugfix)", !openSection.includes("ONESCM-90004"));
  check("Tatsächlich offenes Ticket (ONESCM-90005) weiterhin unter offenen Punkten", openSection.includes("ONESCM-90005"));

  // ===================== Bug 4: Export-Button zeigt Sanduhr synchron vor schwerer Arbeit =====================
  doc.querySelector('.nav-item[data-view="output-md"]').click();
  const exportBtn = doc.getElementById("output-md-export-btn");
  const exportSpinner = doc.getElementById("output-md-export-spinner");
  check("Export-Spinner vor Klick versteckt", exportSpinner.hidden === true);
  fire(exportBtn, "click");
  check("Export-Spinner sofort nach Klick sichtbar (vor JSZip-Verarbeitung)", exportSpinner.hidden === false);
  check("Export-Button während Verarbeitung deaktiviert", exportBtn.disabled === true);
  await wait(600);
  check("Export-Spinner nach Abschluss wieder versteckt", exportSpinner.hidden === true);

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE BUGFIX-VERIFIKATIONSTESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
