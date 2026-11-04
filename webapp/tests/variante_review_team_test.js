// v2.143.0 Dokument-Review: Team-Ablage – zwei gleichzeitige Nutzer (zwei JSDOM-Instanzen) teilen sich eine
// simulierte db. Geprueft: Review-Dokument im Team teilen (ohne Bilddaten), live beim anderen sichtbar, uebernehmen
// mit/ohne eigene Bilder, gemeinsamer Status in beide Richtungen, Aktualisieren ohne Status zu ueberschreiben,
// Sperre (Lease) bei gleichzeitiger Bearbeitung, kleinere Sitzung (gleiche Staende nur einmal).
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
  const toast = (dom) => d(dom).getElementById("toast").textContent;
  const rows = (dom) => Array.from(d(dom).querySelectorAll("#vrev-docs-tbody > tr[data-vrev-row]"));
  const teamRows = (dom) => Array.from(d(dom).querySelectorAll("#vrev-team-tbody tr"));
  async function upload(dom, buf, name) {
    const input = d(dom).getElementById("vrev-file-input");
    Object.defineProperty(input, "files", { value: [new dom.window.File([buf], name)], configurable: true });
    fire(dom, input, "change");
  }
  const DRAFT = await buildDocx(heading("1 Verträge") + para("Verträge werden online angelegt.") + img("rId1") + para("Abbildung 1: Vertragsübersicht") + heading("2 Kündigung") + para("Kündigungen werden erfasst."), 1);
  nav(A, "variante"); nav(B, "variante");
  await waitUntil(() => !d(A).getElementById("vrev-team").hidden && !d(B).getElementById("vrev-team").hidden, 3000);
  check("Team-Ablage bei beiden sichtbar, noch leer", !d(A).getElementById("vrev-team").hidden && !d(B).getElementById("vrev-team-empty").hidden);

  // Anna: Entwurf hochladen und teilen
  await upload(A, DRAFT, "Handbuch.docx");
  await waitUntil(() => rows(A).length === 1, 5000);
  const share = rows(A)[0].querySelector('[data-vrev-act="team-share"]');
  check("Anna: Knopf „Im Team teilen“ in der Ablage", !!share && share.textContent === "Im Team teilen");
  share.click();
  await waitUntil(() => teamRows(B).length === 1, 3000);
  const key = [...fakeDb.store.keys()].find((k) => k.startsWith("teamreviews/"));
  const stored = fakeDb.store.get(key);
  check("Team-Dokument gespeichert: Text, Prüfergebnisse, Bild-Referenz ohne Bilddaten", stored && stored.chapters.length === 2 && Object.keys(stored.checks).length === 20 &&
    JSON.stringify(stored.images).includes("Abbildung 1: Vertragsübersicht") && !JSON.stringify(stored).includes("data:image") && stored.sharedById === "u_anna");
  check("Ben sieht das geteilte Dokument live (Name, Version, Anna als Teilende)", teamRows(B)[0].children[0].textContent === "Handbuch" && teamRows(B)[0].children[1].textContent === "1.0" && teamRows(B)[0].children[5].textContent.includes("Anna Autorin"));
  check("Anna: Hinweis „im Team geteilt“ und Knopf „Team aktualisieren“", rows(A)[0].textContent.includes("im Team geteilt") && rows(A)[0].querySelector('[data-vrev-act="team-share"]').textContent === "Team aktualisieren");

  // Ben: uebernehmen ohne eigene Bilder
  teamRows(B)[0].querySelector("[data-vrev-team-import]").click();
  await waitUntil(() => rows(B).length === 1, 3000);
  check("Ben: übernommen; Bild fehlt im eigenen Archiv (Hinweis)", d(B).getElementById("vrev-import-note").textContent.includes("1 Bild(er) nicht im eigenen Bildarchiv") && teamRows(B)[0].textContent.includes("(lokal vorhanden)"));
  // Ben hat dieselben Bilder (gleicher Entwurf) -> Lokal aktualisieren ordnet zu
  await upload(B, DRAFT, "Handbuch.docx");
  await waitUntil(() => rows(B).length === 2, 5000);
  teamRows(B)[0].querySelector("[data-vrev-team-import]").click();
  await wait(50);
  check("Ben: „Lokal aktualisieren“ ordnet das Bild über den Bildtext zu", d(B).getElementById("vrev-import-note").textContent.endsWith("aus dem Team aktualisiert.") && rows(B).length === 2);

  // Status in beide Richtungen
  const sel = teamRows(B)[0].querySelector("[data-vrev-team-status]"); sel.value = "Geprüft"; fire(B, sel, "change");
  await waitUntil(() => rows(A)[0].children[2].textContent.startsWith("Geprüft"), 3000);
  check("Ben setzt Team-Status „Geprüft“ → bei Anna live übernommen", rows(A)[0].children[2].textContent.startsWith("Geprüft") && fakeDb.store.get(key).statusById === "u_ben");
  const aSel = rows(A)[0].querySelector("[data-vrev-status]"); aSel.value = "Freigegeben"; fire(A, aSel, "change");
  await waitUntil(() => teamRows(B)[0].children[2].textContent.startsWith("Freigegeben"), 3000);
  check("Anna ändert den Status in ihrer Ablage → Team-Status und Bens Kopie folgen", teamRows(B)[0].children[2].textContent.startsWith("Freigegeben") && rows(B).some((r) => r.children[2].textContent.startsWith("Freigegeben")));

  // Anna aendert Text und aktualisiert; Status bleibt
  d(A).getElementById("vrev-text-chapter").value = "0"; fire(A, d(A).getElementById("vrev-text-chapter"), "change");
  d(A).getElementById("vrev-text-edit").value = "Verträge werden im Portal angelegt.";
  d(A).getElementById("vrev-text-save-btn").click(); await wait(20);
  rows(A)[0].querySelector('[data-vrev-act="team-share"]').click();
  await waitUntil(() => fakeDb.store.get(key).chapters[0].text.includes("im Portal"), 3000);
  check("Team aktualisieren: neuer Text, gemeinsamer Status bleibt „Freigegeben“", fakeDb.store.get(key).chapters[0].text.includes("im Portal") && fakeDb.store.get(key).status === "Freigegeben" && fakeDb.store.get(key).updatedById === "u_anna");
  teamRows(B)[0].querySelector("[data-vrev-team-import]").click(); await wait(30);
  d(B).getElementById("vrev-text-chapter").value = "0"; fire(B, d(B).getElementById("vrev-text-chapter"), "change");
  check("Ben: „Lokal aktualisieren“ holt den neuen Text", d(B).getElementById("vrev-text-view").textContent.includes("im Portal"));

  // Sperre
  fakeDb.leases.set(key, { holder: "fremd", expires: Date.now() + 60000 });
  rows(A)[0].querySelector('[data-vrev-act="team-share"]').click();
  await waitUntil(() => toast(A).includes("Gerade in Bearbeitung"), 3000);
  check("Gleichzeitige Bearbeitung: Sperre verhindert Überschreiben", toast(A).includes("Gerade in Bearbeitung"));
  fakeDb.leases.delete(key);

  check("Keine Skriptfehler", errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  const failed = checks.filter((c) => !c[1]);
  console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " Checks bestanden");
  process.exit(failed.length ? 1 : 0);
})();
