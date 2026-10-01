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
const MAX_HEIGHT = 380;

// The part of the page a link or citation points to (a bibliography entry,
// a figure, an equation), drawn small next to it. Click the link (or press
// Enter on it) to go there.
export function ReferencePreview({ pdf, destination, anchor, zoom, onMouseEnter, onMouseLeave }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<React.CSSProperties>({ visibility: "hidden" });
  // Placed in the area it is drawn in (its offset parent), once its size is known.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const area = el?.offsetParent;
    if (!el || !area) return;
    const fit = () => {
      const box = area.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.min(Math.max(anchor.left - box.left - 24, 8), Math.max(8, box.width - w - 8));
      const below = anchor.bottom - box.top + 6;
      const above = anchor.top - box.top - 6 - h;
      const top = below + h <= box.height - 8 || above < 8 ? below : above;
      setPlace({ left, top: Math.max(8, top) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);
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
      const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - 48);
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
    })().catch((e) => {
      if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") {
        console.error("Could not draw the preview", e);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageIndex, preview, zoom]);

  return (
    // role="status": read out when it appears (the picture itself is hidden from screen readers; its text isn't).
    <div ref={rootRef} className="reference-preview" style={place} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} role="status">
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
