// Annotations other programs saved in the PDF (Okular, Acrobat, Zotero…),
// turned into Tourmaline annotations (decision 4: imported annotations are
// Tourmaline's own from then on). Text markup becomes highlights with the
// quote under them, sticky notes become notes, squares and circles become
// area captures. Ink waits for Tourmaline's own ink (phase 7) and is left
// drawn by pdf.js. Each is imported once per paper, keyed by its /NM name
// (read in Rust, as pdf.js doesn't expose it) or else its position.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageText, PdfRect, TextItemLike } from "../pdf/search";
import { getPageHash, getPageText } from "../pdf/textCache";
import { cleanQuote } from "./selection";
import type { AnnotationKind, Category, NewAnnotation, PageRect } from "./types";

/** The parts of pdf.js's annotation data used here. */
export interface PdfAnnotationData {
  id: string;
  subtype: string;
  rect: number[];
  /** Per quad: [x0, y1, x1, y1, x0, y0, x1, y0] (pdf.js normalises them). */
  quadPoints?: ArrayLike<number> | null;
  /** RGB, 0-255. */
  color?: ArrayLike<number> | null;
  contentsObj?: { str: string } | null;
  titleObj?: { str: string } | null;
  inReplyTo?: string | null;
  creationDate?: string | null;
  modificationDate?: string | null;
}

export interface FoundAnnotation {
  /** pdf.js's id (object reference), to stop pdf.js drawing it. */
  pdfId: string;
  /** Stored as `source_nm`: "nm:<name>", or "pos:<subtype>:<page>:<rect>" without a name. */
  key: string;
  kind: AnnotationKind;
  page: number;
  rects: PdfRect[];
  /** #rrggbb */
  colour: string | null;
  note: string;
  created: number | null;
}

const KINDS: Record<string, AnnotationKind> = {
  Highlight: "highlight",
  Underline: "highlight",
  StrikeOut: "highlight",
  Squiggly: "highlight",
  Text: "note",
  FreeText: "note",
  Square: "area",
  Circle: "area",
};

const hex = (rgb: ArrayLike<number>) =>
  "#" + Array.from(rgb, (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** A PDF date ("D:20250227173006-08'00'") as Unix ms; null if unreadable. */
export function pdfDate(s: string | null | undefined): number | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s ?? "");
  if (!m) return null;
  const n = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));
  const utc = Date.UTC(n(m[1], 0), n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0));
  const offset = (n(m[8], 0) * 60 + n(m[9], 0)) * 60_000;
  const t = m[7] === "+" ? utc - offset : m[7] === "-" ? utc + offset : utc;
  return Number.isFinite(t) ? t : null;
}

function rectsOf(a: PdfAnnotationData): PdfRect[] {
  const q = a.quadPoints;
  if (q && q.length >= 8) {
    const rects: PdfRect[] = [];
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
      const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
    return rects;
  }
  const [x0, y0, x1, y1] = a.rect;
  return [[Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]];
}

/**
 * The annotations of the pages given that Tourmaline can take over. Replies
 * (an annotation "in reply to" another, as Okular and Acrobat make them) are
 * added to the note of the one they answer.
 */
export function collectAnnotations(
  pages: ReadonlyArray<{ page: number; annotations: readonly PdfAnnotationData[] }>,
  names: ReadonlyMap<string, string>,
): FoundAnnotation[] {
  const replies = new Map<string, string[]>();
  for (const { annotations } of pages) {
    for (const a of annotations) {
      const text = a.contentsObj?.str.trim();
      if (!a.inReplyTo || !text) continue;
      const author = a.titleObj?.str.trim();
      replies.set(a.inReplyTo, [...(replies.get(a.inReplyTo) ?? []), author ? `${author}: ${text}` : text]);
    }
  }
  const found: FoundAnnotation[] = [];
  // Two annotations can share a name (copied in some programs) or, unnamed,
  // a place: later ones get "~2", "~3"... so each has its own key.
  const seen = new Map<string, number>();
  for (const { page, annotations } of pages) {
    for (const a of annotations) {
      const kind = KINDS[a.subtype];
      if (!kind || a.inReplyTo) continue;
      const rects = rectsOf(a);
      const name = names.get(a.id);
      const where = a.rect.map((v) => Math.round(v)).join(",");
      const note = [a.contentsObj?.str.trim() ?? "", ...(replies.get(a.id) ?? [])].filter(Boolean).join("\n\n");
      const base = name ? `nm:${name}` : `pos:${a.subtype}:${page}:${where}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      found.push({
        pdfId: a.id,
        key: n === 1 ? base : `${base}~${n}`,
        kind,
        page,
        rects,
        colour: a.color && a.color.length === 3 ? hex(a.color) : null,
        note,
        created: pdfDate(a.creationDate) ?? pdfDate(a.modificationDate),
      });
    }
  }
  return found;
}

/** Every page's annotations that Tourmaline can import. */
export async function findPdfAnnotations(pdf: PDFDocumentProxy, names: ReadonlyMap<string, string>): Promise<FoundAnnotation[]> {
  const pages = [];
  for (let page = 0; page < pdf.numPages; page++) {
    const p = await pdf.getPage(page + 1);
    pages.push({ page, annotations: (await p.getAnnotations({ intent: "display" })) as PdfAnnotationData[] });
  }
  return collectAnnotations(pages, names);
}

// ---- The text under a highlight ----------------------------------------------

/** Where a character of a text item sits (its centre), estimated from the item's width as search.ts does. */
function charCentre(item: TextItemLike, char: number): [number, number] {
  const [a, b, c, d, e, f] = item.transform;
  const len = item.str.length || 1;
  const run = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const height = item.height || up || 10;
  const along = (item.width * (char + 0.5)) / len;
  const lift = 0.3 * height;
  return [e + (a / run) * along + (c / up) * lift, f + (b / run) * along + (d / up) * lift];
}

const CONTEXT = 32;

/**
 * The text a highlight covers: the characters whose centres fall in its
 * rectangles, from the first to the last in reading order. Null if none do
 * (a highlight over an image, say).
 */
export function textUnderRects(page: PageText, items: ReadonlyArray<TextItemLike | { type: string }>, rects: readonly PdfRect[]) {
  const inside = ([x, y]: [number, number]) =>
    rects.some(([x0, y0, x1, y1]) => x >= x0 - 0.5 && x <= x1 + 0.5 && y >= y0 - 0.5 && y <= y1 + 0.5);
  let start = -1;
  let end = -1;
  page.source.forEach((src, i) => {
    if (!src) return;
    const item = items[src[0]] as TextItemLike;
    if (inside(charCentre(item, src[1]))) {
      if (start === -1) start = i;
      end = i + 1;
    }
  });
  if (start === -1) return null;
  // The quote as printed (page text is folded for search): each source character once.
  let quote = "";
  let last: [number, number] | null = null;
  for (let i = start; i < end; i++) {
    const src = page.source[i];
    if (!src) quote += " ";
    else if (!last || last[0] !== src[0] || last[1] !== src[1]) {
      const str = (items[src[0]] as TextItemLike).str;
      quote += String.fromCodePoint(str.codePointAt(src[1]) ?? 32);
    }
    last = src;
  }
  return {
    textStart: start,
    textEnd: end,
    quote: cleanQuote(quote),
    prefix: page.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: page.text.slice(end, end + CONTEXT),
  };
}

/** Hue (degrees), saturation and lightness (0-1) of #rrggbb. */
function hsl(colour: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * The category closest in colour to the annotation's: by hue (people think of
 * "the green one"), unless one of them is a grey.
 */
export function nearestCategory(colour: string | null, categories: readonly Category[]): Category | undefined {
  const live = categories.filter((c) => !c.deleted);
  if (!colour) return live[0];
  const [h, s, l] = hsl(colour);
  let best: Category | undefined;
  let bestDistance = Infinity;
  for (const c of live) {
    const [ch, cs, cl] = hsl(c.colour);
    const grey = s < 0.15 || cs < 0.15;
    const hue = Math.min(Math.abs(h - ch), 360 - Math.abs(h - ch)) / 180;
    const d = (grey ? 1 : 4 * hue) + Math.abs(s - cs) * 0.5 + Math.abs(l - cl);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/** Text reduced to its letters and digits, for comparing a note with the quote it may repeat. */
function fold(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    // A word broken across lines: "hyphen-\nated".
    .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Whether some text is the quote again. Acrobat, Zotero, Foxit and others
 * store a highlight's text as its /Contents; that isn't a note. Their
 * selection and ours can differ at the edges: the text may be a little
 * shorter than the quote (a word less), but only a stray letter or two
 * longer, since more may be the user's own words added after it.
 */
export function repeatsQuote(text: string, quote: string): boolean {
  const t = fold(text);
  const q = fold(quote);
  if (!t || !q) return false;
  if (t.length <= q.length) return q.includes(t) && t.length >= 0.9 * q.length;
  return t.includes(q) && t.length - q.length <= 2;
}

/**
 * A highlight's imported note without the leading paragraphs that only
 * repeat its quote (replies after them stay). Unchanged if it doesn't
 * start with the quote.
 */
export function withoutRepeatedQuote(note: string, quote: string | null): string {
  if (!quote || !note.trim()) return note;
  const paragraphs = note.split(/\n\s*\n/);
  // Shortest first, so a short reply isn't taken for the quote's last words.
  for (let k = 1; k <= paragraphs.length; k++) {
    if (repeatsQuote(paragraphs.slice(0, k).join("\n"), quote)) {
      return paragraphs.slice(k).join("\n\n").trim();
    }
  }
  return note;
}

/** What to store for each found annotation. */
export async function toNewAnnotations(
  pdf: PDFDocumentProxy,
  ids: { workId: string; fileId: string },
  found: readonly FoundAnnotation[],
  categories: readonly Category[],
): Promise<NewAnnotation[]> {
  const list: NewAnnotation[] = [];
  for (const f of found) {
    const geometry = { rects: f.rects.map((r) => [f.page, ...r] as PageRect) };
    let text = null;
    if (f.kind === "highlight") {
      const { text: pageText, content } = await getPageText(pdf, f.page);
      text = textUnderRects(pageText, content.items, f.rects);
    }
    list.push({
      ...ids,
      kind: f.kind,
      categoryId: nearestCategory(f.colour, categories)?.id ?? null,
      colour: null,
      note: f.kind === "highlight" ? withoutRepeatedQuote(f.note, text?.quote ?? null) : f.note,
      quote: text?.quote ?? null,
      prefix: text?.prefix ?? null,
      suffix: text?.suffix ?? null,
      placement: {
        page: f.page,
        geometry,
        textStart: text?.textStart ?? null,
        textEnd: text?.textEnd ?? null,
        status: "exact",
        pdfRef: f.pdfId,
      },
      pageHashes: [{ page: f.page, hash: await getPageHash(pdf, f.page) }],
      sourceNm: f.key,
      created: f.created,
    });
  }
  return list;
}
