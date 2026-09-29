import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { PDF_TO_CSS } from "./loader";

// Phase 0 viewer: continuous vertical scroll, pages drawn only when near the
// viewport. Text layer, page tracking and scroll-preserving zoom come in phase 1.

interface Size {
  width: number;
  height: number;
}

interface Props {
  doc: PDFDocumentProxy;
  name: string;
  zoom: number;
}

export function PdfViewer({ doc, name, zoom }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Size[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Every page's size is needed up front so the scrollbar is right; reading
    // them is cheap compared with rendering.
    Promise.all(
      Array.from({ length: doc.numPages }, (_, i) =>
        doc.getPage(i + 1).then((p) => {
          const vp = p.getViewport({ scale: 1 });
          return { width: vp.width, height: vp.height };
        }),
      ),
    ).then((s) => !cancelled && setSizes(s));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  return (
    <div className="viewer-scroll" ref={scrollRef} role="document" aria-label={name} tabIndex={0}>
      {sizes?.map((size, i) => (
        <PageView key={i} doc={doc} pageNumber={i + 1} pageCount={doc.numPages} size={size} zoom={zoom} root={scrollRef} />
      ))}
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  size: Size;
  zoom: number;
  root: React.RefObject<HTMLDivElement | null>;
}

function PageView({ doc, pageNumber, pageCount, size, zoom, root }: PageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  const cssScale = zoom * PDF_TO_CSS;
  const width = Math.floor(size.width * cssScale);
  const height = Math.floor(size.height * cssScale);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { root: root.current, rootMargin: "150% 0px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!nearViewport) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      task.promise.catch((err) => {
        if (err?.name !== "RenderingCancelledException") console.error(err);
      });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, cssScale, nearViewport]);

  return (
    <div
      ref={boxRef}
      className="page"
      style={{ width, height }}
      role="region"
      aria-label={`Page ${pageNumber} of ${pageCount}`}
    >
      {nearViewport && <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />}
    </div>
  );
}
