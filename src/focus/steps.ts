// Focus mode's steps: what is lit up at a time, in reading order. A step is
// one to three lines, or one sentence, of the lines found by lines.ts
// (formulas already count as one line). A figure or table is a step of its
// own: the empty band beside its caption ("Figure 2: …"), where the
// drawing is. Lines are grouped within one block (column, page, same type
// size); a sentence runs on across columns and pages, as the text does.
// Lone page numbers are skipped.
//
// Pure functions over plain data, so the logic is tested without pdf.js.

import type { PageRect } from "../annotations/types";
import type { PdfRect, TextItemLike } from "../pdf/search";
import type { Line } from "./lines";

export type StepUnit = 1 | 2 | 3 | "sentence";

export interface Step {
  /** Where it is: [page, x0, y0, x1, y1] in PDF space, in reading order. */
  rects: PageRect[];
  text: string;
  /** "figure": the drawing above or below a caption. */
  kind: "text" | "figure";
}

export interface FocusPage {
  /** 0-based. */
  page: number;
  lines: readonly Line[];
  /** The page's text items (for where each character of a line is). */
  items: ReadonlyArray<unknown>;
  /** /Rotate: on rotated pages a sentence lights up whole lines. */
  rotation: number;
  /** Top of the page in PDF space (for a figure at the top of a page). */
  top?: number;
}

type Unit = { page: number; line: Line } | { page: number; figure: PdfRect };

const heightOf = (l: Line) => l.bbox[3] - l.bbox[1];
const widthOf = (l: Line) => l.bbox[2] - l.bbox[0];

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

const CAPTION = /^(fig(ure)?|table|tab|algorithm|listing|scheme|chart|plate)\.?\s*[\dIVX]/i;
const PAGE_NUMBER = /^(\d{1,4}|[ivxlc]{1,7})$/i;

/** What a page's lines look like: typical height, line gap and column extents. */
interface PageShape {
  lineHeight: number;
  lineGap: number;
  extent(column: Line["column"]): [number, number];
}

function shape(lines: readonly Line[]): PageShape {
  const gaps: number[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (prev && prev.column === l.column && prev.bbox[1] > l.bbox[3]) gaps.push(prev.bbox[1] - l.bbox[3]);
  });
  return {
    lineHeight: median(lines.map(heightOf)),
    lineGap: median(gaps),
    extent(column) {
      const own = lines.filter((l) => l.column === column);
      const list = own.length ? own : lines;
      return [Math.min(...list.map((l) => l.bbox[0])), Math.max(...list.map((l) => l.bbox[2]))];
    },
  };
}

/**
 * The band a caption labels: the empty space between it and the nearest
 * line above (figures) or below (tables) that it lines up with. Null if
 * there is no such space.
 */
function figureBand(p: FocusPage, lines: readonly Line[], caption: Line, s: PageShape): { rect: PdfRect; above: boolean } | null {
  const [x0, x1] = caption.column === -1 ? s.extent(-1) : s.extent(caption.column);
  const across = (l: Line) => l !== caption && l.bbox[0] < x1 && l.bbox[2] > x0;
  const minimum = 3 * s.lineHeight;
  const tryAbove = () => {
    const above = lines.filter((l) => across(l) && l.bbox[1] >= caption.bbox[3]);
    const limit = above.length ? Math.min(...above.map((l) => l.bbox[1])) : (p.top ?? -Infinity) * 0.93;
    return limit - caption.bbox[3] > minimum ? { rect: [x0, caption.bbox[3], x1, limit] as PdfRect, above: true } : null;
  };
  const tryBelow = () => {
    const below = lines.filter((l) => across(l) && l.bbox[3] <= caption.bbox[1]);
    if (!below.length) return null;
    const limit = Math.max(...below.map((l) => l.bbox[3]));
    return caption.bbox[1] - limit > minimum ? { rect: [x0, limit, x1, caption.bbox[1]] as PdfRect, above: false } : null;
  };
  // Figure captions go below the figure, table captions above the table.
  return /^tab/i.test(caption.text.trim()) ? (tryBelow() ?? tryAbove()) : (tryAbove() ?? tryBelow());
}

/** A page's lines in reading order, page numbers left out, figures beside their captions. */
function units(p: FocusPage): Unit[] {
  const lines = p.lines.filter(
    (l, i) => !(PAGE_NUMBER.test(l.text.trim()) && (i === 0 || i === p.lines.length - 1)),
  );
  const s = shape(lines);
  const out: Unit[] = [];
  const after = new Map<Line, PdfRect>();
  for (const line of lines) {
    if (CAPTION.test(line.text.trim())) {
      const band = figureBand(p, lines, line, s);
      if (band?.above) out.push({ page: p.page, figure: band.rect });
      else if (band) after.set(line, band.rect);
    }
    out.push({ page: p.page, line });
    const below = after.get(line);
    if (below) out.push({ page: p.page, figure: below });
  }
  return out;
}

/**
 * Whether a new block starts at `b` after `a` on the same page: a change of
 * type size (a title, a heading), or more space between them than between
 * lines (a heading, a display).
 */
function newBlock(a: Line, b: Line, s: PageShape): boolean {
  const ratio = heightOf(a) / heightOf(b);
  if (ratio > 1.15 || ratio < 1 / 1.15) return true;
  if (a.column !== b.column) return true;
  const gap = a.bbox[1] - b.bbox[3];
  return gap > Math.max(1.6 * s.lineGap, s.lineGap + 0.4 * s.lineHeight);
}

const rectOf = (page: number, [x0, y0, x1, y1]: PdfRect): PageRect => [page, x0, y0, x1, y1];

/** Steps of `count` lines from one block; a figure always alone. */
function lineSteps(pages: readonly FocusPage[], count: number): Step[] {
  const steps: Step[] = [];
  let group: Line[] = [];
  let groupPage = -1;
  const flush = () => {
    if (group.length) {
      steps.push({ rects: group.map((l) => rectOf(groupPage, l.bbox)), text: group.map((l) => l.text).join(" "), kind: "text" });
    }
    group = [];
  };
  for (const p of pages) {
    const s = shape(p.lines);
    for (const u of units(p)) {
      if ("figure" in u) {
        flush();
        steps.push({ rects: [rectOf(u.page, u.figure)], text: "", kind: "figure" });
        continue;
      }
      const last = group[group.length - 1];
      if (last && (groupPage !== u.page || newBlock(last, u.line, s))) flush();
      groupPage = u.page;
      group.push(u.line);
      if (group.length === count) flush();
    }
    flush();
  }
  return steps;
}

// ---- Sentences ------------------------------------------------------------------

interface Char {
  ch: string;
  /** Null for a space put between lines. */
  at: { page: number; line: Line; x0: number; x1: number } | null;
}

const isText = (item: unknown): item is TextItemLike => typeof (item as TextItemLike)?.str === "string";

/** A line's characters with where each sits across the line (estimated within each text item). */
function lineChars(p: FocusPage, line: Line): Char[] {
  const whole = p.rotation % 360 !== 0;
  const out: Char[] = [];
  let lastX1: number | null = null;
  for (const index of line.items) {
    const item = p.items[index];
    if (!isText(item)) continue;
    const x = item.transform[4];
    const width = Math.max(item.width, 0);
    const chars = [...item.str];
    // A visible gap between items is a space, as in the line's own text.
    if (lastX1 !== null && x - lastX1 > 0.15 * (item.height || 10) && out.length && out[out.length - 1].ch !== " ") {
      out.push({ ch: " ", at: { page: p.page, line, x0: lastX1, x1: x } });
    }
    chars.forEach((ch, i) => {
      const x0 = whole ? line.bbox[0] : x + (width * i) / chars.length;
      const x1 = whole ? line.bbox[2] : x + (width * (i + 1)) / chars.length;
      out.push({ ch, at: { page: p.page, line, x0, x1 } });
    });
    lastX1 = x + width;
  }
  return out;
}

// Words after which a full stop doesn't end a sentence.
const ABBREVIATIONS = new Set(
  (
    "al e.g eg i.e ie cf vs viz etc fig figs eq eqs sec secs ch chap thm def defn prop lem cor no nos p pp vol ed eds " +
    "approx resp ref refs dr prof mr mrs ms st jr sr inc ltd co dept univ ca ex"
  ).split(" "),
);

/** Whether the full stop at `i` ends a sentence: not after an abbreviation or an initial. */
function endsSentence(text: string, i: number): boolean {
  if (text[i] !== ".") return true;
  const word = /([\p{L}.]+)\.$/u.exec(text.slice(Math.max(0, i - 12), i + 1))?.[1] ?? "";
  if (ABBREVIATIONS.has(word.toLowerCase().replace(/\.$/, ""))) return false;
  // "A. Bacon": a single capital letter is an initial.
  return !/^\p{Lu}$/u.test(word);
}

/** Where sentences end in a stream of text: the index just after each. */
function sentenceEnds(text: string, hardBreaks: ReadonlySet<number>): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (hardBreaks.has(i)) {
      ends.push(i);
      continue;
    }
    if (!/[.?!]/.test(text[i])) continue;
    // Closing quotes and brackets belong to the sentence.
    let j = i + 1;
    while (j < text.length && /["'”’)\]]/.test(text[j])) j++;
    if (j < text.length && text[j] !== " ") continue;
    const next = /\S/.exec(text.slice(j));
    const startsNext = !next || /[\p{Lu}\p{N}"'“‘(\[]/u.test(next[0]);
    if (startsNext && endsSentence(text, i)) ends.push(j);
  }
  ends.push(text.length);
  return ends;
}

/**
 * Whether a sentence ends after line `a` without a full stop: a title or
 * heading, i.e. a new block whose first line starts with a capital and
 * whose previous line doesn't end mid-sentence.
 */
function headingBreak(a: Line, b: Line | undefined, s: PageShape): boolean {
  if (!b) return false;
  const text = a.text.trim();
  if (/[,;:\-–—]$/.test(text) || !/^[\p{Lu}\p{N}"“(\[]/u.test(b.text.trim())) return false;
  return newBlock(a, b, s) || (widthOf(a) < 0.7 * (s.extent(a.column)[1] - s.extent(a.column)[0]) && /^[\p{Lu}\p{N}]/u.test(text) && !/[.?!]$/.test(text) && !/[=+<>∑∫]/.test(text));
}

function sentenceSteps(pages: readonly FocusPage[]): Step[] {
  const steps: Step[] = [];
  let stream: Char[] = [];
  const breaks = new Set<number>();
  const flush = () => {
    const text = stream.map((c) => c.ch).join("");
    let start = 0;
    for (const end of sentenceEnds(text, breaks)) {
      const chars = stream.slice(start, end);
      start = end;
      const sentence = chars.map((c) => c.ch).join("").replace(/\s+/g, " ").trim();
      if (!sentence) continue;
      // One rectangle per line the sentence touches.
      const rects: PageRect[] = [];
      let current: { line: Line; rect: PageRect } | null = null;
      for (const c of chars) {
        if (!c.at || (c.ch === " " && current?.line !== c.at.line)) continue;
        if (current && current.line === c.at.line) {
          current.rect[1] = Math.min(current.rect[1], c.at.x0);
          current.rect[3] = Math.max(current.rect[3], c.at.x1);
        } else {
          const [, y0, , y1] = c.at.line.bbox;
          current = { line: c.at.line, rect: [c.at.page, c.at.x0, y0, c.at.x1, y1] };
          rects.push(current.rect);
        }
      }
      if (rects.length) steps.push({ rects, text: sentence, kind: "text" });
    }
    stream = [];
    breaks.clear();
  };

  for (const p of pages) {
    const s = shape(p.lines);
    const pageUnits = units(p);
    pageUnits.forEach((u, k) => {
      if ("figure" in u) {
        flush();
        steps.push({ rects: [rectOf(u.page, u.figure)], text: "", kind: "figure" });
        return;
      }
      const chars = lineChars(p, u.line);
      if (!chars.length) return;
      if (stream.length) {
        const last = stream[stream.length - 1];
        const before = stream[stream.length - 2];
        // "hyphen-" + "ated": one word again.
        if (last.ch === "-" && before && /\p{L}/u.test(before.ch) && /^\p{Ll}/u.test(chars[0].ch)) stream.pop();
        else stream.push({ ch: " ", at: null });
      }
      stream.push(...chars);
      const next = pageUnits[k + 1];
      if (next && "line" in next && headingBreak(u.line, next.line, s)) breaks.add(stream.length);
    });
  }
  flush();
  return steps;
}

/** The steps of a document for a step unit. */
export function buildSteps(pages: readonly FocusPage[], unit: StepUnit): Step[] {
  return unit === "sentence" ? sentenceSteps(pages) : lineSteps(pages, unit);
}

/**
 * The step to start from at a point of a page (where the reader's eye is):
 * the first on that page, in reading order, whose top is at or below the
 * point; else the first after the page.
 */
export function stepAt(steps: readonly Step[], page: number, y: number): number {
  const i = steps.findIndex((s) => s.rects.some(([p, , , , y1]) => p === page && y1 <= y + 2));
  if (i !== -1) return i;
  const after = steps.findIndex((s) => s.rects[0][0] > page);
  return after === -1 ? Math.max(0, steps.length - 1) : after;
}

/** The step a click on a page lands on, or -1. */
export function stepUnder(steps: readonly Step[], page: number, x: number, y: number): number {
  return steps.findIndex((s) =>
    s.rects.some(([p, x0, y0, x1, y1]) => p === page && x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2),
  );
}
