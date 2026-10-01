import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight } from "./PdfViewer";
import { findInPage, matchRects, normaliseQuery, type PdfRect } from "./search";
import { getPageText } from "./textCache";

export interface FoundMatch {
  page: number;
  /** Where it is in the page's normalised text (buildPageText). */
  start: number;
  end: number;
  rects: PdfRect[];
}

export type SearchStatus = "idle" | "searching" | "done";

const DEBOUNCE_MS = 200;
/** Publish results every this many pages so long books show hits early. */
const BATCH_PAGES = 16;

/**
 * Searches a document page by page in the background. A new query cancels the
 * previous search. The first match at or after `fromPage` becomes active.
 * Matches are returned in document order.
 */
export function useDocumentSearch(doc: PDFDocumentProxy | null, fromPage: number) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FoundMatch[]>([]);
  // Tracked by identity: matches from before `fromPage` arrive later and are
  // inserted ahead of it, which would shift an index.
  const [activeMatch, setActiveMatch] = useState<FoundMatch | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const fromPageRef = useRef(fromPage);
  fromPageRef.current = fromPage;

  useEffect(() => {
    setMatches([]);
    setActiveMatch(null);
    if (!doc || !normaliseQuery(query)) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("searching");
    const timer = setTimeout(async () => {
      // Search from the current page to the end, then wrap around, so the
      // match the reader most likely wants is found first.
      const start = Math.min(Math.max(fromPageRef.current, 0), doc.numPages - 1);
      const order = [...Array(doc.numPages).keys()].map((i) => (start + i) % doc.numPages);
      const byPage = new Map<number, FoundMatch[]>();
      let chosen = false;
      for (const [n, page] of order.entries()) {
        if (cancelled) return;
        try {
          const { text, content } = await getPageText(doc, page);
          const found = findInPage(text, page, query).map((m) => ({ page, start: m.start, end: m.end, rects: matchRects(text, content.items, m) }));
          if (found.length) byPage.set(page, found);
          if (!chosen && found.length) {
            chosen = true;
            setActiveMatch(found[0]);
            // Publish straight away so the first hit is counted and highlighted.
            setMatches([...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p)!));
          }
        } catch {
          // Unreadable page: skip it rather than abandon the search.
        }
        if (cancelled) return;
        if ((n + 1) % BATCH_PAGES === 0 || n === order.length - 1) {
          setMatches([...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p)!));
        }
      }
      if (!cancelled) setStatus("done");
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, query]);

  const active = activeMatch ? matches.indexOf(activeMatch) : -1;

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const i = activeMatch ? matches.indexOf(activeMatch) : -1;
      setActiveMatch(matches[i === -1 ? 0 : (i + direction + matches.length) % matches.length]);
    },
    [matches, activeMatch],
  );

  const highlights = useMemo(() => {
    const byPage = new Map<number, Highlight[]>();
    for (const m of matches) {
      const list = byPage.get(m.page) ?? [];
      list.push({ rects: m.rects, active: m === activeMatch });
      byPage.set(m.page, list);
    }
    return byPage;
  }, [matches, activeMatch]);

  return { query, setQuery, matches, active, activeMatch, status, next: () => step(1), previous: () => step(-1), highlights };
}
