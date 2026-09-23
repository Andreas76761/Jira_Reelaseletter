#!/usr/bin/env node
// Fuehrt alle *_test.js in diesem Verzeichnis aus (jede Datei in einem
// eigenen Node-Prozess, damit sich Tests nicht gegenseitig ueber globalen
// Zustand beeinflussen - JSDOM-Instanz, globale Objekte etc. sind pro
// Prozess isoliert) und fasst das Ergebnis zusammen. Erwartet eine gebaute
// webapp/ticket_cockpit.build.html (siehe README.md -> Tests).
//
// Performance: Die einzelnen Testdateien sind NICHT durch die Anzahl ihrer
// check()-Aufrufe langsam, sondern durch das JSDOM-Boot (Parsen + Ausfuehren
// der grossen ticket_cockpit.build.html) und feste wait()-Sleeps pro Datei -
// das ist unabhaengig von der Check-Zahl ein Fixkosten-Sockel pro Datei.
// Da jede Datei ohnehin in einem eigenen, isolierten Prozess laeuft, ist
// paralleles Ausfuehren gefahrlos moeglich und reduziert die Wanduhrzeit
// der Gesamtsuite deutlich gegenueber rein serieller Ausfuehrung.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const buildHtml = path.join(__dirname, "..", "ticket_cockpit.build.html");
if (!fs.existsSync(buildHtml)) {
  console.error("Fehlt: " + buildHtml);
  console.error("Bitte zuerst bauen: jira-releaseletter build-webapp (im Projekt-Root)");
  process.exit(1);
}

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith("_test.js"))
  .sort();

// Anzahl gleichzeitig laufender Testdateien. Standard: CPU-Kernzahl (min. 2,
// max. 8) - ueberschreibbar via TEST_CONCURRENCY fuer Debugging (z.B. =1 fuer
// rein serielle Ausfuehrung wie frueher, mit unveraendert lesbarer Ausgabe-
// Reihenfolge).
const concurrency = Math.max(1, Math.min(8, Number(process.env.TEST_CONCURRENCY) || Math.max(2, os.cpus().length)));

// Parst die Konsolen-Ausgabe einer Testdatei in einzelne Testcases/Schritte
// ("OK  - <text>" / "FAIL - <text>", das von jeder Testdatei einheitlich
// verwendete Format, siehe check()-Helfer in jeder *_test.js) - das macht
// jeden einzelnen Pruefschritt separat auswertbar/darstellbar, nicht nur das
// Datei-Gesamtergebnis.
function parseChecks(output) {
  const checks = [];
  const lines = output.split("\n");
  const re = /^(OK|FAIL)\s+-\s+(.*)$/;
  lines.forEach((line) => {
    const m = re.exec(line.trim());
    if (m) checks.push({ ok: m[1] === "OK", text: m[2] });
  });
  return checks;
}

function runFile(f) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, f)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      resolve({
        name: f,
        status: code === 0 ? "pass" : "fail",
        durationMs: Date.now() - start,
        checks: parseChecks(out),
        errorOutput: code === 0 ? null : (err.trim() || out.trim()).slice(0, 4000),
      });
    });
  });
}

// Kleiner Worker-Pool statt "alle 49 Dateien gleichzeitig starten" - haelt
// die gleichzeitige JSDOM/Node-Speicherlast auf einem bearbeitbaren Niveau.
async function runAll(fileList) {
  const results = new Array(fileList.length);
  let next = 0;
  async function worker() {
    while (next < fileList.length) {
      const i = next++;
      process.stdout.write("=== " + fileList[i] + " ===\n");
      const r = await runFile(fileList[i]);
      results[i] = r;
      r.checks.forEach((c) => process.stdout.write((c.ok ? "OK  " : "FAIL") + " - " + c.text + "\n"));
      if (r.status === "fail" && r.errorOutput) process.stderr.write(r.errorOutput + "\n");
      process.stdout.write((r.status === "pass" ? "OK" : "FAIL") + " (" + r.durationMs + " ms) - " + fileList[i] + "\n\n");
    }
  }
  const workers = [];
  for (let w = 0; w < concurrency; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const OPTIMIZATIONS = [
  {
    id: "parallel-runner",
    title: "Testdateien laufen parallel statt seriell",
    detail: "run-all.js fuehrte alle *_test.js-Dateien bisher nacheinander in einem einzigen Prozess-Strom aus (Gesamtlaufzeit = Summe aller Einzeldauern, zuletzt ca. 10 Minuten fuer 49 Dateien). Jede Datei startet ohnehin einen eigenen, isolierten Node-Prozess mit eigener JSDOM-Instanz - paralleles Ausfuehren ist daher gefahrlos und reduziert die Wanduhrzeit etwa im Verhaeltnis der Kernzahl."
  },
  {
    id: "jsdom-boot-dominant",
    title: "Laufzeit pro Datei ist JSDOM-Boot-dominiert, nicht Check-Zahl-dominiert",
    detail: "Messung ergab: Dateien mit wenigen Checks (z.B. ticket_graph_views_test.js, 19 Checks) brauchen aehnlich lang wie Dateien mit vielen Checks (z.B. ticket_graph_test.js, 87 Checks) - der Sockel pro Datei ist das Parsen/Ausfuehren der grossen ticket_cockpit.build.html in JSDOM plus feste wait()-Sleeps, nicht die Anzahl der Pruefschritte selbst."
  },
  {
    id: "split-largest-file",
    title: "Größte Testdatei in kleinere Dateien aufgeteilt",
    detail: "ticket_graph_test.js (vorher 409 Zeilen / 87 Checks in einer Datei) wurde entlang bestehender fachlicher Abschnitte in mehrere kleinere Dateien aufgeteilt. Kleinere Dateien liefern frueher Zwischenergebnisse, sind im Testdashboard granularer nachvollziehbar und profitieren staerker von der parallelen Ausfuehrung (mehr, kleinere Einheiten statt weniger, grosser)."
  }
];

(async () => {
  const wallStart = Date.now();
  const results = await runAll(files);
  const wallDurationMs = Date.now() - wallStart;
  const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0);

  const failedFiles = results.filter((r) => r.status === "fail");
  const checksTotal = results.reduce((s, r) => s + r.checks.length, 0);
  const checksPassed = results.reduce((s, r) => s + r.checks.filter((c) => c.ok).length, 0);

  console.log("\n" + (files.length - failedFiles.length) + "/" + files.length + " Testdateien bestanden.");
  console.log("Wanduhrzeit gesamt: " + (wallDurationMs / 1000).toFixed(1) + "s (Summe Einzeldauern: " + (totalDurationMs / 1000).toFixed(1) + "s, Parallelitaet: " + concurrency + ")");

  const report = {
    generatedAt: new Date().toISOString(),
    wallDurationMs,
    totalDurationMs,
    concurrency,
    files: results.map((r) => ({
      name: r.name,
      status: r.status,
      durationMs: r.durationMs,
      checks: r.checks,
      passCount: r.checks.filter((c) => c.ok).length,
      totalCount: r.checks.length,
      errorOutput: r.errorOutput,
    })),
    summary: {
      filesTotal: files.length,
      filesPassed: files.length - failedFiles.length,
      checksTotal,
      checksPassed,
    },
    optimizations: OPTIMIZATIONS,
  };
  fs.writeFileSync(path.join(__dirname, "test-results.json"), JSON.stringify(report, null, 2));
  console.log("Bericht geschrieben: " + path.join(__dirname, "test-results.json"));

  if (failedFiles.length) {
    console.error("FEHLGESCHLAGEN: " + failedFiles.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("ALLE TESTS BESTANDEN.");
})();
