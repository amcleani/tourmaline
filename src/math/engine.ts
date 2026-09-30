// MathJax, set up the way the user's Obsidian renders math: the same font,
// TeX packages and preamble (see settings.ts). MathJax loads on first use and
// is rebuilt when the settings change, since macro definitions can't be
// undone. Rendered formulas are cached and cloned.

import type { MathDocument } from "@mathjax/src/js/core/MathDocument.js";
import type { TeX } from "@mathjax/src/js/input/tex.js";
import type { CHTML } from "@mathjax/src/js/output/chtml.js";

export type MathFont = "tex" | "newcm";

export interface MathConfig {
  font: MathFont;
  /** TeX packages, in MathJax's names. */
  packages: readonly string[];
  /** TeX run once before any formula: the vault's macro definitions. */
  preamble: string;
}

/**
 * Obsidian's built-in MathJax 3: its default packages plus those it loads
 * on first use (autoload), minus `html` (\href would navigate the window)
 * and `require` (nothing to load from).
 */
export const OBSIDIAN_PACKAGES = [
  "base", "ams", "newcommand", "noundefined", "configmacros", "action", "amscd", "bbox", "boldsymbol",
  "braket", "bussproofs", "cancel", "cases", "centernot", "color", "colortbl", "empheq", "enclose",
  "extpfeil", "gensymb", "mathtools", "mhchem", "unicode", "upgreek", "verb",
] as const;

/** Packages that can't be offered whatever the vault asks for. */
const UNSAFE_PACKAGES = new Set(["html", "require", "autoload", "texhtml", "setoptions"]);

export const DEFAULT_MATH: MathConfig = { font: "tex", packages: OBSIDIAN_PACKAGES, preamble: "" };

// Each TeX package is a module named after its folder; fonts load extra
// character ranges on demand. Both come from node_modules, lazily.
const PACKAGE_MODULES = import.meta.glob("/node_modules/@mathjax/src/mjs/input/tex/*/*Configuration.js");
const FONT_RANGES = import.meta.glob("/node_modules/@mathjax/mathjax-*-font/mjs/chtml/dynamic/*.js");

function packageModule(name: string): (() => Promise<unknown>) | undefined {
  if (UNSAFE_PACKAGES.has(name) || !/^[a-z0-9]+$/.test(name)) return undefined;
  const prefix = `/node_modules/@mathjax/src/mjs/input/tex/${name}/`;
  const key = Object.keys(PACKAGE_MODULES).find((k) => k.startsWith(prefix));
  return key ? PACKAGE_MODULES[key] : undefined;
}

async function loadFont(font: MathFont) {
  if (font === "newcm") return (await import("@mathjax/mathjax-newcm-font/js/chtml.js")).MathJaxNewcmFont;
  return (await import("@mathjax/mathjax-tex-font/js/chtml.js")).MathJaxTexFont;
}

interface Engine {
  config: MathConfig;
  doc: MathDocument<HTMLElement, Text, Document>;
  tex: TeX<HTMLElement, Text, Document>;
  chtml: CHTML<HTMLElement, Text, Document>;
  sheet: HTMLStyleElement;
  /** Why the preamble failed, if it did (the macros before the error still work). */
  preambleError: string | null;
  cache: Map<string, HTMLElement>;
}

const CACHE_SIZE = 500;

let engine: Promise<Engine> | null = null;
let registered = false;
let generation = 0;
const listeners = new Set<() => void>();

async function build(config: MathConfig, previous: Engine | null): Promise<Engine> {
  const [{ mathjax }, { TeX }, { CHTML }, { browserAdaptor }, { RegisterHTMLHandler }, fontData] = await Promise.all([
    import("@mathjax/src/js/mathjax.js"),
    import("@mathjax/src/js/input/tex.js"),
    import("@mathjax/src/js/output/chtml.js"),
    import("@mathjax/src/js/adaptors/browserAdaptor.js"),
    import("@mathjax/src/js/handlers/html.js"),
    loadFont(config.font),
  ]);
  const packages: string[] = [];
  for (const name of config.packages) {
    const load = packageModule(name);
    if (load) {
      await load();
      packages.push(name);
    } else {
      console.warn(`MathJax package ${name} is not available`);
    }
  }
  if (!packages.includes("base")) packages.unshift("base");

  mathjax.asyncLoad = (name: string) => {
    const key = name.replace(/^@mathjax\/(mathjax-[a-z]+-font)\/js\//, "/node_modules/@mathjax/$1/mjs/");
    const load = FONT_RANGES[key];
    return load ? load() : Promise.reject(new Error(`MathJax can't load ${name}`));
  };
  if (!registered) {
    RegisterHTMLHandler(browserAdaptor());
    registered = true;
  }

  let lastError: string | null = null;
  const tex = new TeX<HTMLElement, Text, Document>({
    packages,
    formatError: (jax: TeX<HTMLElement, Text, Document>, err: { message: string }) => {
      lastError = err.message;
      return jax.formatError(err as never);
    },
  });
  const chtml = new CHTML<HTMLElement, Text, Document>({
    fontData,
    fontURL: `${import.meta.env.BASE_URL ?? "/"}mathjax/${config.font}`,
  });
  const doc = mathjax.document(document, { InputJax: tex, OutputJax: chtml });

  let preambleError: string | null = null;
  if (config.preamble.trim()) {
    lastError = null;
    try {
      await mathjax.handleRetriesFor(() => doc.convert(config.preamble, { display: false }));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    preambleError = lastError;
  }

  const sheet = chtml.styleSheet(doc) as HTMLStyleElement;
  previous?.sheet.remove();
  document.head.appendChild(sheet);
  return { config, doc, tex, chtml, sheet, preambleError, cache: new Map() };
}

/** Sets the math settings; resolves to the preamble error, if any. */
export async function configureMath(config: MathConfig): Promise<string | null> {
  const previous = engine;
  const next = (async () => build(config, previous ? await previous.catch(() => null) : null))();
  engine = next;
  generation++;
  for (const l of listeners) l();
  return (await next).preambleError;
}

function current(): Promise<Engine> {
  return (engine ??= build(DEFAULT_MATH, null));
}

/** Changes whenever the settings do, so rendered formulas know to redraw. */
export function mathGeneration(): number {
  return generation;
}

export function onMathChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Renders TeX to a new element. Errors are drawn in the formula as MathJax
 * draws them (and undefined macros in red), like Obsidian.
 */
export async function renderMath(tex: string, display: boolean): Promise<HTMLElement> {
  const e = await current();
  const key = `${display ? "D" : "I"}${tex}`;
  let node = e.cache.get(key);
  if (!node) {
    const { mathjax } = await import("@mathjax/src/js/mathjax.js");
    node = (await mathjax.handleRetriesFor(() =>
      e.doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 }),
    )) as HTMLElement;
    e.chtml.styleSheet(e.doc); // adds the CSS for any new characters
    if (e.cache.size >= CACHE_SIZE) e.cache.delete(e.cache.keys().next().value!);
    e.cache.set(key, node);
  }
  const out = node.cloneNode(true) as HTMLElement;
  // The glyphs are CSS; screen readers get the source.
  out.setAttribute("role", "img");
  out.setAttribute("aria-label", tex);
  return out;
}

/** The settings in use. */
export async function currentMathConfig(): Promise<MathConfig> {
  return (await current()).config;
}

export interface TexNames {
  macros: string[];
  environments: string[];
}

/** Every macro and environment the current settings define (for autocomplete). */
export async function texNames(): Promise<TexNames> {
  const e = await current();
  const names = (kind: string) => {
    const out = new Set<string>();
    try {
      // SubHandler keeps its maps in a private list; each TokenMap has a `map`.
      const handler = e.tex.parseOptions.handlers.get(kind as never) as unknown as {
        _configuration: Iterable<{ item: { map?: Map<string, unknown> } }>;
      };
      for (const { item } of handler._configuration) for (const k of item.map?.keys() ?? []) out.add(k);
    } catch (err) {
      console.warn("Could not list TeX names", err);
    }
    return [...out].filter((n) => /^[a-zA-Z]+\*?$/.test(n)).sort();
  };
  return { macros: names("macro"), environments: names("environment") };
}
