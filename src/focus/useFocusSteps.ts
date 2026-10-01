import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getTextContent } from "../pdf/textCache";
import { detectLines } from "./lines";
import { buildSteps, type FocusPage, type Step, type StepUnit } from "./steps";

// Lines of every page, found once per document and column setting.
const cache = new WeakMap<PDFDocumentProxy, Map<boolean, Promise<FocusPage[]>>>();

function focusPages(pdf: PDFDocumentProxy, detectColumns: boolean): Promise<FocusPage[]> {
  let byColumns = cache.get(pdf);
  if (!byColumns) cache.set(pdf, (byColumns = new Map()));
  let entry = byColumns.get(detectColumns);
  if (!entry) {
    entry = (async () => {
      const pages: FocusPage[] = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const [page, content] = await Promise.all([pdf.getPage(i + 1), getTextContent(pdf, i)]);
        const { lines } = detectLines(content.items, { rotation: page.rotate, detectColumns });
        pages.push({ page: i, lines, items: content.items, rotation: page.rotate, top: page.view[3] });
      }
      return pages;
    })();
    entry.catch(() => byColumns!.delete(detectColumns));
    byColumns.set(detectColumns, entry);
  }
  return entry;
}

/**
 * Focus mode's steps for a document, or null while they are being worked out
 * (or when focus mode is off: nothing is computed then).
 */
export function useFocusSteps(
  pdf: PDFDocumentProxy | null,
  active: boolean,
  unit: StepUnit,
  detectColumns: boolean,
  onError: (what: string, err: unknown) => void,
): Step[] | null {
  const [result, setResult] = useState<{ key: unknown[]; steps: Step[] } | null>(null);
  useEffect(() => {
    if (!pdf || !active) return;
    let cancelled = false;
    focusPages(pdf, detectColumns)
      .then((pages) => !cancelled && setResult({ key: [pdf, unit, detectColumns], steps: buildSteps(pages, unit) }))
      .catch((e) => !cancelled && onError("Could not find the lines for focus mode", e));
    return () => {
      cancelled = true;
    };
  }, [pdf, active, unit, detectColumns, onError]);
  const current = result && result.key[0] === pdf && result.key[1] === unit && result.key[2] === detectColumns;
  return active && current ? result.steps : null;
}
