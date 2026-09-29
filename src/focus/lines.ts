// Reading-order line detection for focus mode.
//
// pdf.js gives text as positioned fragments ("items") in content-stream order,
// which is often not reading order. This module:
//   1. merges items on the same baseline into line fragments, splitting at
//      gaps wide enough to be a column gutter;
//   2. looks for a vertical gutter to decide whether the page has two columns;
//   3. orders fragments: full-width elements (title, abstract, wide figures)
//      stay where they are, and between them the left column is read before
//      the right one;
//   4. merges fragments that overlap vertically (fractions, sub/superscripts,
//      stacked math) so a displayed formula counts as one step.
//
// Pure functions over plain data, so the logic can be tested without pdf.js.

import type { PdfRect, TextItemLike } from "../pdf/search";

export interface Line {
  text: string;
  /** PDF-space bounding box [x0, y0, x1, y1], y upwards. */
  bbox: PdfRect;
  /** Indices into the page's item list, in reading order. */
  items: number[];
  /** 0 = left column, 1 = right column, -1 = spans the page / single column. */
  column: -1 | 0 | 1;
}

export interface PageLines {
  lines: Line[];
  columns: 1 | 2;
  /** x of the gutter centre when columns === 2. */
  gutter: number | null;
}

export interface DetectOptions {
  /** Set false to ignore columns (per-paper off switch for odd layouts). */
  detectColumns?: boolean;
}

interface Box {
  x0: number;
  x1: number;
  /** Bottom and top of the glyph box (y upwards). */
  y0: number;
  y1: number;
  baseline: number;
  size: number;
}

interface Part {
  index: number;
  x0: number;
  x1: number;
  size: number;
  str: string;
}

interface Fragment extends Box {
  items: number[];
  text: string;
  parts: Part[];
}

/** Joins parts left to right, inserting a space where there is a visible gap. */
function joinParts(parts: Part[]): { text: string; items: number[] } {
  const sorted = parts.slice().sort((p, q) => p.x0 - q.x0);
  let text = "";
  let prev: Part | null = null;
  for (const part of sorted) {
    const gap = prev ? part.x0 - prev.x1 : 0;
    if (prev && gap > 0.15 * Math.min(prev.size, part.size) && !/\s$/.test(text) && !/^\s/.test(part.str)) text += " ";
    text += part.str;
    prev = part;
  }
  return { text: text.replace(/\s+/g, " ").trim(), items: sorted.map((p) => p.index) };
}

function itemBox(item: TextItemLike): Box | null {
  const [a, b, c, d, e, f] = item.transform;
  // Only horizontal, upright text takes part; rotated labels are skipped.
  if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0) return null;
  const size = item.height || Math.abs(d) || Math.hypot(c, d);
  if (!(size > 0)) return null;
  return { x0: e, x1: e + Math.max(item.width, 0), baseline: f, y0: f - 0.25 * size, y1: f + 0.85 * size, size };
}

const isText = (item: unknown): item is TextItemLike => typeof (item as TextItemLike)?.str === "string";

/** Merges items sharing a baseline into fragments, splitting at wide gaps. */
function buildFragments(items: ReadonlyArray<unknown>): Fragment[] {
  const boxes: Array<{ index: number; box: Box; str: string }> = [];
  items.forEach((raw, index) => {
    if (!isText(raw) || raw.str.trim() === "") return;
    const box = itemBox(raw);
    if (box) boxes.push({ index, box, str: raw.str });
  });
  // Top to bottom, then left to right.
  boxes.sort((p, q) => q.box.baseline - p.box.baseline || p.box.x0 - q.box.x0);

  const fragments: Fragment[] = [];
  const open: Fragment[] = [];
  for (const { index, box, str } of boxes) {
    // Candidate fragments whose baseline is close enough to be the same line.
    let target: Fragment | undefined;
    for (const frag of open) {
      const tolerance = 0.45 * Math.max(frag.size, box.size);
      if (Math.abs(frag.baseline - box.baseline) > tolerance) continue;
      const gap = box.x0 - frag.x1;
      // Overlap or a word-sized gap joins; a gutter-sized gap starts a new fragment.
      if (gap < 1.2 * Math.max(frag.size, box.size) && box.x1 > frag.x0 - 0.5 * box.size) {
        target = frag;
        break;
      }
    }
    const part: Part = { index, x0: box.x0, x1: box.x1, size: box.size, str };
    if (target) {
      target.parts.push(part);
      target.x0 = Math.min(target.x0, box.x0);
      target.x1 = Math.max(target.x1, box.x1);
      target.y0 = Math.min(target.y0, box.y0);
      target.y1 = Math.max(target.y1, box.y1);
      // Keep the dominant (largest) baseline so superscripts don't drag it.
      if (box.size > target.size) {
        target.size = box.size;
        target.baseline = box.baseline;
      }
    } else {
      const frag: Fragment = { ...box, items: [], text: "", parts: [part] };
      fragments.push(frag);
      open.push(frag);
    }
    // Fragments far above the current baseline can't grow any more.
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].baseline - box.baseline > 2 * open[i].size) open.splice(i, 1);
    }
  }
  return mergeCloseFragments(fragments).map((f) => ({ ...f, ...joinParts(f.parts) }));
}

/**
 * Items are grouped top-down, so a raised item (superscript) can start a
 * fragment before the word to its left is seen. Merge fragments on the same
 * line that are within a word gap of each other, until nothing changes.
 */
function mergeCloseFragments(fragments: Fragment[]): Fragment[] {
  const out = fragments.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const size = Math.max(a.size, b.size);
        if (Math.abs(a.baseline - b.baseline) > 0.45 * size) continue;
        const distance = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        if (distance >= 1.2 * size) continue;
        const main = a.size >= b.size ? a : b;
        out[i] = {
          ...main,
          x0: Math.min(a.x0, b.x0),
          x1: Math.max(a.x1, b.x1),
          y0: Math.min(a.y0, b.y0),
          y1: Math.max(a.y1, b.y1),
          parts: [...a.parts, ...b.parts],
        };
        out.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return out;
}

/**
 * Finds a vertical gutter: an x in the middle band of the text block that few
 * fragments cross, with enough text on both sides. Returns null for single
 * column pages.
 */
function findGutter(fragments: Fragment[]): number | null {
  if (fragments.length < 6) return null;
  const left = Math.min(...fragments.map((f) => f.x0));
  const right = Math.max(...fragments.map((f) => f.x1));
  const width = right - left;
  if (width <= 0) return null;

  let best: { x: number; crossing: number } | null = null;
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = left + width * (0.3 + (0.4 * i) / steps);
    const crossing = fragments.filter((f) => f.x0 < x && f.x1 > x).length;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  if (!best) return null;

  // Widen the best x to the full empty band and use its centre.
  const blocked = (x: number) => fragments.some((f) => f.x0 < x && f.x1 > x && !isWide(f, left, width));
  let lo = best.x;
  let hi = best.x;
  while (lo > left && !blocked(lo - 1)) lo -= 1;
  while (hi < right && !blocked(hi + 1)) hi += 1;
  const gutter = (lo + hi) / 2;

  const leftCount = fragments.filter((f) => f.x1 <= gutter).length;
  const rightCount = fragments.filter((f) => f.x0 >= gutter).length;
  const spanning = fragments.filter((f) => f.x0 < gutter && f.x1 > gutter).length;
  const sideMin = Math.min(leftCount, rightCount);
  // Two columns need real text on both sides, and most lines must stay out of the gutter.
  if (sideMin < 3 || spanning > 0.35 * (leftCount + rightCount + spanning)) return null;
  // A gutter hugging the text edge is just a ragged margin.
  if (gutter - left < 0.25 * width || right - gutter < 0.25 * width) return null;
  return gutter;
}

function isWide(f: Fragment, left: number, width: number) {
  return f.x1 - f.x0 > 0.6 * width || (f.x0 - left < 0.1 * width && f.x1 - left > 0.9 * width);
}

/** Orders fragments for reading, given an optional gutter. */
function order(fragments: Fragment[], gutter: number | null): Ordered[] {
  const byTop = (p: Fragment, q: Fragment) => q.baseline - p.baseline || p.x0 - q.x0;
  if (gutter === null) return fragments.slice().sort(byTop).map((f) => ({ ...f, column: -1 as const }));

  const spanning = fragments.filter((f) => f.x0 < gutter && f.x1 > gutter).sort(byTop);
  const leftCol = fragments.filter((f) => f.x1 <= gutter);
  const rightCol = fragments.filter((f) => f.x0 >= gutter);

  const out: Ordered[] = [];
  let upper = Infinity; // baseline of the previous spanning element
  const band = (col: Fragment[], lower: number) =>
    col.filter((f) => f.baseline < upper && f.baseline >= lower).sort(byTop);

  for (const wide of [...spanning, null]) {
    const lower = wide ? wide.baseline : -Infinity;
    out.push(...band(leftCol, lower).map((f) => ({ ...f, column: 0 as const })));
    out.push(...band(rightCol, lower).map((f) => ({ ...f, column: 1 as const })));
    if (wide) out.push({ ...wide, column: -1 });
    upper = lower;
  }
  return out;
}

type Ordered = Fragment & { column: -1 | 0 | 1 };

/**
 * Merges consecutive fragments in the same column that belong together
 * vertically: they overlap by more than half their height, or they touch and
 * are both narrow and side by side (numerator, operator line and denominator
 * of a displayed fraction). Ordinary text lines are wide, so they never merge.
 */
function mergeStacked(frags: Ordered[], columnWidth: (column: -1 | 0 | 1) => number): Line[] {
  const merged: Ordered[] = [];
  for (const f of frags) {
    const last = merged[merged.length - 1];
    if (last && last.column === f.column) {
      const overlap = Math.min(last.y1, f.y1) - Math.max(last.y0, f.y0);
      const smaller = Math.min(last.y1 - last.y0, f.y1 - f.y0);
      const size = Math.min(last.size, f.size);
      const narrow = (g: Ordered) => g.x1 - g.x0 < 0.5 * columnWidth(f.column);
      const sideBySide = Math.max(f.x0 - last.x1, last.x0 - f.x1) < 2 * size;
      const stacked = overlap > -0.35 * size && narrow(last) && narrow(f) && sideBySide;
      if (overlap > 0.5 * smaller || stacked) {
        merged[merged.length - 1] = {
          ...last,
          text: `${last.text} ${f.text}`,
          items: [...last.items, ...f.items],
          x0: Math.min(last.x0, f.x0),
          x1: Math.max(last.x1, f.x1),
          y0: Math.min(last.y0, f.y0),
          y1: Math.max(last.y1, f.y1),
        };
        continue;
      }
    }
    merged.push({ ...f });
  }
  return merged.map((f) => ({ text: f.text, bbox: [f.x0, f.y0, f.x1, f.y1], items: f.items, column: f.column }));
}

export function detectLines(items: ReadonlyArray<unknown>, options: DetectOptions = {}): PageLines {
  const fragments = buildFragments(items);
  const gutter = options.detectColumns === false ? null : findGutter(fragments);
  const ordered = order(fragments, gutter);
  // Each column's width is measured from its own fragments.
  const widths = new Map<number, number>();
  for (const column of [-1, 0, 1] as const) {
    const own = ordered.filter((f) => f.column === column);
    if (own.length) widths.set(column, Math.max(...own.map((f) => f.x1)) - Math.min(...own.map((f) => f.x0)));
  }
  const lines = mergeStacked(ordered, (column) => widths.get(column) ?? 0);
  return { lines, columns: gutter === null ? 1 : 2, gutter };
}
