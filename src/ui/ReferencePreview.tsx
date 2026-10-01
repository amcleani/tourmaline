import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import type { PdfRect } from "../pdf/search";
import { PDF_TO_CSS } from "../pdf/units";

interface Props {
  pdf: PDFDocumentProxy;
  /** What the spot leads to: a part of a page, or an external address. */
  destination: { page: number; preview: PdfRect | null; url?: string; text: string };
  /** The link, on screen: the preview goes under it (or above), kept in the window. */
  anchor: DOMRect;
  /** The page's zoom: the preview's text is drawn as large as the page's. */
  zoom: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const MAX_WIDTH = 720;
/** Laid out (to be measured) but not seen, until placed. */
const HIDDEN: React.CSSProperties = { visibility: "hidden", left: 0, top: 0 };
const MAX_HEIGHT = 380;

// The part of the page a link or citation points to (a bibliography entry,
// a figure, an equation), drawn small next to it. Click the link (or press
// Enter on it) to go there.
export function ReferencePreview({ pdf, destination, anchor, zoom, onMouseEnter, onMouseLeave }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<React.CSSProperties | null>(null);
  /** Its picture is drawn (or there is none): only then is its size final, and it shows. */
  const [drawn, setDrawn] = useState(!destination.preview);
  // Placed in the area it is drawn in (its offset parent), once its size is
  // known: shown before that, it would appear by the link and then jump.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const area = el?.offsetParent;
    if (!el || !area || !drawn) return;
    const fit = () => {
      const box = area.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.min(Math.max(anchor.left - box.left - 24, 8), Math.max(8, box.width - w - 8));
      const below = anchor.bottom - box.top + 6;
      const above = anchor.top - box.top - 6 - h;
      const top = Math.max(8, below + h <= box.height - 8 || above < 8 ? below : above);
      // Only a real change moves it (never a loop of tiny adjustments).
      setPlace((prev) => (prev && Math.abs((prev.left as number) - left) < 1 && Math.abs((prev.top as number) - top) < 1 ? prev : { left, top }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, drawn]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const { page: pageIndex, preview } = destination;

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const [x0, y0, x1, y1] = preview;
      const width = Math.max(1, x1 - x0);
      const height = Math.max(1, y1 - y0);
      // As large as the page's text, within the popup (and the window).
      // (The pane it is in may be narrower than the window: split view, sidebars.)
      const area = rootRef.current?.offsetParent?.clientWidth ?? window.innerWidth;
      const maxWidth = Math.min(MAX_WIDTH, area - 40);
      const css = Math.min(PDF_TO_CSS * zoom, maxWidth / width, (MAX_HEIGHT * 1.6) / height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: css * ratio });
      const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
      const [bx, by] = viewport.convertToViewportPoint(x1, y1);
      const left = Math.floor(Math.min(ax, bx));
      const top = Math.floor(Math.min(ay, by));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.max(1, Math.ceil(Math.max(ax, bx)) - left);
      canvas.height = Math.max(1, Math.ceil(Math.max(ay, by)) - top);
      canvas.style.width = `${canvas.width / ratio}px`;
      canvas.style.height = `${canvas.height / ratio}px`;
      task = page.render({
        canvas,
        viewport,
        transform: [1, 0, 0, 1, -left, -top],
        annotationMode: AnnotationMode.ENABLE_STORAGE,
      });
      await task.promise;
      if (!cancelled) setDrawn(true);
    })().catch((e) => {
      if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") {
        console.error("Could not draw the preview", e);
        setFailed(true);
        setDrawn(true);
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageIndex, preview, zoom]);

  return (
    // role="status": read out when it appears (the picture itself is hidden from screen readers; its text isn't).
    <div ref={rootRef} className="reference-preview" style={place ?? HIDDEN} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} role="status">
      {!destination.url && <p className="visually-hidden">{destination.text}</p>}
      {destination.url ? (
        <p className="reference-url">Opens {destination.url} in your browser</p>
      ) : failed ? (
        <p className="muted">The preview could not be drawn.</p>
      ) : (
        <div className="reference-clip">
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
      )}
      {!destination.url && <p className="reference-where">Page {pageIndex + 1} · click to go there</p>}
    </div>
  );
}
