import { createContext, useContext, useSyncExternalStore } from "react";
import type { CommandRegistry } from "./registry";
import { formatShortcut } from "./shortcuts";

/** The app's command registry, for components that show a command's shortcut. */
export const RegistryContext = createContext<CommandRegistry | null>(null);

/**
 * A command's shortcut as shown to people ("Ctrl+G"), or null if it has none;
 * follows changes made in Help › Keyboard shortcuts.
 */
export function useShortcut(id: string): string | null {
  const registry = useContext(RegistryContext);
  return useSyncExternalStore(
    (cb) => registry?.subscribe(cb) ?? (() => {}),
    () => {
      const shortcut = registry?.get(id)?.shortcut;
      return shortcut ? formatShortcut(shortcut) : null;
    },
  );
}

/** " (Ctrl+G)" for a tooltip or label, or "" if the command has no shortcut. */
export function useShortcutHint(id: string): string {
  const shortcut = useShortcut(id);
  return shortcut ? ` (${shortcut})` : "";
}
