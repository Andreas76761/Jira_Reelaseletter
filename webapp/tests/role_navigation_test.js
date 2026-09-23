// Rollen-Navigation (oneSCM): aus der hochgeladenen Navigationsvorlage
// (Navigation_oneSCM_Version3.docx) abgeleitete Menüstruktur je Rolle
// (Dealer/Markt/MO/HQ), s. roleNavigationSeedData(). Reine Referenzanzeige
// in Einstellungen + Grundlage für den Rollen-Filter bei Benutzerhandbuch-
// Kapitel-Generator und Releaseletter.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker/i)) errors.push(e.message); });

let sampleCalls = [];
let sampleImpl = async (input, opts) => {
  sampleCalls.push({ input, opts });
  return { text: "Generierter Kapiteltext.", truncated: false, modelTierApplied: "default" };
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

(async () => {
  await wait(500);
  const doc = dom.window.document;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }

  const xml = `<?xml version="1.0"?><rss><channel>
    <item><key>ROLE-1</key><summary>Servicevertrag im Autohaus anlegen</summary>
      <description>Der Dealer erfasst die Fahrzeugdaten und legt den Vertrag an.</description>
      <status>Fertig</status><type>Feature</type>
      <customfields><customfield><customfieldname>Domain</customfieldname>
      <customfieldvalues><customfieldvalue>Contract Management</customfieldvalue></customfieldvalues>
      </customfield></customfields></item>
  </channel></rss>`;
  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [new dom.window.File([xml], "role_nav_test.xml", { type: "application/xml" })], configurable: true });
  fire(input, "change");
  await wait(400);

  // ===================== Einstellungen: Rollen-Navigation-Referenzanzeige =====================
  doc.querySelector('.nav-item[data-view="einstellungen"]').click();
  await wait(100);
  const roleNavList = doc.getElementById("role-nav-list");
  check("Rollen-Navigation-Bereich vorhanden", !!roleNavList);
  const roleNavHtml = roleNavList.innerHTML;
  check("Zeigt Rolle 'Dealer'", roleNavHtml.includes("Dealer"));
  check("Zeigt Rolle 'Markt'", roleNavHtml.includes("Markt"));
  check("Zeigt Rolle 'MO (Market Operation)'", roleNavHtml.includes("MO (Market Operation)"));
  check("Zeigt Rolle 'HQ (Headquarters)'", roleNavHtml.includes("HQ (Headquarters)"));
  check("Mindestens 1 Lücke-Badge vorhanden (z. B. HQ undokumentiert)", roleNavList.querySelectorAll(".dq-count-warn").length > 0);
  check("HQ-Dokumentationslücke wird als Hinweistext angezeigt", roleNavHtml.includes("keine einzige Bildschirmaufnahme"));
  check("Quelle (Navigationsvorlage) wird referenziert", roleNavHtml.includes("Navigation_oneSCM_Version3.docx"));

  // ===================== Benutzerhandbuch-Gliederung: gapNote bei Kapitel 15 (HQ) =====================
  const outlineTbody = doc.getElementById("outline-tbody");
  check("Gliederungstabelle zeigt Lücke-Hinweis bei Kapitel 15 (HQ-Rolle)",
    outlineTbody.innerHTML.includes("Kapitel 15: HQ-Rolle") && outlineTbody.innerHTML.includes("keine einzige Bildschirmaufnahme"));

  // ===================== Kapitel-Generator: Rollen-Select vorhanden, wirkt auf den Prompt =====================
  const roleSelect = doc.getElementById("manual-role-select");
  check("Rollen-Select im Kapitel-Generator vorhanden", !!roleSelect);
  check("Rollen-Select hat 5 Optionen (Alle/Dealer/Markt/MO/HQ)", roleSelect.options.length === 5);
  doc.querySelector('.nav-item[data-view="benutzerhandbuch"]').click();
  await wait(50);
  roleSelect.value = "dealer";
  fire(doc.getElementById("manual-domain-select"), "change");
  const domainSelect = doc.getElementById("manual-domain-select");
  Array.from(domainSelect.options).forEach(function (o) { if (o.value === "Contract Management") o.selected = true; });
  fire(domainSelect, "change");
  await wait(50);
  sampleCalls = [];
  fire(doc.getElementById("manual-generate-btn"), "click");
  await wait(200);
  check("sample() wurde für die Rolle 'Dealer' mit Rollenanweisung aufgerufen", sampleCalls.length > 0 && sampleCalls[0].input.includes("Zielrolle: Dealer"));
  check("Prompt weist auf Dokumentationslücke für Dealer hin (nicht verschwiegen)", sampleCalls[0].input.includes("Dealer Role vorhanden"));
  const cards = doc.getElementById("manual-chapters-list").innerHTML;
  check("Kapitel-Karte zeigt Rollen-Badge 'Rolle: Dealer'", cards.includes("Rolle: Dealer"));

  // ===================== Releaseletter: Rollenhinweis-Select + Abschnitt in der Vorschau =====================
  const rlRoleSelect = doc.getElementById("releaseletter-role-select");
  check("Rollenhinweis-Select im Releaseletter vorhanden", !!rlRoleSelect);
  check("Rollenhinweis-Select hat 5 Optionen", rlRoleSelect.options.length === 5);
  doc.querySelector('.nav-item[data-view="releaseletter"]').click();
  await wait(50);
  doc.getElementById("releaseletter-use-filtered").checked = false;
  doc.getElementById("releaseletter-keys").value = "ROLE-1";
  rlRoleSelect.value = "alle";
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  let preview = doc.getElementById("releaseletter-preview").textContent;
  check("Ohne Rollenwahl ('Alle'): KEIN Rollenhinweis-Abschnitt", !preview.includes("Rollenhinweis"));

  rlRoleSelect.value = "markt";
  fire(doc.getElementById("releaseletter-generate-btn"), "click");
  await wait(50);
  preview = doc.getElementById("releaseletter-preview").textContent;
  check("Mit Rolle 'Markt': Rollenhinweis-Abschnitt vorhanden", preview.includes("Rollenhinweis (Markt)"));
  check("Rollenhinweis listet ein Markt-Navigationsmodul (Product Management)", preview.includes("Product Management") || preview.includes("Produktverwaltung"));

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE ROLLEN-NAVIGATION-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
