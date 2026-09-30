import { matchRects, normaliseQuery, type PageText, type TextItemLike } from "../pdf/search";
import type { Annotation, Placement } from "./types";

// Places an annotation made on one version of a PDF onto another version.
//
//   1. The page's text is unchanged (same hash): keep the geometry (exact).
//   2. Otherwise find the quote in the new text, trying pages nearest the old
//      one first. Matching prefix and suffix too means it's the same passage
//      (moved); a quote found with different surroundings may be another
//      occurrence (fuzzy).
//   3. Otherwise it's an orphan: kept, listed in the sidebar, never dropped.
//
// Quotes that run across a page break are not re-found yet (they become
// orphans).

export interface PageSource {
  text: PageText;
  items: ReadonlyArray<TextItemLike | { type: string }>;
  /** Hash of text.text (see pageHash). */
  hash: string;
}

/** Number of characters that agree, counting from the end (prefix) or start (suffix). */
function agreement(expected: string, actual: string, fromEnd: boolean): number {
  let n = 0;
  const len = Math.min(expected.length, actual.length);
  while (n < len) {
    const e = fromEnd ? expected[expected.length - 1 - n] : expected[n];
    const a = fromEnd ? actual[actual.length - 1 - n] : actual[n];
    if (e !== a) break;
    n++;
  }
  return n;
}

export function orphan(page: number): Placement {
  return { page, geometry: { rects: [] }, textStart: null, textEnd: null, status: "orphan" };
}

export async function reanchor(
  a: Pick<Annotation, "quote" | "prefix" | "suffix" | "fallback">,
  pageCount: number,
  load: (page: number) => Promise<PageSource>,
): Promise<Placement> {
  const old = a.fallback?.placement ?? null;
  const origin = old ? Math.min(old.page, pageCount - 1) : 0;

  if (old && old.page < pageCount && a.fallback?.pageHash) {
    const source = await load(old.page);
    // Same text in the same place, so the same geometry. It is only as sure
    // as the placement it copies (a fuzzy one stays fuzzy).
    if (source.hash === a.fallback.pageHash) return { ...old, status: old.status === "fuzzy" ? "fuzzy" : "exact" };
  }

  const quote = a.quote ? normaliseQuery(a.quote) : "";
  if (!quote) {
    // Areas and ink have no text to search for: keep them where they were,
    // flagged, as long as that page still exists.
    return old && old.page < pageCount ? { ...old, status: "fuzzy" } : orphan(origin);
  }

  const prefix = a.prefix ?? "";
  const suffix = a.suffix ?? "";
  const order = Array.from({ length: pageCount }, (_, i) => i).sort(
    (x, y) => Math.abs(x - origin) - Math.abs(y - origin) || x - y,
  );
  let best: { page: number; start: number; score: number; source: PageSource } | null = null;
  const perfect = prefix.length + suffix.length;

  for (const page of order) {
    const source = await load(page);
    const text = source.text.text;
    for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
      const score =
        agreement(prefix, text.slice(Math.max(0, start - prefix.length), start), true) +
        agreement(suffix, text.slice(start + quote.length, start + quote.length + suffix.length), false);
      if (!best || score > best.score) best = { page, start, score, source };
    }
    if (best && best.score === perfect) break;
  }

  if (!best) return orphan(origin);
  const end = best.start + quote.length;
  const rects = matchRects(best.source.text, best.source.items, { page: best.page, start: best.start, end });
  return {
    page: best.page,
    geometry: { rects: rects.map((r) => [best.page, ...r]) },
    textStart: best.start,
    textEnd: end,
    // Context that matches at least half-way on average counts as the same passage.
    status: best.score >= perfect / 2 ? "moved" : "fuzzy",
  };
}
