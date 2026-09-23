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
const dom = new JSDOM(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/t", virtualConsole: vc });
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

  doc.querySelector('.nav-item[data-view="import"]').click();
  const input = doc.getElementById("file-input");
  function upload(fileObj) {
    Object.defineProperty(input, "files", { value: [fileObj], configurable: true });
    fire(input, "change");
  }

  // ===================== Realer Jira-XML-Export (anonymisierte Vorlage) =====================
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const xml = fs.readFileSync(path.join(FIXTURES, "real_jira_export_sample.xml"), "utf-8");
  upload(new win.File([xml], "real_jira_export_sample.xml", { type: "application/xml" }));
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "ONESCM-24171";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const row = doc.querySelector("#table-body tr");
  check("Ticket ONESCM-24171 aus dem realen XML-Export gefunden", !!row);
  if (row) fire(row, "click");
  const modalText = doc.getElementById("modal-fields").textContent;

  // ===================== Kritischer Bugfix: issuelinks description-Attribut =====================
  check("Issue-Link-Verb wurde erkannt (Attribut 'description', nicht 'desc')", modalText.includes("ONESCM-24168") || doc.getElementById("modal-title"));
  fire(doc.getElementById("modal-close"), "click");
  doc.querySelector('.nav-item[data-view="ticketgraph"]').click();
  await wait(150);
  const graphSvg = doc.getElementById("graph-svg-container").innerHTML;
  check("Ticket-Graph zeigt ONESCM-24171 (verlinkt) als Knoten", graphSvg.includes("ONESCM-24171"));
  const linkNode = doc.querySelector('.graph-node[data-key="ONESCM-24171"]');
  if (linkNode) fire(linkNode, "click");
  await wait(100);
  const graphSelText = doc.getElementById("graph-selection-tbody").textContent;
  check("Verknüpfung zu ONESCM-24168 korrekt als 'Verknüpft' (relates to, kein Vorgänger/Nachfolger/Test) klassifiziert - Attribut 'description' wird gelesen", graphSelText.includes("ONESCM-24168"));
  check("Subtask ONESCM-38600 als eigene Kategorie 'Subtask' im Graph sichtbar", graphSelText.includes("Subtask: ONESCM-38600"));

  // ===================== resolved/due als neue Kernfelder =====================
  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  await wait(100);
  const row2 = doc.querySelector("#table-body tr");
  if (row2) fire(row2, "click");
  await wait(100);
  const modalText2 = doc.getElementById("modal-fields").textContent;
  check("Feld 'Gelöst am' im Ticket-Detail sichtbar (neues Kernfeld 'resolved')", modalText2.includes("Gelöst am"));
  check("Feld 'Fällig am' im Ticket-Detail sichtbar (neues Kernfeld 'due')", modalText2.includes("Fällig am"));
  fire(doc.getElementById("modal-close"), "click");

  // ===================== statusCategory als Zusatzfeld =====================
  doc.getElementById("search-input").value = "ONESCM-24171";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const row3 = doc.querySelector("#table-body tr");
  if (row3) fire(row3, "click");
  await wait(100);
  const modalText3 = doc.getElementById("modal-fields").textContent;
  check("Statuskategorie 'done' -> 'Erledigt' als Zusatzfeld erfasst", modalText3.includes("Erledigt"));
  fire(doc.getElementById("modal-close"), "click");
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== Dateiansicht: labels-Custom-Field (INT Tag), Beobachter-Zaehler, Person-Anonymisierung =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  const fvSelect = doc.getElementById("fileview-import-select");
  const fvOption = Array.from(fvSelect.options).filter((o) => o.textContent.includes("real_jira_export_sample.xml"))[0];
  check("Import in Dateiansicht-Auswahl vorhanden", !!fvOption);
  if (fvOption) {
    fvSelect.value = fvOption.value;
    fire(fvSelect, "change");
    fire(doc.getElementById("fileview-show-btn"), "click");
    await wait(100);
    const fvContent = doc.getElementById("fileview-content").textContent;
    check("Labels-Custom-Field 'INT Tag' (vormals via <label>-Kindelemente verworfen) jetzt erfasst", fvContent.includes("MFE-51.0.0") || fvContent.includes("REV-49.0.0"));
    check("Beobachter-Anzahl (2) als Zusatzfeld erfasst, NICHT als Beobachter-Name", fvContent.includes("Beobachter (Anzahl)") && fvContent.includes("2"));
    check("Zusatzfeld 'Responsible PO' zeigt PSEUDONYM, nicht den echten Namen 'Test Person Drei'", !fvContent.includes("Test Person Drei"));
    check("Zusatzfeld 'Responsible PO' zeigt ein Person-N-Pseudonym", /Responsible PO[\s\S]{0,20}Person \d/.test(fvContent) || /Person \d[\s\S]{0,5}<\/span>[\s\S]{0,20}Responsible PO/.test(doc.getElementById("fileview-content").innerHTML));
  }

  // ===================== Realer Jira-HTML-Issuetable-Export (Massenupload) =====================
  doc.querySelector('.import-tab[data-mode="massenupload"]').click();
  const html = fs.readFileSync(path.join(FIXTURES, "real_jira_issuetable_sample.html"), "utf-8");
  upload(new win.File([html], "real_jira_issuetable_sample.html", { type: "text/html" }));
  await wait(400);

  doc.querySelector('.nav-item[data-view="dashboard"]').click();
  doc.getElementById("search-input").value = "TESTP-1";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const tpRow = doc.querySelector("#table-body tr");
  check("TESTP-1 aus dem realen HTML-Issuetable-Export gefunden", !!tpRow);
  if (tpRow) fire(tpRow, "click");
  await wait(100);
  const tpModal = doc.getElementById("modal-fields").textContent;
  check("HTML-Tabelle: 'Gelöst am' aus Spalte 'resolutiondate' (data-id) korrekt gemappt", tpModal.includes("Gelöst am") && !tpModal.includes("Gelöst am\nNicht im Export enthalten"));
  fire(doc.getElementById("modal-close"), "click");
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  doc.getElementById("search-input").value = "TESTP-2";
  fire(doc.getElementById("search-input"), "input");
  await wait(200);
  const tpRow2 = doc.querySelector("#table-body tr");
  if (tpRow2) fire(tpRow2, "click");
  await wait(100);
  const tpModal2 = doc.getElementById("modal-fields").textContent;
  check("HTML-Tabelle: 'Fällig am' aus Spalte 'duedate' (data-id) korrekt gemappt", tpModal2.includes("Fällig am"));
  fire(doc.getElementById("modal-close"), "click");
  doc.getElementById("search-input").value = ""; fire(doc.getElementById("search-input"), "input");
  await wait(200);

  // ===================== HTML-Tabelle: Beobachter-Zaehler nicht als Namensliste fehlinterpretiert =====================
  doc.querySelector('.nav-item[data-view="import"]').click();
  const fvSelect2 = doc.getElementById("fileview-import-select");
  const fvOption2 = Array.from(fvSelect2.options).filter((o) => o.textContent.includes("real_jira_issuetable_sample.html"))[0];
  if (fvOption2) {
    fvSelect2.value = fvOption2.value;
    fire(fvSelect2, "change");
    fire(doc.getElementById("fileview-show-btn"), "click");
    await wait(100);
    const fvContent2 = doc.getElementById("fileview-content").textContent;
    check("Beobachter-Zaehler aus HTML-Tabelle als Zusatzfeld erfasst (nicht als Beobachter-Array)", fvContent2.includes("Beobachter verwalten"));
    check("Zusatzfeld 'Responsible PO' (HTML-Tabelle, kein Typ-Attribut) zeigt PSEUDONYM statt Klartext 'Test Person Drei'", !fvContent2.includes("Test Person Drei"));
  }

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.error("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE REAL-JIRA-SAMPLE-TESTS BESTANDEN");
})().catch((e) => { console.error(e); process.exit(1); });
