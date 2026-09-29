import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import {
  PADDING,
  anchorAt,
  computeLayout,
  currentPage,
  fitZoom,
  offsetOf,
  visibleRange,
  type Anchor,
  type Size,
  type ZoomMode,
} from "./layout";
import type { Target } from "./outline";
import type { PdfRect } from "./search";
import { getTextContent } from "./textCache";
import { PDF_TO_CSS } from "./units";

export interface ZoomSpec {
  mode: ZoomMode;
  /** Used when mode is "custom". */
  zoom: number;
}

export interface ViewState {
  /** 0-based page most of the viewport shows. */
  page: number;
  /** Position at the top of the viewport, for restoring later. */
  anchor: Anchor;
  /** Zoom actually applied (differs from ZoomSpec.zoom in fit modes). */
  zoom: number;
}

export interface Highlight {
  rects: PdfRect[];
  active: boolean;
}

export interface ViewerHandle {
  goToPage(page: number): void;
  goToTarget(target: Target): Promise<void>;
  /** Scrolls a PDF-space rectangle on a page into view if it isn't already. */
  revealRect(page: number, rect: PdfRect): Promise<void>;
  focus(): void;
}

interface Props {
  doc: PDFDocumentProxy;
  name: string;
  zoom: ZoomSpec;
  initialAnchor?: Anchor | null;
  highlights?: ReadonlyMap<number, Highlight[]>;
  onViewChange: (state: ViewState) => void;
  /** Ctrl+wheel: ask the owner to zoom one step in (1) or out (-1). */
  onZoomStep: (direction: 1 | -1) => void;
  handleRef?: React.Ref<ViewerHandle>;
}

/** Converts a PDF-space rectangle to CSS pixels within the page. */
function toCssRect(viewport: PageViewport, [x0, y0, x1, y1]: PdfRect) {
  const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
  const [bx, by] = viewport.convertToViewportPoint(x1, y1);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

const WHEEL_STEP = 50;

export function PdfViewer({ doc, name, zoom, initialAnchor, highlights, onViewChange, onZoomStep, handleRef }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // Every page starts with page 1's size so the scrollbar is right immediately;
  // pages that differ correct their entry when they load.
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

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const observer = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveZoom = useMemo(() => {
    if (zoom.mode === "custom" || !sizes || viewport.width === 0) return zoom.zoom;
    return fitZoom(zoom.mode, sizes[0], viewport.width, viewport.height);
  }, [zoom, sizes, viewport]);

  const layout = useMemo(() => (sizes ? computeLayout(sizes, effectiveZoom) : null), [sizes, effectiveZoom]);

  // Keep the reader's place when the layout changes (zoom, window resize, a
  // page turning out to be a different size): remember which point of which
  // page was under the focus line, and put it back there.
  const prevLayout = useRef<typeof layout>(null);
  const zoomFocusY = useRef<number | null>(null);
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!layout || !el) return;
    const prev = prevLayout.current;
    prevLayout.current = layout;
    if (!prev) {
      if (initialAnchor && !restored.current) el.scrollTop = offsetOf(layout, initialAnchor);
      restored.current = true;
    } else if (prev !== layout) {
      const focusY = zoomFocusY.current ?? el.clientHeight / 2;
      zoomFocusY.current = null;
      const anchor = anchorAt(prev, el.scrollTop + focusY);
      const ratio = layout.maxWidth / (prev.maxWidth || 1);
      // Keep the horizontal centre of the view where it was, too.
      const centreX = el.scrollLeft + el.clientWidth / 2;
      el.scrollTop = offsetOf(layout, anchor) - focusY;
      el.scrollLeft = centreX * ratio - el.clientWidth / 2;
    }
    setScrollTop(el.scrollTop);
  }, [layout, initialAnchor]);

  // Report position (throttled to animation frames).
  const report = useRef(onViewChange);
  report.current = onViewChange;
  useEffect(() => {
    const el = scrollRef.current;
    if (!layout || !el) return;
    report.current({
      page: currentPage(layout, scrollTop, el.clientHeight),
      anchor: anchorAt(layout, scrollTop),
      zoom: effectiveZoom,
    });
  }, [layout, scrollTop, effectiveZoom]);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(scrollRef.current?.scrollTop ?? 0));
  }, []);

  // Ctrl+wheel zooms around the pointer. Needs a non-passive listener to stop
  // the webview's own page zoom.
  const zoomStep = useRef(onZoomStep);
  zoomStep.current = onZoomStep;
  useEffect(() => {
    const el = scrollRef.current!;
    let accumulated = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      accumulated += e.deltaY;
      if (Math.abs(accumulated) < WHEEL_STEP) return;
      zoomFocusY.current = e.clientY - el.getBoundingClientRect().top;
      zoomStep.current(accumulated < 0 ? 1 : -1);
      accumulated = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Focus the document once it appears so arrow keys, PageDown and Space scroll it straight away.
  const ready = layout !== null;
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

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const scrollToOffset = (y: number) => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, y);
  };
  useImperativeHandle(handleRef, () => {
    const goToPage = (page: number) => {
      const l = layoutRef.current;
      if (l) scrollToOffset(l.tops[Math.min(Math.max(page, 0), l.tops.length - 1)] - PADDING / 2);
    };
    return {
      goToPage,
      async goToTarget(target) {
        const l = layoutRef.current;
        if (!l) return;
        if (target.y === null) return goToPage(target.page);
        const page = await doc.getPage(target.page + 1);
        const vp = page.getViewport({ scale: l.zoom * PDF_TO_CSS });
        const [, y] = vp.convertToViewportPoint(0, target.y);
        scrollToOffset(l.tops[target.page] + y - PADDING / 2);
      },
      async revealRect(pageIndex, rect) {
        const l = layoutRef.current;
        const el = scrollRef.current;
        if (!l || !el) return;
        const page = await doc.getPage(pageIndex + 1);
        const r = toCssRect(page.getViewport({ scale: l.zoom * PDF_TO_CSS }), rect);
        const top = l.tops[pageIndex] + r.top;
        if (top < el.scrollTop || top + r.height > el.scrollTop + el.clientHeight) {
          scrollToOffset(top - el.clientHeight / 3);
        }
      },
      focus() {
        scrollRef.current?.focus({ preventScroll: true });
      },
    };
  }, [doc]);

  const innerWidth = layout ? Math.max(viewport.width, layout.maxWidth + 2 * PADDING) : 0;
  const [first, last] = layout ? visibleRange(layout, scrollTop, viewport.height || 800, 1) : [0, -1];
  const pages = [];
  for (let i = first; i <= last; i++) {
    pages.push(
      <PageView
        key={i}
        doc={doc}
        index={i}
        top={layout!.tops[i]}
        left={Math.max(PADDING, (innerWidth - layout!.widths[i]) / 2)}
        width={layout!.widths[i]}
        height={layout!.heights[i]}
        zoom={effectiveZoom}
        highlights={highlights?.get(i)}
        onSize={onPageSize}
      />,
    );
  }

  return (
    <div
      className="viewer-scroll"
      ref={scrollRef}
      role="document"
      aria-label={name}
      tabIndex={0}
      onScroll={onScroll}
    >
      {error && (
        <p className="viewer-error" role="alert">
          This PDF could not be displayed: {error}
        </p>
      )}
      {layout && (
        <div className="viewer-pages" style={{ height: layout.totalHeight, width: innerWidth }}>
          {pages}
        </div>
      )}
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
  zoom: number;
  highlights?: Highlight[];
  onSize: (index: number, size: Size) => void;
}

/** Browsers refuse canvases much beyond this many pixels. */
const MAX_CANVAS_PIXELS = 16_000_000;

function PageView({ doc, index, top, left, width, height, zoom, highlights, onSize }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // pdf.js refuses to start a render on a canvas that is still busy, and
  // cancelling is asynchronous, so each render waits for the previous one.
  const lastRender = useRef<Promise<unknown>>(Promise.resolve());
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [failed, setFailed] = useState(false);

  const pageNumber = index + 1;
  const cssScale = zoom * PDF_TO_CSS;

  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then(
      (p) => {
        if (cancelled) return;
        const natural = p.getViewport({ scale: 1 });
        onSize(index, { width: natural.width, height: natural.height });
        setPage(p);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [doc, index, pageNumber, onSize]);

  const viewport = useMemo(() => page?.getViewport({ scale: cssScale }) ?? null, [page, cssScale]);

  // Canvas
  useEffect(() => {
    if (!page || !viewport) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const render = async () => {
      await lastRender.current;
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const pixels = viewport.width * viewport.height;
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / pixels));
      const scaled = page.getViewport({ scale: cssScale * dpr });
      canvas.width = Math.floor(scaled.width);
      canvas.height = Math.floor(scaled.height);
      task = page.render({ canvas, viewport: scaled });
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
  }, [page, viewport, cssScale, pageNumber]);

  // Text layer: invisible, selectable text positioned over the canvas; also
  // what screen readers read.
  const textLayer = useRef<TextLayer | null>(null);
  useEffect(() => {
    const container = textRef.current;
    if (!page || !viewport || !container) return;
    if (textLayer.current) {
      textLayer.current.update({ viewport });
      return;
    }
    let cancelled = false;
    getTextContent(doc, index)
      .then((content) => {
        if (cancelled) return;
        const layer = new TextLayer({ textContentSource: content, container, viewport });
        textLayer.current = layer;
        return layer.render();
      })
      .catch((err) => console.warn(`Text layer for page ${pageNumber} failed`, err));
    return () => {
      cancelled = true;
    };
  }, [doc, index, page, viewport, pageNumber]);
  useEffect(
    () => () => {
      textLayer.current?.cancel();
      textLayer.current = null;
    },
    [],
  );

  // pdf.js's selection styling needs a "selecting" class while the mouse is down.
  const onPointerDown = () => {
    const el = textRef.current;
    if (!el) return;
    el.classList.add("selecting");
    const done = () => {
      el.classList.remove("selecting");
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointerup", done);
  };

  return (
    <div
      className="page"
      style={{ top, left, width, height, ["--total-scale-factor" as string]: cssScale }}
      role="region"
      aria-label={`Page ${pageNumber} of ${doc.numPages}`}
    >
      <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
      <div ref={textRef} className="textLayer" onPointerDown={onPointerDown} />
      {viewport && highlights && highlights.length > 0 && (
        <div className="highlight-layer" aria-hidden="true">
          {highlights.flatMap((h, i) =>
            h.rects.map((rect, j) => (
              <div key={`${i}-${j}`} className={h.active ? "search-hit active" : "search-hit"} style={toCssRect(viewport, rect)} />
            )),
          )}
        </div>
      )}
      {failed && <p className="page-error">Page {pageNumber} could not be rendered.</p>}
    </div>
  );
}
