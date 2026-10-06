import { useEffect } from "react";
import { setWikilinkContext } from "../notes/wikilinks";
import { readVaultIndex } from "../platform";

/** Coming back to the window re-reads the vault at most this often. */
const RELOAD_INTERVAL_MS = 2000;

// The vault's notes for `[[` autocomplete: read when a vault is chosen and
// again when the window regains focus (notes made or renamed in Obsidian);
// only notes that changed are parsed again. Without it, nothing is suggested.
export function useVaultIndex(vault: string | null) {
  useEffect(() => {
    setWikilinkContext({ index: null });
    if (!vault) return;
    let cancelled = false;
    let running = false;
    let lastLoad = 0;
    const load = async () => {
      if (running) return;
      running = true;
      lastLoad = Date.now();
      try {
        const index = await readVaultIndex(vault);
        if (!cancelled) setWikilinkContext({ index });
      } catch (e) {
        console.error("Could not read the vault's notes for link suggestions", e);
      } finally {
        running = false;
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
      setWikilinkContext({ index: null });
    };
  }, [vault]);
}
