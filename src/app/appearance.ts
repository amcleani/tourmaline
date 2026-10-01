// How Tourmaline looks: the interface's colours, the pages' colours and the
// size of everything. Saved in app state `appearance`; applied as attributes
// on <html> (the stylesheet does the rest) and as the webview's zoom.

export type Theme = "system" | "light" | "dark" | "contrast";
export type PageColours = "normal" | "dark" | "sepia";

export interface Appearance {
  theme: Theme;
  pages: PageColours;
  /** The size of the whole window's contents, 1 = 100%. */
  uiScale: number;
}

export const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Same as Windows" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "contrast", label: "High contrast" },
];

export const PAGE_COLOURS: { value: PageColours; label: string }[] = [
  { value: "normal", label: "As printed" },
  { value: "dark", label: "Dark (light text on dark pages)" },
  { value: "sepia", label: "Sepia (warmer, less glare)" },
];

export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", pages: "normal", uiScale: 1 };

export function parseAppearance(json: string | null): Appearance {
  if (!json) return DEFAULT_APPEARANCE;
  try {
    const v = JSON.parse(json) as Partial<Record<keyof Appearance, unknown>>;
    return {
      theme: THEMES.find((t) => t.value === v.theme)?.value ?? DEFAULT_APPEARANCE.theme,
      pages: PAGE_COLOURS.find((p) => p.value === v.pages)?.value ?? DEFAULT_APPEARANCE.pages,
      uiScale: UI_SCALES.find((s) => s === v.uiScale) ?? DEFAULT_APPEARANCE.uiScale,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** The next value in a list, wrapping round. */
export function cycle<T>(list: readonly { value: T }[], current: T): T {
  const i = list.findIndex((x) => x.value === current);
  return list[(i + 1) % list.length].value;
}

/** One step larger (1) or smaller (-1), within the sizes offered. */
export function stepScale(current: number, direction: 1 | -1): number {
  const i = UI_SCALES.findIndex((s) => Math.abs(s - current) < 1e-6);
  const at = i === -1 ? UI_SCALES.indexOf(1) : i;
  return UI_SCALES[Math.min(UI_SCALES.length - 1, Math.max(0, at + direction))];
}

export const percent = (scale: number) => `${Math.round(scale * 100)}%`;

/** Sets the attributes the stylesheet's themes and page colours key on. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  if (a.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  if (a.pages === "normal") delete root.dataset.pages;
  else root.dataset.pages = a.pages;
}
