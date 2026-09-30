import { DEFAULT_MATH, type MathConfig, type MathFont } from "./engine";

/** What `math_settings` reads from the vault (src-tauri/src/vault.rs). */
export interface VaultMathSettings {
  /** Set when the latest-mathjax plugin is enabled. */
  latestMathjax: { fontFamily: string | null; packages: string[] | null } | null;
  preamble: string;
  sources: { plugin: string; path: string; error: string | null }[];
}

/** latest-mathjax's packages when its settings don't list them (MathJax 4's defaults). */
const MATHJAX4_PACKAGES = ["base", "ams", "newcommand", "noundefined", "configmacros"];

/**
 * The MathJax set-up that matches the vault: Obsidian's built-in MathJax 3
 * (TeX font, its usual packages), or latest-mathjax's font and packages when
 * that plugin is on; the preamble either way.
 */
export function mathConfigFor(settings: VaultMathSettings | null): MathConfig {
  if (!settings) return DEFAULT_MATH;
  const lm = settings.latestMathjax;
  if (!lm) return { ...DEFAULT_MATH, preamble: settings.preamble };
  // MathJax 4's own default font is New Computer Modern; the two bundled here
  // are it and the classic TeX font. Other families fall back to the default.
  const family = (lm.fontFamily ?? "newcm").toLowerCase();
  const font: MathFont = family === "mathjax-tex" || family === "tex" ? "tex" : "newcm";
  return { font, packages: lm.packages?.length ? lm.packages : MATHJAX4_PACKAGES, preamble: settings.preamble };
}

/** Problems worth telling the user about: preamble files that couldn't be read. */
export function settingsProblems(settings: VaultMathSettings): string[] {
  return settings.sources
    .filter((s) => s.error)
    .map((s) => `Could not read the math preamble ${s.path} (${s.plugin} plugin): ${s.error}`);
}
