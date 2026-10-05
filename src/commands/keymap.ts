import type { Command, CommandRegistry, ShortcutOverrides } from "./registry";
import { isTextEditingShortcut, normaliseShortcut } from "./shortcuts";

// The rules for shortcuts the user picks in Help › Keyboard shortcuts, and
// the overrides that result. Kept apart from the dialog so they can be tested.

/** Keys the user may not take: they move focus, open menus or close the window. */
const RESERVED: Record<string, string> = {
  Tab: "Tab moves between controls.",
  "Shift+Tab": "Shift+Tab moves between controls.",
  Enter: "Enter presses buttons and follows links.",
  Space: "Space presses buttons and scrolls the page.",
  "Shift+Space": "Shift+Space scrolls the page up.",
  F10: "F10 opens the menu bar.",
  "Shift+F10": "Shift+F10 opens the context menu.",
  ContextMenu: "The menu key opens the context menu.",
  "Alt+F4": "Alt+F4 closes the window.",
};

/** Alt+letter opens a menu (Alt+F: File...): the first letter of each menu. */
const MENU_MNEMONICS = new Set(["F", "E", "V", "N", "A", "X", "H"]);

export type ShortcutCheck =
  | { kind: "ok"; shortcut: string }
  | { kind: "invalid"; reason: string }
  /** Free once taken from `other`. */
  | { kind: "conflict"; shortcut: string; other: Command };

/** Whether `shortcut` can be given to command `id`. */
export function checkShortcut(registry: CommandRegistry, id: string, shortcut: string): ShortcutCheck {
  let key: string;
  try {
    key = normaliseShortcut(shortcut);
  } catch {
    return { kind: "invalid", reason: "That isn't a key." };
  }
  if (RESERVED[key]) return { kind: "invalid", reason: RESERVED[key] };
  const parts = key.split(/\+(?!$)/);
  const mods = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const fallback = registry.defaultShortcut(id);
  const isDefault = !!fallback && normaliseShortcut(fallback) === key;
  if (!isDefault) {
    if (mods.length === 1 && mods[0] === "Alt" && MENU_MNEMONICS.has(last)) {
      return { kind: "invalid", reason: `Alt+${last} opens a menu.` };
    }
    if (mods.includes("Ctrl") && mods.includes("Alt")) {
      return { kind: "invalid", reason: "Ctrl+Alt is AltGr on many keyboards, where it types characters." };
    }
    if (key === "Escape") return { kind: "invalid", reason: "Escape closes and cancels things." };
    if (isTextEditingShortcut(key)) return { kind: "invalid", reason: `${key} is used for editing text.` };
  }
  const other = registry.commandForShortcut(key);
  if (other && other.id !== id) return { kind: "conflict", shortcut: key, other };
  return { kind: "ok", shortcut: key };
}

/**
 * Overrides with command `id` bound to `shortcut` (null: none), taking it from
 * any command that has it. A shortcut equal to the default is no override.
 */
export function assignShortcut(registry: CommandRegistry, overrides: ShortcutOverrides, id: string, shortcut: string | null): ShortcutOverrides {
  const next: Record<string, string | null> = { ...overrides };
  const key = shortcut ? normaliseShortcut(shortcut) : null;
  if (key) {
    const other = registry.commandForShortcut(key);
    if (other && other.id !== id) next[other.id] = null;
  }
  const fallback = registry.defaultShortcut(id);
  const fallbackKey = fallback ? normaliseShortcut(fallback) : null;
  if (key === fallbackKey) delete next[id];
  else next[id] = key;
  // A command whose default was taken by another command is left without one
  // anyway; an explicit null for it says the same thing, so tidy it away
  // only when the default is free again.
  for (const [otherId, value] of Object.entries(next)) {
    if (value !== null || otherId === id) continue;
    const d = registry.defaultShortcut(otherId);
    if (!d) delete next[otherId];
  }
  return next;
}

/** Overrides without those of `ids` (the same object if none of them has one). */
export function withoutOverrides(overrides: ShortcutOverrides, ids: readonly string[]): ShortcutOverrides {
  if (!ids.some((id) => Object.hasOwn(overrides, id))) return overrides;
  const next: Record<string, string | null> = { ...overrides };
  for (const id of ids) delete next[id];
  return next;
}

/** Reads the saved overrides, dropping anything that isn't a shortcut or null. */
export function parseOverrides(json: string | null): ShortcutOverrides {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string | null> = {};
    for (const [id, shortcut] of Object.entries(value)) {
      if (shortcut === null) out[id] = null;
      else if (typeof shortcut === "string") {
        try {
          out[id] = normaliseShortcut(shortcut);
        } catch {
          // Not a shortcut: ignored.
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}
