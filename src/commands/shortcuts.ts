// Shortcuts are written as "Mod+Shift+K" style strings. "Mod" means Ctrl on
// Windows/Linux and Cmd on macOS. Everything is normalised to a canonical form
// so that definitions and key events can be compared as plain strings.

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  space: "Space",
  esc: "Escape",
  escape: "Escape",
  plus: "=",
  "+": "=",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pgup: "PageUp",
  pgdn: "PageDown",
  del: "Delete",
  return: "Enter",
};

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function normaliseKey(key: string): string {
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (key.length === 1) return key.toUpperCase();
  // Named keys such as "ArrowDown", "F5", "Home": capitalise first letter only.
  return key[0].toUpperCase() + key.slice(1);
}

function modifierName(part: string): Modifier | null {
  switch (part.toLowerCase()) {
    case "mod":
      return isMac ? "Meta" : "Ctrl";
    case "ctrl":
    case "control":
      return "Ctrl";
    case "alt":
    case "option":
      return "Alt";
    case "shift":
      return "Shift";
    case "meta":
    case "cmd":
    case "super":
      return "Meta";
    default:
      return null;
  }
}

/** Canonical form of a shortcut definition, e.g. "mod+shift+p" -> "Ctrl+Shift+P". */
export function normaliseShortcut(shortcut: string): string {
  // Split on "+" but allow the "+" key itself as the final part ("Ctrl++").
  const parts = shortcut.split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean);
  const mods = new Set<Modifier>();
  let key = "";
  for (const part of parts) {
    const mod = modifierName(part);
    if (mod) mods.add(mod);
    else key = normaliseKey(part);
  }
  if (!key) throw new Error(`Shortcut "${shortcut}" has no key`);
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** Canonical form of a keyboard event, comparable with normaliseShortcut output. */
export function eventToShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) return null;
  const mods: Modifier[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  // "+" is typed as Shift+= on most layouts; treat it as the "=" key.
  const key = e.key === "+" ? "=" : normaliseKey(e.key);
  return [...mods, key].join("+");
}

/** Human-readable label for menus, tooltips and the palette. */
export function formatShortcut(shortcut: string): string {
  const canonical = normaliseShortcut(shortcut);
  const pretty: Record<string, string> = {
    "=": "+",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Meta: isMac ? "⌘" : "Win",
  };
  return canonical
    .split(/\+(?!$)/)
    .map((p) => pretty[p] ?? p)
    .join(isMac ? "" : "+");
}

/** Tauri/muda accelerator string for the native menu. */
export function toAccelerator(shortcut: string): string {
  const names: Record<string, string> = {
    Ctrl: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Meta: "Super",
    "=": "Equal",
    "-": "Minus",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return normaliseShortcut(shortcut)
    .split(/\+(?!$)/)
    .map((p) => names[p] ?? p)
    .join("+");
}
