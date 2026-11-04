// v2.140.0 VARIANTE Dokument-Review: Dateien je Version in der Ablage aufbewahren (Word, PDF, Reviewbericht –
// erneut herunterladen aus dem damaligen Stand), PDF fuer die Verteilung, Uebernahme als Stand nach FINAL,
// freigegebene Dokumente im Release-Paket.
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
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const H = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + t + "</w:t></w:r></w:p>";
const P = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + "</w:t></w:r></w:p>";
const SECRET = "Nur intern 9911";
async function draft() {
  const z = new JSZipNode();
  const body = H("1 Anmeldung") + P("Die Anmeldung erfolgt über das Portal (ONESCM-7).") +
    '<w:p><w:r><w:t xml:space="preserve">Danach öffnet sich die Startseite. </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>' + SECRET + '</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Feld</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Wert</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    H("2 Abmeldung") + P("Die Abmeldung ist **jederzeit** möglich.");
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + "><w:body>" + body + "<w:sectPr/></w:body></w:document>");
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return z.generateAsync({ type: "nodebuffer" });
}
async function wordText(data) {
  const z = await JSZipNode.loadAsync(Buffer.from(await data.arrayBuffer()));
  return [...(await z.file("word/document.xml").async("string")).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("\n");
}

(async () => {
  await wait(500);
  const doc = dom.window.document, win = dom.window;
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const $ = (id) => doc.getElementById(id);
  const nav = (v) => doc.querySelector('.nav-item[data-view="' + v + '"]').click();
  const rows = () => Array.from(doc.querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]"));
  const gotoStage = (n) => $("vrev-stepper").querySelector('[data-stage="' + n + '"]').click();
  async function click(a) {
    savedFiles.length = 0;
    $("vrev-stage").querySelector('[data-vrev-act="' + a + '"]').click();
    await waitUntil(() => savedFiles.length === 1, 10000);
    await wait(30);
    return savedFiles[0];
  }

  nav("variante"); await wait(30);
  check("Release-Paket: Option für Review-Dokumente (0)", !!$("paket-inc-review") && $("paket-review-count").textContent === "0");
  const inp = $("vrev-file-input");
  Object.defineProperty(inp, "files", { value: [new win.File([await draft()], "Handbuch.docx")], configurable: true });
  fire(inp, "change");
  await waitUntil(() => rows().length === 1, 8000);
  check("Ablage: Spalte Dateien, noch 0", rows()[0].children[7].textContent.startsWith("0"));

  gotoStage(7); await wait(20);
  check("Stufe 7: PDF und Übernahme nach FINAL angeboten", !!$("vrev-stage").querySelector('[data-vrev-act="pdf-dist"]') && $("vrev-stage").querySelector('[data-vrev-act="to-final"]').textContent === "Als Stand nach FINAL übernehmen");
  const wd = await click("word-dist");
  const wdText = await wordText(wd.data);
  const pdf = await click("pdf-dist");
  check("PDF für die Verteilung heruntergeladen", /^Handbuch_v1\.0_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.filename) && pdf.data.size > 1000);
  const pdfBuf = Buffer.from(await pdf.data.arrayBuffer()).toString("latin1");
  check("PDF: beginnt als PDF, ohne internen Kommentar und ohne Jira-Nummer", pdfBuf.startsWith("%PDF") && !pdfBuf.includes(SECRET) && !pdfBuf.includes("ONESCM-7"));
  savedFiles.length = 0;
  $("vrev-report-md-btn").click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  await wait(30);
  check("Ablage: 3 Dateien aufbewahrt", rows()[0].children[7].textContent.startsWith("3"));
  rows()[0].children[7].querySelector("button").click(); await wait(20);
  const fileRows = Array.from(doc.querySelectorAll("[data-vrev-files] tbody tr"));
  check("Dateiliste: Reviewbericht, PDF, Word (neueste zuerst) mit Version/Status", fileRows.length === 3 && fileRows[0].children[1].textContent === "Reviewbericht" && fileRows[1].children[1].textContent === "PDF Verteilung" &&
    fileRows[2].children[1].textContent === "Word Verteilung" && fileRows[2].children[3].textContent.startsWith("v1.0 · In Review"));

  // Text aendern, dann altes Word erneut herunterladen
  $("vrev-text-chapter").value = "0"; fire($("vrev-text-chapter"), "change");
  $("vrev-text-edit").value = $("vrev-text-edit").value.replace("über das Portal", "über die App");
  $("vrev-text-save-btn").click(); await wait(1100); // Uhrzeit auf dem Deckblatt muss trotzdem die alte bleiben
  savedFiles.length = 0;
  Array.from(doc.querySelectorAll("[data-vrev-files] tbody tr"))[2].querySelector('[data-vrev-act="file-dl"]').click();
  await waitUntil(() => savedFiles.length === 1, 8000);
  const re = await wordText(savedFiles[0].data);
  check("Erneuter Download liefert den damaligen Stand (Portal, nicht App)", savedFiles[0].filename === wd.filename && re.includes("über das Portal") && !re.includes("über die App") && re === wdText);
  savedFiles.length = 0;
  Array.from(doc.querySelectorAll("[data-vrev-files] tbody tr"))[0].querySelector('[data-vrev-act="file-dl"]').click();
  await waitUntil(() => savedFiles.length === 1, 5000);
  check("Reviewbericht erneut herunterladen (aufbewahrter Text)", (await savedFiles[0].data.text()).startsWith("# Reviewbericht – Handbuch"));

  // Stand nach FINAL
  gotoStage(7); await wait(20);
  $("vrev-stage").querySelector('[data-vrev-act="to-final"]').click(); await wait(30);
  check("Als Stand nach FINAL übernommen (Hinweis und Knopf „Erneut …“)", $("vrev-stage").textContent.includes("In FINAL als Stand „Handbuch v1.0 (Review)“ (Entwurf)") && $("vrev-stage").querySelector('[data-vrev-act="to-final"]').textContent === "Erneut als Stand nach FINAL");
  nav("final"); await wait(30);
  const vRow = Array.from(doc.querySelectorAll("#final-versions-tbody tr")).find((r) => r.textContent.includes("Handbuch v1.0 (Review)"));
  check("FINAL: Stand in der Liste (2 Kapitel)", !!vRow && vRow.children[3].textContent.startsWith("2 /"));
  savedFiles.length = 0;
  fire($("session-export-btn"), "click");
  await waitUntil(() => savedFiles.length > 0, 5000);
  let sess = JSON.parse(savedFiles[0].data);
  const fv = sess.final.versions.find((v) => v.name === "Handbuch v1.0 (Review)");
  check("FINAL-Stand: Verteilfassung (App-Text, Tabelle als Zeile, ohne Jira/Kommentar/**)", fv && fv.origin === "Review" && fv.chapters[0].text.includes("über die App") && fv.chapters[0].text.includes("Feld | Wert") &&
    !fv.chapters[0].text.includes("ONESCM-7") && !fv.chapters[0].text.includes(SECRET) && fv.chapters[1].text.includes("jederzeit") && !fv.chapters[1].text.includes("**"));
  check("Sitzung: Dateien je Dokument gespeichert", sess.vrev.docs[0].files.length === 3 && sess.vrev.docs[0].files[0].kind === "Word Verteilung" && sess.vrev.docs[0].snaps[sess.vrev.docs[0].files[0].snapKey].chapters[0].text.includes("über das Portal") && Object.keys(sess.vrev.docs[0].snaps).length === 1);
  nav("variante"); await wait(30);

  // Release-Paket
  const sel = rows()[0].querySelector("[data-vrev-status]"); sel.value = "Freigegeben"; fire(sel, "change"); await wait(20);
  check("Release-Paket zählt freigegebene Dokumente (1)", $("paket-review-count").textContent === "1");
  $("paket-group").value = "type"; fire($("paket-group"), "change");
  $("paket-preview-btn").click(); await wait(20);
  const plan = Array.from(doc.querySelectorAll("#paket-list-tbody tr")).map((r) => r.textContent);
  check("Paket-Inhalt: Dokument im Ordner Dokumente mit Version/Status und Hinweis auf offene Stufen", plan.some((t) => /^Dokumente\/.*_Handbuch_v1\.0\.docxDokument \(Review\)/.test(t) && t.includes("v1.0 · Freigegeben")) && $("paket-status").textContent.includes("nur 0 von 7 Review-Stufen"));
  savedFiles.length = 0;
  $("paket-build-btn").click();
  await waitUntil(() => savedFiles.length === 1, 10000);
  const zip = await JSZipNode.loadAsync(Buffer.from(await savedFiles[0].data.arrayBuffer()));
  const entry = Object.keys(zip.files).find((f) => /^Dokumente\/.*_Handbuch_v1\.0\.docx$/.test(f));
  check("Paket-ZIP enthält das Word (Verteilfassung, aktueller Stand)", !!entry && (await wordText(new win.Blob([await zip.file(entry).async("uint8array")]))).includes("über die App"));
  $("paket-inc-review").checked = false; fire($("paket-inc-review"), "change"); await wait(20);
  check("Option abwählbar", !Array.from(doc.querySelectorAll("#paket-list-tbody tr")).some((r) => r.textContent.includes("Dokument (Review)")));

  // Neue Version: ohne Dateien
  rows()[0].querySelector('[data-vrev-act="new-version"]').click(); await wait(30);
  check("Neue Version startet ohne abgelegte Dateien und ohne FINAL-Verknüpfung", rows()[1].children[7].textContent.startsWith("0"));

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
