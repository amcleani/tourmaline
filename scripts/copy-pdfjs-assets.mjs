// Copies the data files pdf.js loads at runtime (character maps, standard
// fonts, colour profiles, image decoders) into public/ so Vite serves them.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(import.meta.dirname, "..", "public", "pdfjs");

mkdirSync(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  cpSync(join(pdfjsRoot, dir), join(target, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${target}`);
