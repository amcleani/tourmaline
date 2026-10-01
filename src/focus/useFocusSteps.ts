import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageLines } from "../pdf/pageLines";
import { buildSteps, type FocusPage, type Step, type StepUnit } from "./steps";

/** Steps are shown once this many pages from the start page are ready, then again every BATCH pages. */
const FIRST = 6;
const BATCH = 60;

export interface FocusSteps {
  steps: Step[];
  /** Pages whose lines are found so far, and all. */
  pagesDone: number;
  pageCount: number;
}

/**
 * Focus mode's steps for a document, or null until the first are ready (and
 * when focus mode is off: nothing is computed then). Pages are read from
 * `startPage` on, then the ones before it; the steps grow as they come in,
 * so a long book can be read from where it is open straight away.
 */
export function useFocusSteps(
  pdf: PDFDocumentProxy | null,
  active: boolean,
  unit: StepUnit,
  detectColumns: boolean,
  startPage: number,
  onError: (what: string, err: unknown) => void,
): FocusSteps | null {
  const [result, setResult] = useState<{ key: unknown[]; value: FocusSteps } | null>(null);
  const start = useRef(startPage);
  start.current = startPage;
  useEffect(() => {
    if (!pdf || !active) return;
    let cancelled = false;
    const key = [pdf, unit, detectColumns];
    const total = pdf.numPages;
    const first = Math.min(Math.max(start.current, 0), total - 1);
    const order = [...Array.from({ length: total - first }, (_, i) => first + i), ...Array.from({ length: first }, (_, i) => i)];
    (async () => {
      const found: FocusPage[] = [];
      const publish = () => {
        const pages = found.slice().sort((a, b) => a.page - b.page);
        setResult({ key, value: { steps: buildSteps(pages, unit), pagesDone: found.length, pageCount: total } });
      };
      for (const index of order) {
        found.push(await getPageLines(pdf, index, detectColumns));
        if (cancelled) return;
        const n = found.length;
        if (n === total || n === Math.min(FIRST, total) || (n > FIRST && (n - FIRST) % BATCH === 0)) publish();
      }
    })().catch((e) => !cancelled && onError("Could not find the lines for focus mode", e));
    return () => {
      cancelled = true;
    };
  }, [pdf, active, unit, detectColumns, onError]);
  const current = result && result.key[0] === pdf && result.key[1] === unit && result.key[2] === detectColumns;
  return active && current ? result.value : null;
}
