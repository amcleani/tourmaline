import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

// Copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).toString();

export { PDF_TO_CSS } from "./units";

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
