import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { PageText } from "../pdf/search";
import type { PageRect } from "./types";

// Turns a text selection in the viewer into what a highlight stores: one
// rectangle per line in PDF space, the quote, and its position in the page's
// normalised text (for re-finding it in a new version of the file).

/** Rectangle in CSS pixels relative to the page's top-left corner. */
export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the viewer knows about a mounted page. */
export interface PageInfo {
  index: number;
  /** The page element; client rects are measured relative to it. */
  element: HTMLElement;
  textLayer: HTMLElement;
  viewport: PageViewport;
  /** Text layer span -> index into the page's textContent.items. */
  itemOf: Map<Element, number>;
}

/** A point in a page's text: textContent item index and UTF-16 offset in its str. */
export interface TextPoint {
  item: number;
  char: number;
}

export interface CapturedSelection {
  /** Merged per line, PDF space, possibly across pages. */
  rects: PageRect[];
  /** The selected text as displayed (whitespace collapsed, line-end hyphens joined). */
  quote: string;
  startPage: number;
  /** Start and end of the selection within the start page. */
  start: TextPoint;
  end: TextPoint;
}

/** Collapses whitespace and joins words hyphenated across a line break. */
export function cleanQuote(text: string): string {
  return text
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merges the rectangles of a selection into one per line: rectangles that
 * overlap vertically by at least half their height and are close horizontally.
 * The horizontal limit keeps the two columns of a page apart.
 */
export function mergeLineRects(rects: readonly CssRect[]): CssRect[] {
  const lines: CssRect[] = [];
  const sorted = rects.filter((r) => r.width >= 0.5 && r.height >= 0.5).sort((a, b) => a.top - b.top || a.left - b.left);
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.top + l.height, r.top + r.height) - Math.max(l.top, r.top);
      const gap = Math.max(r.left - (l.left + l.width), l.left - (r.left + r.width));
      return overlap >= 0.5 * Math.min(l.height, r.height) && gap < 1.5 * Math.max(l.height, r.height);
    });
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const right = Math.max(line.left + line.width, r.left + r.width);
    const bottom = Math.max(line.top + line.height, r.top + r.height);
    line.left = Math.min(line.left, r.left);
    line.top = Math.min(line.top, r.top);
    line.width = right - line.left;
    line.height = bottom - line.top;
  }
  return lines;
}

/**
 * Offset in the normalised page text of a text point. "start" gives the first
 * character at or after it, "end" the position just after the last character
 * before it.
 */
export function textOffset(page: PageText, point: TextPoint, side: "start" | "end"): number {
  const before = (src: [number, number]) => src[0] < point.item || (src[0] === point.item && src[1] < point.char);
  if (side === "start") {
    const i = page.source.findIndex((src) => src !== null && !before(src));
    return i === -1 ? page.text.length : i;
  }
  for (let i = page.source.length - 1; i >= 0; i--) {
    const src = page.source[i];
    if (src !== null && before(src)) return i + 1;
  }
  return 0;
}

const CONTEXT = 32;

/** Quote position and surrounding text, for re-finding the quote later. */
export function textAnchor(page: PageText, start: TextPoint, end: TextPoint) {
  const textStart = textOffset(page, start, "start");
  const textEnd = Math.max(textStart, textOffset(page, end, "end"));
  return {
    textStart,
    textEnd,
    prefix: page.text.slice(Math.max(0, textStart - CONTEXT), textStart),
    suffix: page.text.slice(textEnd, textEnd + CONTEXT),
  };
}

/**
 * Merges rectangles into lines in PDF space, where text runs left to right
 * even on pages displayed rotated (/Rotate 90 tables).
 */
export function mergeInPdfSpace(rects: ReadonlyArray<[number, number, number, number]>): Array<[number, number, number, number]> {
  // Flip y so "top" grows downwards as mergeLineRects expects.
  const flipped = rects.map(([x0, y0, x1, y1]) => ({ left: x0, top: -y1, width: x1 - x0, height: y1 - y0 }));
  return mergeLineRects(flipped).map((r) => [r.left, -(r.top + r.height), r.left + r.width, -r.top]);
}

/** Converts a page-relative CSS rectangle to PDF space. */
export function cssToPdf(viewport: PageViewport, r: CssRect): [number, number, number, number] {
  const [ax, ay] = viewport.convertToPdfPoint(r.left, r.top);
  const [bx, by] = viewport.convertToPdfPoint(r.left + r.width, r.top + r.height);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

function spanOf(node: Node, textLayer: HTMLElement): Element | null {
  const el = node.parentElement;
  return el && el !== textLayer && textLayer.contains(el) ? el : null;
}

/** Reads the current selection off the mounted pages' text layers. */
export function captureSelection(range: Range, pages: readonly PageInfo[]): CapturedSelection | null {
  const rects: PageRect[] = [];
  let startPage = -1;
  let start: TextPoint | null = null;
  let end: TextPoint | null = null;
  const parts: string[] = [];

  for (const page of [...pages].sort((a, b) => a.index - b.index)) {
    if (!range.intersectsNode(page.textLayer)) continue;
    const origin = page.element.getBoundingClientRect();
    const pageRects: CssRect[] = [];
    const walker = document.createTreeWalker(page.textLayer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(node)) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (from >= to) continue;
      const span = spanOf(node, page.textLayer);
      const item = span ? page.itemOf.get(span) : undefined;
      if (item === undefined) continue;

      const piece = document.createRange();
      piece.setStart(node, from);
      piece.setEnd(node, to);
      for (const r of piece.getClientRects()) {
        pageRects.push({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
      }
      // Items join without a space unless a line ends, as in buildPageText.
      parts.push(node.data.slice(from, to) + (span?.nextSibling?.nodeName === "BR" && to === node.length ? "\n" : ""));

      if (startPage === -1) {
        startPage = page.index;
        start = { item, char: from };
      }
      if (page.index === startPage) end = { item, char: to };
    }
    for (const r of mergeInPdfSpace(pageRects.map((r) => cssToPdf(page.viewport, r)))) rects.push([page.index, ...r]);
    if (pageRects.length) parts.push("\n");
  }

  if (!start || !end || rects.length === 0) return null;
  const quote = cleanQuote(parts.join(""));
  return quote ? { rects, quote, startPage, start, end } : null;
}
