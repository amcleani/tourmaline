import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import type { PdfRect } from "../pdf/search";

/** Resolution of area captures; high enough for formulas to stay crisp in notes. */
const CAPTURE_DPI = 200;
const MAX_PIXELS = 8_000_000;

/** Renders a rectangle of a page (PDF space) to PNG bytes. */
export async function renderRegion(pdf: PDFDocumentProxy, pageIndex: number, rect: PdfRect): Promise<Uint8Array> {
  const page = await pdf.getPage(pageIndex + 1);
  const [x0, y0, x1, y1] = rect;
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const scale = Math.min(CAPTURE_DPI / 72, Math.sqrt(MAX_PIXELS / area));
  const viewport = page.getViewport({ scale });
  const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
  const [bx, by] = viewport.convertToViewportPoint(x1, y1);
  const left = Math.floor(Math.min(ax, bx));
  const top = Math.floor(Math.min(ay, by));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(Math.max(ax, bx)) - left);
  canvas.height = Math.max(1, Math.ceil(Math.max(ay, by)) - top);
  // "print" renders straight through instead of pacing itself with animation
  // frames, which stall while the window is in the background.
  // ENABLE_STORAGE leaves out PDF annotations Tourmaline draws itself (imported ones).
  await page.render({
    canvas,
    viewport,
    transform: [1, 0, 0, 1, -left, -top],
    intent: "print",
    annotationMode: AnnotationMode.ENABLE_STORAGE,
  }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
