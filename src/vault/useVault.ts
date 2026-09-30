import { useEffect, useState } from "react";
import { setStrictLineBreaks } from "../notes/markdown";
import { bibliographyModified, isTauri, readBibliography, readVaultSettings } from "../platform";
import { Bibliography } from "./bibliography";
import type { VaultSettings } from "./notes";

/** Coming back to the window re-reads the settings at most this often. */
const RELOAD_INTERVAL_MS = 2000;

export interface VaultState {
  settings: VaultSettings | null;
  /** The JabRef bibliography the Citations plugin uses, once read. */
  bibliography: Bibliography | null;
}

/** Browser only (`npm run dev`): `?bib=/test/…/x.bib` stands in for a vault's bibliography. */
function browserSettings(): VaultSettings | null {
  const bib = isTauri() ? null : new URLSearchParams(window.location.search).get("bib");
  if (!bib) return null;
  return {
    name: "Vault",
    citations: {
      enabled: true,
      format: "biblatex",
      bibliography: bib,
      noteTitleTemplate: "@{{citekey}}",
      noteFolder: "Library",
      noteTemplate: "",
    },
    attachmentFolder: null,
    strictLineBreaks: false,
  };
}

// The vault's settings and bibliography, read again when the window regains
// focus (after changing a setting in Obsidian or an entry in JabRef). The
// bibliography is only re-read when its file has changed. Problems are
// reported once each.
export function useVault(vault: string | null, report: (message: string) => void): VaultState {
  const [state, setState] = useState<VaultState>({ settings: null, bibliography: null });

  useEffect(() => {
    const standIn = browserSettings();
    setState({ settings: standIn, bibliography: null });
    if (!vault && !standIn) return;
    let cancelled = false;
    let lastLoad = 0;
    let settingsKey = "";
    let bib: { path: string; modified: number; value: Bibliography } | null = null;
    const reported = new Set<string>();
    const once = (message: string) => {
      if (!cancelled && !reported.has(message)) report(message);
      reported.add(message);
    };

    const loadBibliography = async (settings: VaultSettings): Promise<Bibliography | null> => {
      const { bibliography: path, format, enabled } = settings.citations;
      if (!path) {
        if (enabled) once("The Citations plugin has no bibliography set, so papers can't be matched to entries.");
        return null;
      }
      if (format !== "biblatex") {
        once("Tourmaline reads BibLaTeX bibliographies; the Citations plugin is set to CSL-JSON.");
        return null;
      }
      const modified = await bibliographyModified(path);
      if (bib && bib.path === path && bib.modified === modified) return bib.value;
      const read = await readBibliography(path);
      const value = new Bibliography(read.text, path);
      if (value.errors.length) {
        console.warn("Bibliography entries that couldn't be read", value.errors);
        once(`${value.errors.length} entries in ${path} couldn't be read (first: ${value.errors[0]}).`);
      }
      bib = { path, modified: read.modified, value };
      return value;
    };

    const load = async () => {
      lastLoad = Date.now();
      try {
        const settings = standIn ?? (await readVaultSettings(vault!));
        if (cancelled || !settings) return;
        const key = JSON.stringify(settings);
        if (key !== settingsKey) {
          settingsKey = key;
          setStrictLineBreaks(settings.strictLineBreaks);
        }
        const bibliography = await loadBibliography(settings).catch((e) => {
          once(`Could not read the bibliography: ${e instanceof Error ? e.message : String(e)}`);
          return bib?.value ?? null;
        });
        if (cancelled) return;
        setState((prev) =>
          prev.bibliography === bibliography && JSON.stringify(prev.settings) === key ? prev : { settings, bibliography },
        );
      } catch (e) {
        once(`Could not read the vault's settings: ${e instanceof Error ? e.message : String(e)}`);
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
      setStrictLineBreaks(false);
    };
  }, [vault, report]);

  return state;
}
