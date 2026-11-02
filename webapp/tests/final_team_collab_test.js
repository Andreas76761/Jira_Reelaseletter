// v2.119.0 Team-Arbeit: zwei gleichzeitige Nutzer (zwei JSDOM-Instanzen)
// teilen sich eine simulierte db (Artifact-Faehigkeit "db": Dokumente,
// Sammlungen, Live-Snapshots, Leases). Geprueft: Stand im Team teilen, live
// beim anderen sichtbar, Bearbeitungssperre (Lease + Hinweis), gemeinsamer
// Status mit Konto-IDs, Kommentare live, Uebernehmen mit/ohne eigene Screens.
const fs = require("fs");
const path = require("path");
const BUILD_HTML = path.join(__dirname, "..", "ticket_cockpit.build.html");
const { JSDOM, VirtualConsole } = require("jsdom");
const JSZipNode = require("jszip");
const { jsPDF } = require("jspdf");

const fragment = fs.readFileSync(BUILD_HTML, "utf-8");
const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;

// ---------- Simulierte db (gemeinsam fuer beide Nutzer) ----------
function createFakeDb() {
  const store = new Map();
  const listeners = new Set();
  const leases = new Map();
  let idc = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const notify = () => setTimeout(() => listeners.forEach((l) => l.fire()), 5);
  const snapDoc = (p) => { const d = store.get(p); return { id: p.split("/").pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  function docRef(p) {
    return {
      id: p.split("/").pop(), path: p,
      get: async () => snapDoc(p),
      set: async (data) => { store.set(p, clone(data)); notify(); },
      update: async (data) => { if (!store.has(p)) throw { code: "invalid_argument", message: "missing" }; store.set(p, Object.assign({}, store.get(p), clone(data))); notify(); },
      delete: async () => { store.delete(p); notify(); },
      acquire: async ({ holder, ttlMs }) => {
        const now = Date.now(), l = leases.get(p);
        if (l && l.expires > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.expires).toISOString() };
        const exp = now + (ttlMs || 30000);
        leases.set(p, { holder, expires: exp });
        return { acquired: true, expiresAt: new Date(exp).toISOString(), holder };
      },
      onSnapshot: (next) => { const l = { fire: () => next(snapDoc(p)) }; listeners.add(l); setTimeout(l.fire, 0); return () => listeners.delete(l); },
      collection: (sub) => coll(p + "/" + sub),
    };
  }
  function query(cp, order, lim) {
    const depth = cp.split("/").length + 1;
    const run = () => {
      let docs = [...store.keys()].filter((k) => k.startsWith(cp + "/") && k.split("/").length === depth).map(snapDoc);
      if (order) docs.sort((a, b) => { const x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.dir === "desc" ? -1 : 1); });
      if (lim) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      where() { return this; },
      orderBy: (f, dir) => query(cp, { f, dir }, lim),
      limit: (n) => query(cp, order, n),
      get: async () => run(),
      onSnapshot: (next) => { const l = { fire: () => next(run()) }; listeners.add(l); setTimeout(l.fire, 0); return () => listeners.delete(l); },
    };
  }
  function coll(cp) {
    return Object.assign(query(cp), { path: cp, doc: (id) => docRef(cp + "/" + (id || "d" + ++idc)), add: async (data) => { const r = docRef(cp + "/d" + ++idc); await r.set(data); return r; } });
  }
  return { api: { doc: docRef, collection: coll }, store, leases };
}
const fakeDb = createFakeDb();
const PEOPLE = { u_anna: "Anna Autorin", u_ben: "Ben Prüfer" };

function makeUser(id, errors) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!String(e.message).match(/jszip|jspdf|tesseract|pdf\.js|pdf\.worker|mermaid/i)) errors.push(id + ": " + e.message); });
  const saved = [];
  const dom = new JSDOM(full, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, url: "https://example.com/" + id, virtualConsole: vc,
    beforeParse(window) {
      window.JSZip = JSZipNode;
      window.jspdf = { jsPDF: jsPDF };
      const user = {
        me: () => Promise.resolve({ id, name: PEOPLE[id], avatarUrl: "data:,", color: "#000", email: null, isOwner: id === "u_anna", canEdit: true }),
        profiles: (ids) => Promise.resolve(Object.fromEntries([].concat(ids).map((x) => [x, { id: x, name: PEOPLE[x] || "", avatarUrl: "data:,", color: "#000", email: null, isMe: x === id, guest: false }]))),
      };
      window.claude = {
        use: function (name) {
          if (name === "downloads") return Promise.resolve({ save: (req) => { saved.push(req); return Promise.resolve({ status: "saved" }); } });
          if (name === "user") return Promise.resolve(user);
          if (name === "db") return Promise.resolve(fakeDb.api);
          return Promise.resolve(null);
        },
      };
    },
  });
  return dom;
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(fn, timeoutMs) { const start = Date.now(); while (Date.now() - start < timeoutMs) { if (fn()) return true; await wait(20); } return false; }
const PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "fixtures", "red_square_dataurl.txt"), "utf-8").trim().split(",")[1], "base64");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
async function buildDocx(bodyXml, images) {
  const zip = new JSZipNode();
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + "><w:body>" + bodyXml + "<w:sectPr/></w:body></w:document>");
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= (images || 0); i++) { rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + i + '.png"/>'; zip.file("word/media/image" + i + ".png", PNG); }
  zip.file("word/_rels/document.xml.rels", rels + "</Relationships>");
  return zip.generateAsync({ type: "nodebuffer" });
}
const heading = (t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + esc(t) + "</w:t></w:r></w:p>";
const para = (t) => "<w:p><w:r><w:t>" + esc(t) + "</w:t></w:r></w:p>";
const img = (rId) => '<w:p><w:r><w:drawing><a:blip r:embed="' + rId + '"/></w:drawing></w:r></w:p>';

(async () => {
  const errors = [];
  const A = makeUser("u_anna", errors), B = makeUser("u_ben", errors);
  await wait(700);
  const checks = [];
  function check(l, ok) { checks.push([l, ok]); console.log((ok ? "OK  " : "FAIL") + " - " + l); }
  const d = (dom) => dom.window.document;
  const fire = (dom, el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  const nav = (dom, v) => d(dom).querySelector('.nav-item[data-view="' + v + '"]').click();
  const teamRows = (dom) => Array.from(d(dom).querySelectorAll("#final-team-tbody tr"));
  const toast = (dom) => d(dom).getElementById("toast").textContent;
  async function upload(dom, inputId, buf, name) {
    const input = d(dom).getElementById(inputId);
    Object.defineProperty(input, "files", { value: [new dom.window.File([buf], name, { type: "application/octet-stream" })], configurable: true });
    fire(dom, input, "change");
  }
  nav(A, "final"); nav(B, "final");
  await waitUntil(() => d(A).getElementById("final-team-status-note").textContent.includes("Live verbunden") && d(B).getElementById("final-team-status-note").textContent.includes("Angemeldet als Ben Prüfer"), 5000);
  check("Team-Bereich bei beiden live verbunden", d(A).getElementById("final-team-status-note").textContent.includes("Live verbunden") && d(B).getElementById("final-team-status-note").textContent.includes("Angemeldet als Ben Prüfer"));

  // ===================== Anna: Stand bauen und teilen =====================
  await upload(A, "final-manual-file-input", await buildDocx(heading("Kapitel 1: Verträge") + para("Verträge werden online geändert.") + heading("Kapitel 2: Kündigung") + para("Kündigungen werden erfasst.")), "handbuch.docx");
  await waitUntil(() => d(A).getElementById("final-manuals-tbody").children.length === 1, 5000);
  await upload(A, "final-screens-file-input", await buildDocx(img("rId1") + para("V > Übersicht"), 1), "screens.docx");
  await waitUntil(() => d(A).querySelectorAll("#final-screens-tbody tr").length === 1, 5000);
  const sSel = d(A).querySelector("#final-screens-tbody tr select"); sSel.value = "Kapitel 1: Verträge"; fire(A, sSel, "change");
  d(A).getElementById("final-build-name-input").value = "Release 1";
  fire(A, d(A).getElementById("final-build-master-btn"), "click");
  await waitUntil(() => d(A).getElementById("final-build-master-status-note").textContent.includes("Release 1"), 10000);
  const shareBtn = d(A).querySelector("[data-final-version-share]");
  check("Anna: Button 'Im Team teilen' am lokalen Stand", !!shareBtn && shareBtn.textContent === "Im Team teilen");
  fire(A, shareBtn, "click");
  await waitUntil(() => teamRows(A).length === 1 && teamRows(B).length === 1, 3000);
  check("Geteilter Stand erscheint live bei Anna und Ben", teamRows(A).length === 1 && teamRows(B).length === 1);
  const stored = [...fakeDb.store.values()][0];
  check("Team-Dokument ohne Bilddaten, Screens als Bildunterschrift, nur Konto-IDs", !JSON.stringify(stored).includes("data:image") && stored.chapters[0].screens[0].caption === "V > Übersicht" && stored.sharedById === "u_anna" && !JSON.stringify(stored).includes("Anna Autorin"));
  await waitUntil(() => teamRows(B)[0].textContent.includes("Anna Autorin"), 2000);
  check("Ben sieht 'geteilt von Anna Autorin' (über Konto-ID aufgelöst)", teamRows(B)[0].children[1].textContent.includes("Anna Autorin"));
  check("Anna: lokaler Stand als 'im Team geteilt' markiert, Button 'Team-Stand aktualisieren'", d(A).querySelector("#final-versions-tbody").textContent.includes("im Team geteilt") && d(A).querySelector("[data-final-version-share]").textContent === "Team-Stand aktualisieren");

  // ===================== Ben: Bearbeitung uebernehmen (Sperre) =====================
  fire(B, teamRows(B)[0].querySelector("[data-team-lock]"), "click");
  await waitUntil(() => teamRows(A)[0] && teamRows(A)[0].querySelector(".final-team-col-lock").textContent.includes("wird bearbeitet von"), 3000);
  check("Ben: 'von dir in Bearbeitung'", teamRows(B)[0].querySelector(".final-team-col-lock").textContent.includes("von dir in Bearbeitung"));
  await waitUntil(() => teamRows(A)[0].querySelector(".final-team-col-lock").textContent.includes("Ben Prüfer"), 2000);
  check("Anna sieht 'wird bearbeitet von Ben Prüfer', Status-Auswahl gesperrt", teamRows(A)[0].querySelector(".final-team-col-lock").textContent.includes("Ben Prüfer") && teamRows(A)[0].querySelector("[data-team-status]").disabled);
  check("Ben hat den Stand als lokalen, aktiven Stand (aus dem Team)", d(B).querySelector("#final-versions-tbody .final-version-active") && d(B).querySelector("#final-versions-tbody").textContent.includes("Release 1"));
  fire(A, teamRows(A)[0].querySelector("[data-team-lock]"), "click");
  await waitUntil(() => toast(A).includes("Jemand anderes bearbeitet"), 2000);
  check("Anna kann die Sperre nicht übernehmen", toast(A).includes("Jemand anderes bearbeitet"));
  fire(A, d(A).querySelector("[data-final-version-share]"), "click");
  await waitUntil(() => toast(A).includes("Gesperrt"), 2000);
  check("Anna kann den gesperrten Team-Stand nicht überschreiben", toast(A).includes("Gesperrt"));

  // ===================== Gemeinsamer Status =====================
  const bSel = teamRows(B)[0].querySelector("[data-team-status]");
  bSel.value = "Geprüft"; fire(B, bSel, "change");
  await waitUntil(() => teamRows(A)[0] && teamRows(A)[0].querySelector(".final-status-pill").textContent === "Geprüft", 3000);
  await waitUntil(() => teamRows(A)[0].textContent.includes("von Ben Prüfer"), 2000);
  check("Bens Status 'Geprüft' live bei Anna, mit 'von Ben Prüfer'", teamRows(A)[0].querySelector(".final-status-pill").textContent === "Geprüft" && teamRows(A)[0].textContent.includes("von Ben Prüfer"));
  check("Status-Historie mit Konto-ID im Team-Dokument", [...fakeDb.store.values()][0].history.some((h) => h.status === "Geprüft" && h.byId === "u_ben"));

  // ===================== Kommentare =====================
  fire(B, teamRows(B)[0].querySelector("[data-team-comments]"), "click");
  d(B).getElementById("final-team-comment-input").value = "Kapitel 2 bitte noch prüfen.";
  fire(B, d(B).getElementById("final-team-comment-send-btn"), "click");
  fire(A, teamRows(A)[0].querySelector("[data-team-comments]"), "click");
  await waitUntil(() => d(A).getElementById("final-team-comments-list").textContent.includes("Kapitel 2 bitte noch prüfen."), 3000);
  await waitUntil(() => d(A).getElementById("final-team-comments-list").textContent.includes("Ben Prüfer"), 2000);
  check("Anna sieht Bens Kommentar live (mit Namen)", d(A).getElementById("final-team-comments-list").textContent.includes("Ben Prüfer"));
  d(A).getElementById("final-team-comment-input").value = "Erledigt.";
  fire(A, d(A).getElementById("final-team-comment-send-btn"), "click");
  await waitUntil(() => d(B).getElementById("final-team-comments-list").textContent.includes("Erledigt."), 3000);
  check("Ben sieht Annas Antwort live, Reihenfolge stimmt", /bitte noch prüfen[\s\S]*Erledigt\./.test(d(B).getElementById("final-team-comments-list").textContent) && d(B).getElementById("final-team-comments-title").textContent.includes("(2)"));

  // ===================== Ben beendet, Lease laeuft ab =====================
  fire(B, teamRows(B)[0].querySelector("[data-team-unlock]"), "click");
  await waitUntil(() => teamRows(A)[0] && teamRows(A)[0].querySelector(".final-team-col-lock").textContent === "frei", 3000);
  check("Nach 'Bearbeitung beenden': bei Anna 'frei'", teamRows(A)[0].querySelector(".final-team-col-lock").textContent === "frei");
  fire(A, teamRows(A)[0].querySelector("[data-team-lock]"), "click");
  await waitUntil(() => toast(A).includes("frei frühestens ab"), 2000);
  check("Lease noch aktiv: Anna bekommt 'frei frühestens ab …'", toast(A).includes("frei frühestens ab"));
  fakeDb.leases.forEach((l) => { l.expires = Date.now() - 1; });
  fire(A, teamRows(A)[0].querySelector("[data-team-lock]"), "click");
  await waitUntil(() => teamRows(B)[0] && teamRows(B)[0].querySelector(".final-team-col-lock").textContent.includes("Anna Autorin"), 3000);
  check("Nach Ablauf übernimmt Anna; Ben sieht 'wird bearbeitet von Anna Autorin'", teamRows(B)[0].querySelector(".final-team-col-lock").textContent.includes("Anna Autorin"));
  fire(A, d(A).querySelector("[data-final-version-share]"), "click");
  await waitUntil(() => toast(A).includes("aktualisiert"), 2000);
  check("Anna (mit Sperre) kann den Team-Stand aktualisieren", toast(A).includes("aktualisiert"));
  await wait(100);
  check("Aktualisieren überschreibt den Team-Status nicht (bleibt 'Geprüft')", [...fakeDb.store.values()].find((x) => x.name === "Release 1").status === "Geprüft");
  check("Annas verknüpfter lokaler Stand hat den Team-Status übernommen", Array.from(d(A).querySelectorAll("#final-versions-tbody tr")).some((r) => r.textContent.includes("im Team geteilt") && r.querySelector(".final-status-pill").textContent === "Geprüft"));
  fire(A, teamRows(A)[0].querySelector("[data-team-unlock]"), "click");
  await wait(100);

  // ===================== Uebernehmen ohne eigene Screens =====================
  const bLocal = () => Array.from(d(B).querySelectorAll("#final-versions-tbody tr"));
  fire(B, teamRows(B)[0].querySelector("[data-team-import]"), "click");
  await wait(100);
  const resSel = d(B).getElementById("final-result-chapter-select");
  resSel.value = "Kapitel 1: Verträge"; fire(B, resSel, "change");
  check("Ben (ohne Bilddaten): Screen als '(Screen: …)' übernommen", d(B).getElementById("final-result-master-output").textContent.includes("(Screen: V > Übersicht)") && bLocal().length >= 2);
  check("Übernommener Stand trägt den Team-Status 'Geprüft'", bLocal()[bLocal().length - 1].querySelector(".final-status-pill").textContent === "Geprüft");

  if (errors.length) { console.error("\nJS-Fehler:", errors); checks.push(["keine Fehler", false]); }
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " bestanden");
  if (failed.length) { console.log("FEHLGESCHLAGEN:", failed.map((f) => f[0])); process.exit(1); }
  console.log("ALLE TEAM-ARBEIT-TESTS BESTANDEN");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
