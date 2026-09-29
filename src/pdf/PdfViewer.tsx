import { useCallback, useEffect, useRef, useState } from "react";
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
  // Every page starts with page 1's size so the scrollbar is right immediately;
  // pages that differ correct their entry when they load.
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    doc
      .getPage(1)
      .then((page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setSizes(Array.from({ length: doc.numPages }, () => ({ width: vp.width, height: vp.height })));
      })
      .catch((err) => !cancelled && setError(String(err?.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Focus the document once it appears so arrow keys, PageDown and Space scroll it straight away.
  const ready = sizes !== null;
  useEffect(() => {
    if (ready) scrollRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const onPageSize = useCallback((index: number, size: Size) => {
    setSizes((prev) => {
      if (!prev) return prev;
      const old = prev[index];
      if (Math.abs(old.width - size.width) < 0.5 && Math.abs(old.height - size.height) < 0.5) return prev;
      const next = prev.slice();
      next[index] = size;
      return next;
    });
  }, []);

  return (
    <div className="viewer-scroll" ref={scrollRef} role="document" aria-label={name} tabIndex={0}>
      {error && (
        <p className="viewer-error" role="alert">
          This PDF could not be displayed: {error}
        </p>
      )}
      {sizes?.map((size, i) => (
        <PageView
          key={i}
          doc={doc}
          index={i}
          size={size}
          zoom={zoom}
          root={scrollRef}
          onSize={onPageSize}
        />
      ))}
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  zoom: number;
  root: React.RefObject<HTMLDivElement | null>;
  onSize: (index: number, size: Size) => void;
}

function PageView({ doc, index, size, zoom, root, onSize }: PageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // pdf.js refuses to start a render on a canvas that is still busy, and
  // cancelling is asynchronous, so each render waits for the previous one.
  const lastRender = useRef<Promise<unknown>>(Promise.resolve());
  const [nearViewport, setNearViewport] = useState(false);
  const [failed, setFailed] = useState(false);

  const pageNumber = index + 1;
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

    const render = async () => {
      await lastRender.current;
      if (cancelled) return;
      const page = await doc.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      onSize(index, { width: natural.width, height: natural.height });
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
      setFailed(false);
    };

    const done = render().catch((err) => {
      if (err?.name === "RenderingCancelledException") return;
      console.error(`Page ${pageNumber} failed to render`, err);
      if (!cancelled) setFailed(true);
    });
    lastRender.current = done;
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, pageNumber, cssScale, nearViewport, onSize]);

  return (
    <div
      ref={boxRef}
      className="page"
      style={{ width, height }}
      role="region"
      aria-label={`Page ${pageNumber} of ${doc.numPages}`}
    >
      {nearViewport && <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />}
      {failed && <p className="page-error">Page {pageNumber} could not be rendered.</p>}
    </div>
  );
}
