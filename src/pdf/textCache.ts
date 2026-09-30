import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { sha256Hex } from "../util/hash";
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

const pageHashes = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>();

/**
 * SHA-256 of a page's text and layout: the normalised text, the page box, and
 * each text item's position and size (to 0.1 pt). Two versions of a file whose
 * page has the same hash show the same text in the same place, so annotations
 * keep their geometry. A re-typeset page (same words, new line breaks) differs.
 */
export function getPageHash(doc: PDFDocumentProxy, index: number): Promise<string> {
  let cache = pageHashes.get(doc);
  if (!cache) {
    cache = new Map();
    pageHashes.set(doc, cache);
  }
  let entry = cache.get(index);
  if (!entry) {
    entry = Promise.all([getPageText(doc, index), doc.getPage(index + 1)]).then(([{ text, content }, page]) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const layout = content.items
        .map((item) => ("str" in item ? [...item.transform.slice(2).map(r), r(item.width)].join(",") : ""))
        .join(";");
      const box = [...page.view, page.rotate].map(r).join(",");
      return sha256Hex(new TextEncoder().encode(`${text.text}
${box}
${layout}`));
    });
    entry.catch(() => cache!.delete(index));
    cache.set(index, entry);
  }
  return entry;
}
