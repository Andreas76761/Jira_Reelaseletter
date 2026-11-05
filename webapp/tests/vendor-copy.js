// Legt die Bibliotheken für Bildprüfung (OpenCV) und Texterkennung (Tesseract, Deutsch + Englisch) neben eine gebaute App,
// damit sie ohne Internet-CDN funktionieren (v2.169/v2.170: die App sucht zuerst ./vendor/…, dann das CDN).
// Aufruf:  node webapp/tests/vendor-copy.js <Ordner der gebauten App>      (vorher: cd webapp/tests && npm install)
const fs = require("fs");
const path = require("path");
const target = process.argv[2];
if (!target) { console.error("Aufruf: node vendor-copy.js <Zielordner>"); process.exit(1); }
const nm = path.join(__dirname, "node_modules");
const files = [
  ["@techstark/opencv-js/dist/opencv.js", "vendor/opencv-4.11.0.js"],
  ["@techstark/opencv-js/LICENSE", "vendor/opencv-LICENSE.txt"],
  ["tesseract.js/dist/tesseract.min.js", "vendor/tesseract/tesseract.min.js"],
  ["tesseract.js/dist/worker.min.js", "vendor/tesseract/worker.min.js"],
  ["tesseract.js/LICENSE.md", "vendor/tesseract/LICENSE-tesseract.js.md"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "vendor/tesseract/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "vendor/tesseract/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/LICENSE", "vendor/tesseract/LICENSE-tesseract.js-core.txt"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "vendor/tesseract/lang/eng.traineddata.gz"],
  ["@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz", "vendor/tesseract/lang/deu.traineddata.gz"],
];
let total = 0;
for (const [from, to] of files) {
  const src = path.join(nm, from), dst = path.join(target, to);
  if (!fs.existsSync(src)) { console.error("Fehlt: " + src + " – zuerst in webapp/tests „npm install“ ausführen."); process.exit(1); }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  total += fs.statSync(dst).size;
  console.log("  " + to);
}
console.log(files.length + " Dateien, " + (total / 1048576).toFixed(1) + " MB nach " + target);
