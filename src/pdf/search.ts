// Full-text search over pdf.js text content. Kept free of React and the DOM so
// it can be unit-tested with hand-made text items.
//
// Page text is normalised so searches match what a reader sees rather than how
// the PDF encodes it: ligatures (ﬁ → fi), accents (Gödel → godel), case, runs
// of whitespace, and words hyphenated across a line break.

/** The subset of pdf.js's TextItem this module uses. */
export interface TextItemLike {
  str: string;
  /** [a, b, c, d, e, f]: e, f is the baseline origin in PDF user space. */
  transform: number[];
  /** Advance width of the whole string in PDF user space. */
  width: number;
  height: number;
  hasEOL: boolean;
}

/** Normalised text of one page plus, for each character, where it came from. */
export interface PageText {
  text: string;
  /** For each char of `text`: [item index, char index in item.str], or null for inserted spaces. */
  source: Array<[number, number] | null>;
}

/** PDF-space rectangle [x0, y0, x1, y1], y upwards. */
export type PdfRect = [number, number, number, number];

export interface Match {
  page: number;
  start: number;
  end: number;
}

function foldChar(c: string): string {
  return c
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Normalises a search query the same way page text is normalised. */
export function normaliseQuery(query: string): string {
  return [...query]
    .map(foldChar)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPageText(items: ReadonlyArray<TextItemLike | { type: string }>): PageText {
  let text = "";
  const source: PageText["source"] = [];
  const pushSpace = () => {
    if (text.length > 0 && !text.endsWith(" ")) {
      text += " ";
      source.push(null);
    }
  };

  items.forEach((raw, itemIndex) => {
    if (!("str" in raw)) return; // marked-content boundaries
    const item = raw as TextItemLike;
    const chars = [...item.str];
    // "hyph-" at the end of a line followed by more text: join without the hyphen.
    const hyphenated = item.hasEOL && /\p{L}-$/u.test(item.str);
    let charIndex = 0;
    chars.forEach((c, i) => {
      const isDroppedHyphen = hyphenated && i === chars.length - 1;
      if (!isDroppedHyphen) {
        if (/\s/.test(c)) {
          pushSpace();
        } else {
          for (const out of foldChar(c)) {
            text += out;
            source.push([itemIndex, charIndex]);
          }
        }
      }
      charIndex += c.length; // index in UTF-16 units of item.str
    });
    if (item.hasEOL && !hyphenated) pushSpace();
  });

  return { text: text.trimEnd(), source: source.slice(0, text.trimEnd().length) };
}

export function findInPage(page: PageText, pageIndex: number, query: string): Match[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const matches: Match[] = [];
  let from = 0;
  for (;;) {
    const start = page.text.indexOf(q, from);
    if (start === -1) break;
    matches.push({ page: pageIndex, start, end: start + q.length });
    from = start + 1;
  }
  return matches;
}

/**
 * Rectangles covering a match, one per text item it touches. Character
 * positions within an item are estimated proportionally from its width, which
 * is close enough for highlighting.
 */
export function matchRects(page: PageText, items: ReadonlyArray<TextItemLike | { type: string }>, match: Match): PdfRect[] {
  const byItem = new Map<number, [number, number]>();
  for (let i = match.start; i < match.end; i++) {
    const src = page.source[i];
    if (!src) continue;
    const [item, char] = src;
    const range = byItem.get(item);
    byItem.set(item, range ? [Math.min(range[0], char), Math.max(range[1], char + 1)] : [char, char + 1]);
  }

  const rects: PdfRect[] = [];
  for (const [itemIndex, [c0, c1]] of byItem) {
    const item = items[itemIndex] as TextItemLike;
    const len = item.str.length || 1;
    const [a, b, c, d, e, f] = item.transform;
    const fontHeight = item.height || Math.hypot(c, d) || 10;
    // Text runs along (a, b) from the origin (e, f), with "up" along (c, d);
    // using the vectors rather than x/y keeps rotated text right.
    const runLength = Math.hypot(a, b) || 1;
    const upLength = Math.hypot(c, d) || 1;
    const [ux, uy] = [a / runLength, b / runLength];
    const [vx, vy] = [c / upLength, d / upLength];
    const along0 = (item.width * c0) / len;
    const along1 = (item.width * c1) / len;
    // Cover descenders and ascenders around the baseline.
    const corners = [along0, along1].flatMap((t) =>
      [-0.25 * fontHeight, 0.85 * fontHeight].map((h) => [e + ux * t + vx * h, f + uy * t + vy * h]),
    );
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return rects;
}
