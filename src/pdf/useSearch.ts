import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight } from "./PdfViewer";
import { buildPageText, findInPage, matchRects, normaliseQuery, type PdfRect } from "./search";
import { getTextContent } from "./textCache";

export interface FoundMatch {
  page: number;
  rects: PdfRect[];
}

export type SearchStatus = "idle" | "searching" | "done";

const DEBOUNCE_MS = 200;
/** Publish results every this many pages so long books show hits early. */
const BATCH_PAGES = 16;

/**
 * Searches a document page by page in the background. A new query cancels the
 * previous search. The first match at or after `fromPage` becomes active.
 */
export function useDocumentSearch(doc: PDFDocumentProxy | null, fromPage: number) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FoundMatch[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const fromPageRef = useRef(fromPage);
  fromPageRef.current = fromPage;

  useEffect(() => {
    setMatches([]);
    setActive(-1);
    if (!doc || !normaliseQuery(query)) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("searching");
    const timer = setTimeout(async () => {
      const found: FoundMatch[] = [];
      let activeChosen = false;
      for (let page = 0; page < doc.numPages && !cancelled; page++) {
        try {
          const content = await getTextContent(doc, page);
          const text = buildPageText(content.items);
          for (const m of findInPage(text, page, query)) {
            found.push({ page, rects: matchRects(text, content.items, m) });
          }
        } catch {
          // Unreadable page: skip it rather than abandon the search.
        }
        const lastPage = page === doc.numPages - 1;
        if (cancelled) return;
        if ((page + 1) % BATCH_PAGES === 0 || lastPage) {
          setMatches(found.slice());
          if (!activeChosen) {
            const idx = found.findIndex((f) => f.page >= fromPageRef.current);
            if (idx !== -1 || lastPage) {
              activeChosen = true;
              setActive(idx !== -1 ? idx : found.length ? 0 : -1);
            }
          }
        }
      }
      if (!cancelled) setStatus("done");
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, query]);

  const step = useCallback(
    (direction: 1 | -1) => {
      setActive((i) => (matches.length === 0 ? -1 : (i + direction + matches.length) % matches.length));
    },
    [matches.length],
  );

  const highlights = useMemo(() => {
    const byPage = new Map<number, Highlight[]>();
    matches.forEach((m, i) => {
      const list = byPage.get(m.page) ?? [];
      list.push({ rects: m.rects, active: i === active });
      byPage.set(m.page, list);
    });
    return byPage;
  }, [matches, active]);

  return { query, setQuery, matches, active, status, next: () => step(1), previous: () => step(-1), highlights };
}
