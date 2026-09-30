import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { buildPageText, type PageText } from "./search";

// Text content is needed by the text layer and by search; extract each page once.
const caches = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextContent>>>();

/** Text content of a page (0-based index), extracted once per document. */
export function getTextContent(doc: PDFDocumentProxy, index: number): Promise<TextContent> {
  let cache = caches.get(doc);
  if (!cache) {
    cache = new Map();
    caches.set(doc, cache);
  }
  let entry = cache.get(index);
  if (!entry) {
    entry = doc.getPage(index + 1).then((p) => p.getTextContent());
    // Don't cache failures; a later attempt may succeed.
    entry.catch(() => cache!.delete(index));
    cache.set(index, entry);
  }
  return entry;
}

const pageTexts = new WeakMap<PDFDocumentProxy, Map<number, Promise<{ text: PageText; content: TextContent }>>>();

/** A page's normalised search text, built once per document. */
export function getPageText(doc: PDFDocumentProxy, index: number): Promise<{ text: PageText; content: TextContent }> {
  let cache = pageTexts.get(doc);
  if (!cache) {
    cache = new Map();
    pageTexts.set(doc, cache);
  }
  let entry = cache.get(index);
  if (!entry) {
    entry = getTextContent(doc, index).then((content) => ({ text: buildPageText(content.items), content }));
    entry.catch(() => cache!.delete(index));
    cache.set(index, entry);
  }
  return entry;
}
