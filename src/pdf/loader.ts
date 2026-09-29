import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

// Copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).toString();

/** CSS pixels per PDF point (PDF uses 72 units per inch, CSS uses 96). */
export const PDF_TO_CSS = 96 / 72;

export function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const base = assetBase();
  return getDocument({
    data: bytes,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    iccUrl: `${base}iccs/`,
    wasmUrl: `${base}wasm/`,
  }).promise;
}
