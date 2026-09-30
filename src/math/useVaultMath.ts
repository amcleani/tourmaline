import { useEffect } from "react";
import { readMathSettings } from "../platform";
import { configureMath } from "./engine";
import { mathConfigFor, settingsProblems } from "./settings";

/** Coming back to the window re-reads the settings at most this often. */
const RELOAD_INTERVAL_MS = 2000;

// Renders math the way the vault does, and picks up changes to the preamble
// or plugin settings when the window regains focus (after editing
// preamble.sty in Obsidian, say). Problems are reported once per change.
export function useVaultMath(vault: string | null, report: (message: string) => void) {
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    let applied = "";
    let lastLoad = 0;
    const load = async () => {
      lastLoad = Date.now();
      try {
        const settings = await readMathSettings(vault);
        const key = JSON.stringify(settings);
        if (cancelled || key === applied) return;
        applied = key;
        settingsProblems(settings).forEach(report);
        const error = await configureMath(mathConfigFor(settings));
        if (error && !cancelled) report(`The math preamble has an error, so macros after it are missing: ${error}`);
      } catch (e) {
        if (!cancelled) report(`Could not read the vault's math settings: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    void load();
    const onFocus = () => {
      if (Date.now() - lastLoad > RELOAD_INTERVAL_MS) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [vault, report]);
}
