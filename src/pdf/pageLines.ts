import type { PDFDocumentProxy } from "pdfjs-dist";
import { detectLines } from "../focus/lines";
import type { FocusPage } from "../focus/steps";
import { getTextContent } from "./textCache";

// Each page's lines in reading order (focus/lines.ts), found once per
// document and column setting. Shared by focus mode and reference previews.
const cache = new WeakMap<PDFDocumentProxy, Map<string, Promise<FocusPage>>>();

export function getPageLines(pdf: PDFDocumentProxy, index: number, detectColumns = true): Promise<FocusPage> {
  let pages = cache.get(pdf);
  if (!pages) cache.set(pdf, (pages = new Map()));
  const key = `${detectColumns}:${index}`;
  let entry = pages.get(key);
  if (!entry) {
    entry = Promise.all([pdf.getPage(index + 1), getTextContent(pdf, index)]).then(([page, content]) => ({
      page: index,
      lines: detectLines(content.items, { rotation: page.rotate, detectColumns }).lines,
      items: content.items,
      rotation: page.rotate,
      top: page.view[3],
    }));
    entry.catch(() => pages!.delete(key));
    pages.set(key, entry);
  }
  return entry;
}
