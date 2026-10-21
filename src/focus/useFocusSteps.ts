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
  const [result, setResult] = useState<{ key: unknown[]; run: object; value: FocusSteps } | null>(null);
  const start = useRef(startPage);
  start.current = startPage;
  /**
   * The run whose steps may be shown. Turning focus mode off stops a run
   * part-way (a long book is rarely finished), so its steps lack pages: a
   * new run starts from where the reader is now, and until it has steps
   * there, nothing is shown (the old ones would start somewhere else).
   */
  const run = useRef<object | null>(null);
  const complete = (r: typeof result) => !!r && r.value.pagesDone === r.value.pageCount;
  const sameKey = (r: typeof result) => !!r && r.key[0] === pdf && r.key[1] === unit && r.key[2] === detectColumns;
  if (!active) run.current = null;
  const latestResult = useRef(result);
  latestResult.current = result;
  useEffect(() => {
    if (!pdf || !active) return;
    // Every page is already done for these settings: those steps will do.
    const done = latestResult.current;
    if (done && sameKey(done) && complete(done)) {
      run.current = done.run;
      return;
    }
    let cancelled = false;
    const thisRun = {};
    run.current = thisRun;
    const key = [pdf, unit, detectColumns];
    const total = pdf.numPages;
    const first = Math.min(Math.max(start.current, 0), total - 1);
    const order = [...Array.from({ length: total - first }, (_, i) => first + i), ...Array.from({ length: first }, (_, i) => i)];
    (async () => {
      const found: FocusPage[] = [];
      const publish = () => {
        const pages = found.slice().sort((a, b) => a.page - b.page);
        setResult({ key, run: thisRun, value: { steps: buildSteps(pages, unit), pagesDone: found.length, pageCount: total } });
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
  const shown = sameKey(result) && (result!.run === run.current || complete(result));
  return active && shown ? result!.value : null;
}
