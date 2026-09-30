// Rebuilds the PDF fixtures in test/fixtures/ from the LaTeX sources in
// test/fixtures/src/. Needs TeX Live (pdflatex) on PATH, plus pdftoppm or
// Ghostscript (rungs / gswin64c / gs) for the scanned fixture.
//
//   node scripts/build-fixtures.mjs              # rebuild everything
//   node scripts/build-fixtures.mjs linked ...   # rebuild only these
//   node scripts/build-fixtures.mjs --keep       # keep the build dir (prints it)
//   node scripts/build-fixtures.mjs --build-dir=DIR   # build in DIR and keep it
//
// LaTeX auxiliary files go to a temporary directory, never into the repo.
// Output is reproducible: fixture-common.tex removes dates and trailer ids.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(root, "test", "fixtures");
const srcDir = join(fixturesDir, "src");

// Order matters: `scanned` is rasterised from the built `one-column.pdf`.
const FIXTURES = [
  "one-column",
  "two-column",
  "two-column-midpage",
  "shuffled-stream",
  "math-heavy",
  "linked",
  "unlinked",
  "mixed-page-sizes",
  "scanned",
];

// Three runs resolve \ref, \cite and the hyperref outline.
const LATEX_RUNS = 3;
const SCAN_DPI = 150;
const SCAN_PAGES = [1, 2];

const args = process.argv.slice(2);
const buildDirArg = args.find((a) => a.startsWith("--build-dir="))?.slice("--build-dir=".length);
const keep = args.includes("--keep") || buildDirArg !== undefined;
const requested = args.filter((a) => !a.startsWith("--"));
for (const name of requested) {
  if (!FIXTURES.includes(name)) {
    console.error(`Unknown fixture "${name}". Known: ${FIXTURES.join(", ")}`);
    process.exit(2);
  }
}
const selected = requested.length ? FIXTURES.filter((f) => requested.includes(f)) : FIXTURES;

const buildDir = buildDirArg
  ? (mkdirSync(resolve(buildDirArg), { recursive: true }), resolve(buildDirArg))
  : mkdtempSync(join(tmpdir(), "tourmaline-fixtures-"));
const env = {
  ...process.env,
  // Kpathsea: search the build dir (rasterised scans) and src/ (shared
  // \input files); the trailing separator appends the default search path.
  TEXINPUTS: [buildDir, srcDir, ""].join(delimiter),
  SOURCE_DATE_EPOCH: "0",
  FORCE_SOURCE_DATE: "1",
};

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { cwd: srcDir, env, encoding: "utf8" });
}

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { encoding: "utf8" }).status === 0;
}

function latex(name) {
  for (let i = 0; i < LATEX_RUNS; i++) {
    const res = run("pdflatex", [
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      `-output-directory=${buildDir}`,
      `${name}.tex`,
    ]);
    if (res.error) throw new Error(`Could not run pdflatex: ${res.error.message}`);
    if (res.status !== 0) {
      const tail = (res.stdout ?? "").split("\n").slice(-30).join("\n");
      throw new Error(`pdflatex failed on ${name}.tex (log in ${buildDir}):\n${tail}`);
    }
  }
  const out = join(fixturesDir, `${name}.pdf`);
  copyFileSync(join(buildDir, `${name}.pdf`), out);
  console.log(`  ${name}.pdf  ${(statSync(out).size / 1024).toFixed(1)} KB`);
}

// Rasterise pages of one-column.pdf to 1-bit PNGs (like a bilevel office
// scan) named scan-p<N>.png in the build dir, for scanned.tex to include.
function rasterise() {
  const source = join(fixturesDir, "one-column.pdf");
  for (const page of SCAN_PAGES) {
    const base = join(buildDir, `scan-p${page}`);
    if (which("pdftoppm")) {
      const res = run("pdftoppm", [
        "-f", String(page), "-l", String(page), "-singlefile",
        "-r", String(SCAN_DPI), "-mono", "-png", source, base,
      ]);
      if (res.status === 0) continue;
    }
    const gs = ["gswin64c", "rungs", "gs"].find(which);
    if (!gs) throw new Error("Need pdftoppm or Ghostscript to build the scanned fixture");
    const res = run(gs, [
      "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pngmono",
      `-r${SCAN_DPI}`, `-dFirstPage=${page}`, `-dLastPage=${page}`,
      `-sOutputFile=${base}.png`, source,
    ]);
    if (res.status !== 0) throw new Error(`${gs} failed: ${res.stderr}`);
  }
}

console.log(`Building ${selected.length} fixture(s) in ${buildDir}`);
try {
  for (const name of selected) {
    if (name === "scanned") rasterise();
    latex(name);
  }
} finally {
  if (keep) console.log(`Build dir kept: ${buildDir}`);
  else rmSync(buildDir, { recursive: true, force: true });
}
