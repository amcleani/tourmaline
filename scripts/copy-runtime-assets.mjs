// Copies the data files loaded at runtime into public/ so Vite serves them:
// pdf.js character maps, standard fonts, colour profiles and image decoders,
// and the MathJax fonts.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publicDir = join(import.meta.dirname, "..", "public");
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

const pdfjs = join(publicDir, "pdfjs");
mkdirSync(pdfjs, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  cpSync(join(packageDir("pdfjs-dist"), dir), join(pdfjs, dir), { recursive: true });
}

// src/math/engine.ts points each font's fontURL here.
for (const font of ["tex", "newcm"]) {
  cpSync(join(packageDir(`@mathjax/mathjax-${font}-font`), "chtml", "woff2"), join(publicDir, "mathjax", font), {
    recursive: true,
  });
}
console.log(`pdf.js and MathJax assets copied to ${publicDir}`);
