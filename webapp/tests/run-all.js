#!/usr/bin/env node
// Fuehrt alle *_test.js in diesem Verzeichnis nacheinander aus (jeder Datei
// eigener Node-Prozess, damit sich Tests nicht gegenseitig ueber globalen
// Zustand beeinflussen) und fasst das Ergebnis zusammen. Erwartet eine
// gebaute webapp/ticket_cockpit.build.html (siehe README.md -> Tests).
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const buildHtml = path.join(__dirname, "..", "ticket_cockpit.build.html");
if (!fs.existsSync(buildHtml)) {
  console.error("Fehlt: " + buildHtml);
  console.error("Bitte zuerst bauen: jira-releaseletter build-webapp (im Projekt-Root)");
  process.exit(1);
}

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith("_test.js"))
  .sort();

let failed = [];
files.forEach((f) => {
  process.stdout.write("=== " + f + " ===\n");
  const result = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (result.status !== 0) failed.push(f);
});

console.log("\n" + (files.length - failed.length) + "/" + files.length + " Testdateien bestanden.");
if (failed.length) {
  console.error("FEHLGESCHLAGEN: " + failed.join(", "));
  process.exit(1);
}
console.log("ALLE TESTS BESTANDEN.");
