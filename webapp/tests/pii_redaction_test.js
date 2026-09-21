const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const FIXTURES = path.join(__dirname, "fixtures");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

const dom = new JSDOM(full, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc,
});
dom.window.JSZip = function () {};
dom.window.jspdf = { jsPDF: function () {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fire(el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>PII-1</key><summary>Kundenanfrage zum Fahrzeug</summary>
      <description>Kunde Max Mustermann, erreichbar unter max@example.com oder telefonisch unter +49 176 12345678 bzw. 030 987654321.
Fahrgestellnummer: WVWZZZ1JZXW000001. Kennzeichen: M-AB 1234.
Adresse: Musterstraße 12, 70173 Stuttgart.
Das Ticket betrifft die Vertragsverlängerung.</description>
      <status>Offen</status><type>Epic</type></item>
    <item><key>PII-2</key><summary>Normaler Text ohne PII</summary>
      <description>Rufe das Vertragsmodul auf und speichere die Änderung. Die Versionsnummer 2026.3 bleibt unveraendert. Ticket ONESCM-12345 betroffen.</description>
      <status>Offen</status></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new win.File([xml], "pii_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  const row = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("PII-1"));
  fire(row, "click");
  const fieldsText = doc.getElementById("modal-fields").textContent;
  const descText = doc.getElementById("modal-desc").textContent;

  check("E-Mail wurde entfernt", !descText.includes("max@example.com") && descText.includes("[E-Mail entfernt]"));
  check("Telefonnummer (+49...) wurde entfernt", !descText.includes("176 12345678") && descText.includes("[Telefonnummer entfernt]"));
  check("Telefonnummer (030...) wurde entfernt", !descText.includes("987654321"));
  check("VIN/Fahrgestellnummer wurde entfernt", !descText.includes("WVWZZZ1JZXW000001") && descText.includes("[FIN/VIN entfernt]"));
  check("Kennzeichen wurde entfernt", !descText.includes("M-AB 1234") && descText.includes("[Kennzeichen entfernt]"));
  check("Straße+Hausnummer wurde entfernt", !descText.includes("Musterstraße 12") && descText.includes("[Adresse entfernt]"));
  check("PLZ+Ort wurde entfernt", !descText.includes("70173 Stuttgart") && descText.includes("[Ort/PLZ entfernt]"));
  check("Ticket-Inhalt (Vertragsverlängerung) bleibt erhalten", descText.includes("Vertragsverlängerung"));
  check("Name 'Max Mustermann' im Freitext bleibt unveraendert (Name-Erkennung nur bei Bearbeiter/Ersteller-Feldern, nicht im Fließtext)", descText.includes("Max Mustermann"));

  fire(doc.getElementById("modal-close"), "click");

  // ===================== Keine falsch-positiven Treffer bei normalem Text =====================
  const row2 = Array.from(doc.querySelectorAll("#table-body tr")).find((r) => r.textContent.includes("PII-2"));
  fire(row2, "click");
  const descText2 = doc.getElementById("modal-desc").textContent;
  check("Ticket-Key 'ONESCM-12345' im Freitext bleibt unveraendert (kein Telefon-Fehltreffer)", descText2.includes("ONESCM-12345"));
  check("Versionsnummer '2026.3' bleibt unveraendert", descText2.includes("2026.3"));
  check("Normaler Satzinhalt bleibt vollständig erhalten", descText2.includes("Rufe das Vertragsmodul auf"));
  fire(doc.getElementById("modal-close"), "click");

  // ===================== Redaktion gilt fuer ALLE 663 eingebetteten Demo-Tickets (keine Regression) =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  fire(doc.getElementById("reset-session-btn"), "click");
  await wait(300);
  const allDescText = Array.from(doc.querySelectorAll("#table-body tr")).length;
  check("Demo-Daten laden weiterhin fehlerfrei nach PII-Erweiterung (663 Tickets)", doc.getElementById("stat-tickets").textContent === "663");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE PII-REDAKTIONS-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
