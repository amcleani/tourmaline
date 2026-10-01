import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { importedKeys, pdfAnnotationNames } from "../platform";
import { hidePdfAnnotations } from "../pdf/PdfViewer";
import { findPdfAnnotations, toNewAnnotations } from "./importPdf";
import type { Category, ImportResult, NewAnnotation } from "./types";

const NONE: ReadonlySet<string> = new Set();

interface Doc {
  workId: string;
  fileId: string;
  pdf: PDFDocumentProxy;
  path: string | null;
}

/**
 * Imports the annotations other programs saved in the open PDF, once its own
 * annotations have loaded, and returns the pdf.js ids of those Tourmaline now
 * shows itself (so the page stops drawing them). Each file is scanned once
 * per session.
 */
export function usePdfImport(
  doc: Doc | null,
  loaded: boolean,
  categories: readonly Category[],
  importFound: (list: NewAnnotation[]) => Promise<ImportResult | null>,
  report: (what: string, err: unknown) => void,
): ReadonlySet<string> {
  const [hidden, setHidden] = useState<{ fileId: string; ids: ReadonlySet<string> } | null>(null);
  const scanned = useRef(new Map<string, ReadonlySet<string>>());
  const latest = useRef({ categories, importFound, report });
  latest.current = { categories, importFound, report };
  const ready = loaded && categories.length > 0;
  const workId = doc?.workId;
  const fileId = doc?.fileId;
  const pdf = doc?.pdf;
  const path = doc?.path ?? null;

  useEffect(() => {
    if (!ready || !workId || !fileId || !pdf) return;
    const known = scanned.current.get(`${workId}:${fileId}`);
    if (known) {
      setHidden({ fileId, ids: known });
      return;
    }
    let cancelled = false;
    (async () => {
      const names = await pdfAnnotationNames(path, fileId).catch((e) => {
        // Without names, annotations are still imported, keyed by position.
        console.warn("Could not read the PDF's annotation names", e);
        return new Map<string, string>();
      });
      const found = await findPdfAnnotations(pdf, names);
      if (cancelled) return;
      const before = new Set(await importedKeys(workId));
      const fresh = found.filter((f) => !before.has(f.key));
      if (fresh.length) {
        // So pictures taken of imported areas don't show the original too.
        hidePdfAnnotations(pdf, fresh.map((f) => f.pdfId));
        const { categories: cats, importFound: run } = latest.current;
        const result = await run(await toNewAnnotations(pdf, { workId, fileId }, fresh, cats));
        if (!result || cancelled) return;
      }
      const ids = new Set(found.map((f) => f.pdfId));
      scanned.current.set(`${workId}:${fileId}`, ids);
      if (!cancelled) setHidden({ fileId, ids });
    })().catch((e) => !cancelled && latest.current.report("Could not import the PDF's annotations", e));
    return () => {
      cancelled = true;
    };
  }, [ready, workId, fileId, pdf, path]);

  return hidden && hidden.fileId === fileId ? hidden.ids : NONE;
}
