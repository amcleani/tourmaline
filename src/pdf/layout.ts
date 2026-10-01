// Geometry of the continuous-scroll viewer, kept free of React and pdf.js so it
// can be unit-tested. All values are CSS pixels unless noted.

import { PDF_TO_CSS } from "./units";

export interface Size {
  /** PDF points at scale 1. */
  width: number;
  height: number;
}

export const PAGE_GAP = 12;
export const PADDING = 16;

export interface Layout {
  zoom: number;
  tops: number[];
  widths: number[];
  heights: number[];
  totalHeight: number;
  maxWidth: number;
}

export function computeLayout(sizes: Size[], zoom: number): Layout {
  const scale = zoom * PDF_TO_CSS;
  const tops: number[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  let y = PADDING;
  let maxWidth = 0;
  for (const s of sizes) {
    const w = Math.floor(s.width * scale);
    const h = Math.floor(s.height * scale);
    tops.push(y);
    widths.push(w);
    heights.push(h);
    maxWidth = Math.max(maxWidth, w);
    y += h + PAGE_GAP;
  }
  const totalHeight = sizes.length ? y - PAGE_GAP + PADDING : 0;
  return { zoom, tops, widths, heights, totalHeight, maxWidth };
}

/** Index of the page at vertical offset y (a point in a gap belongs to the page above). */
export function pageAt(layout: Layout, y: number): number {
  const { tops } = layout;
  if (tops.length === 0) return 0;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Pages intersecting [top, top + height], widened by `overscan` pages each side. */
export function visibleRange(layout: Layout, top: number, height: number, overscan = 1): [number, number] {
  const n = layout.tops.length;
  if (n === 0) return [0, -1];
  const first = Math.max(0, pageAt(layout, top) - overscan);
  const last = Math.min(n - 1, pageAt(layout, top + height) + overscan);
  return [first, last];
}

/** The page most of the viewport is showing — what "current page" means to a reader. */
export function currentPage(layout: Layout, top: number, height: number): number {
  const [first, last] = visibleRange(layout, top, height, 0);
  let best = first;
  let bestVisible = -1;
  for (let i = first; i <= last; i++) {
    const visible = Math.min(top + height, layout.tops[i] + layout.heights[i]) - Math.max(top, layout.tops[i]);
    if (visible > bestVisible) {
      best = i;
      bestVisible = visible;
    }
  }
  return best;
}

/**
 * A zoom-independent position: a page and a fraction (0 = top, 1 = bottom) of
 * the way down it. Used to keep the reader's place across zoom and relayout.
 */
export interface Anchor {
  page: number;
  fraction: number;
}

export function anchorAt(layout: Layout, y: number): Anchor {
  const page = pageAt(layout, y);
  const h = layout.heights[page] || 1;
  // Clamp: a point in the gap below a page counts as its bottom edge.
  const fraction = Math.min(1, Math.max(0, (y - layout.tops[page]) / h));
  return { page, fraction };
}

export function offsetOf(layout: Layout, anchor: Anchor): number {
  const page = Math.min(Math.max(anchor.page, 0), layout.tops.length - 1);
  if (page < 0) return 0;
  return layout.tops[page] + anchor.fraction * layout.heights[page];
}

/**
 * The most common page size, so a cover or fold-out page doesn't set the zoom
 * for a whole document in the fit modes.
 */
export function typicalSize(sizes: Size[]): Size {
  const counts = new Map<string, { size: Size; n: number }>();
  for (const s of sizes) {
    const key = `${Math.round(s.width)}x${Math.round(s.height)}`;
    const entry = counts.get(key) ?? { size: s, n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  let best: { size: Size; n: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.size ?? { width: 612, height: 792 };
}

export type ZoomMode = "custom" | "fit-width" | "fit-page";

/** Zoom level that fits a page into the viewport, leaving room for padding and a scrollbar. */
export function fitZoom(mode: Exclude<ZoomMode, "custom">, page: Size, viewportWidth: number, viewportHeight: number): number {
  const availW = Math.max(100, viewportWidth - 2 * PADDING);
  const availH = Math.max(100, viewportHeight - 2 * PADDING);
  const byWidth = availW / (page.width * PDF_TO_CSS);
  if (mode === "fit-width") return byWidth;
  return Math.min(byWidth, availH / (page.height * PDF_TO_CSS));
}

export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? MIN_ZOOM;
}

/** A zoom within the limits (a pinch can ask for any). */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Ctrl+wheel: whether an event is a trackpad pinch (or a smooth trackpad
 * scroll with Ctrl held), which zooms continuously, rather than a mouse
 * wheel's notch, which zooms one step. Chromium sends pinches as wheel events
 * with Ctrl set and small pixel deltas; a notch is 100 px (times the
 * display scale) or counted in lines.
 */
export function isPinchWheel(e: Pick<WheelEvent, "deltaY" | "deltaMode">): boolean {
  return e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
}

/** How much a pinch's wheel event scales the page: about 2× for a full pinch. */
export function pinchFactor(deltaY: number): number {
  return Math.exp(-deltaY / 100);
}
