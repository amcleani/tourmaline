import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnnotationMode, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import {
  PADDING,
  anchorAt,
  clampZoom,
  computeLayout,
  currentPage,
  fitZoom,
  isPinchWheel,
  offsetOf,
  pinchFactor,
  typicalSize,
  MAX_ZOOM,
  MIN_ZOOM,
  visibleRange,
  type Anchor,
  type Size,
  type ZoomMode,
} from "./layout";
import { captureSelection, cssToPdf, type CapturedSelection, type CssRect, type PageInfo } from "../annotations/selection";
import type { AnnotationKind } from "../annotations/types";
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

/** An annotation as drawn on one page. */
export interface Mark {
  id: string;
  kind: AnnotationKind;
  rects: PdfRect[];
  colour: string;
  selected: boolean;
}

/** Where a text selection ends, for placing the selection toolbar. */
export interface SelectionEnd {
  page: number;
  rect: PdfRect;
}

/** Something on a page that leads elsewhere (a link, a citation): drawn as a focusable link over its text. */
export interface LinkSpot {
  id: string;
  rects: PdfRect[];
  /** Its accessible name. */
  label: string;
}

export interface ViewerHandle {
  goToPage(page: number): void;
  /** Goes back to a place the reader was (Back/Forward). */
  goToAnchor(anchor: Anchor): void;
  goToTarget(target: Target): Promise<void>;
  /** Scrolls a PDF-space rectangle on a page into view if it isn't already. */
  revealRect(page: number, rect: PdfRect): Promise<void>;
  focus(): void;
  /**
   * Scrolls so a PDF-space rectangle's top sits at `fraction` of the window's
   * height (focus mode's eye line); smoothly unless the user prefers less motion.
   */
  scrollToEye(page: number, rect: PdfRect, fraction: number): Promise<void>;
  /** The point of the document at `fraction` of the window's height, in PDF space. */
  pointAt(fraction: number): Promise<{ page: number; x: number; y: number } | null>;
  /** Whether part of a PDF-space rectangle on a page is in view. */
  isInView(page: number, rect: PdfRect): Promise<boolean>;
  /** The current text selection in the document, if any. */
  captureSelection(): CapturedSelection | null;
  clearSelection(): void;
}

interface Props {
  doc: PDFDocumentProxy;
  name: string;
  zoom: ZoomSpec;
  /** Where to open; read once when the viewer mounts. */
  initialAnchor?: Anchor | null;
  highlights?: ReadonlyMap<number, Highlight[]>;
  onViewChange: (state: ViewState) => void;
  /** Ctrl+wheel (a mouse wheel's notch): ask the owner to zoom one step in (1) or out (-1). */
  onZoomStep: (direction: 1 | -1) => void;
  /** A trackpad pinch: ask the owner for this zoom (within the limits). */
  onZoomTo: (zoom: number) => void;
  handleRef?: React.Ref<ViewerHandle>;
  marks?: ReadonlyMap<number, Mark[]>;
  /** Clicking a mark selects it; clicking elsewhere on a page passes null. */
  onMarkClick?: (id: string | null) => void;
  /** Dragging on a page draws a rectangle instead of selecting text. */
  captureMode?: boolean;
  onCapture?: (page: number, rect: PdfRect) => void;
  onSelectionChange?: (end: SelectionEnd | null) => void;
  /** Extra content drawn over a page (popovers), positioned with toCss. */
  overlay?: (page: number, toCss: (rect: PdfRect) => CssRect) => React.ReactNode;
  /** pdf.js ids of annotations in the file that Tourmaline draws itself (imported ones). */
  hiddenAnnotations?: ReadonlySet<string>;
  /** Focus mode: every page is dimmed except these rectangles (by page). Null when off. */
  focus?: ReadonlyMap<number, PdfRect[]> | null;
  /** A click on a page that isn't on a mark or the end of a selection, in PDF space. */
  onPageClick?: (page: number, x: number, y: number) => void;
  /** The links of a page, asked for when it mounts. */
  spotsFor?: (page: number) => Promise<readonly LinkSpot[]>;
  /** The pointer or keyboard focus is on a link (null: it left), and where it is on screen. */
  onSpotHover?: (page: number, spot: LinkSpot | null, at?: DOMRect) => void;
  /** A link was clicked or Enter pressed on it; `aside`: Ctrl/Cmd held (open in the other pane). */
  onSpotActivate?: (page: number, spot: LinkSpot, aside: boolean) => void;
}

/**
 * Stops pdf.js drawing these annotations of the file, on screen and in area
 * captures (pages render with AnnotationMode.ENABLE_STORAGE).
 */
export function hidePdfAnnotations(doc: PDFDocumentProxy, ids: Iterable<string>) {
  for (const id of ids) doc.annotationStorage.setValue(id, { noView: true, noPrint: true });
}

const NO_IDS: ReadonlySet<string> = new Set();
const NO_RECTS: readonly PdfRect[] = [];

/** Focus mode's dimming of a page, with holes where the current step is. Clicks go through. */
function FocusLayer({ width, height, rects }: { width: number; height: number; rects: CssRect[] }) {
  // useId's ":r1:" isn't usable in url(#…).
  const id = `focus-${useId().replace(/[^\w-]/g, "")}`;
  const pad = 3;
  return (
    <svg className="focus-layer" width={width} height={height} aria-hidden="true">
      <mask id={id}>
        <rect width={width} height={height} fill="white" />
        {rects.map((r, i) => (
          <rect key={i} x={r.left - pad} y={r.top - pad} width={r.width + 2 * pad} height={r.height + 2 * pad} rx={3} fill="black" />
        ))}
      </mask>
      <rect width={width} height={height} className="focus-dim" mask={`url(#${id})`} />
    </svg>
  );
}

/** Converts a PDF-space rectangle to CSS pixels within the page. */
function toCssRect(viewport: PageViewport, [x0, y0, x1, y1]: PdfRect) {
  const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
  const [bx, by] = viewport.convertToViewportPoint(x1, y1);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

const WHEEL_STEP = 50;
/** A pinch is over (and the pages are drawn at the new zoom) once no event has come for this long, in ms. */
const PINCH_SETTLE = 150;

export function PdfViewer({
  doc,
  name,
  zoom,
  initialAnchor,
  highlights,
  onViewChange,
  onZoomStep,
  onZoomTo,
  handleRef,
  marks,
  onMarkClick,
  captureMode = false,
  onCapture,
  onSelectionChange,
  overlay,
  hiddenAnnotations = NO_IDS,
  focus = null,
  onPageClick,
  spotsFor,
  onSpotHover,
  onSpotActivate,
}: Props) {
  // Before the pages' render effects run (layout effects come first).
  useLayoutEffect(() => hidePdfAnnotations(doc, hiddenAnnotations), [doc, hiddenAnnotations]);
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
    return fitZoom(zoom.mode, typicalSize(sizes), viewport.width, viewport.height);
  }, [zoom, sizes, viewport]);

  const layout = useMemo(() => (sizes ? computeLayout(sizes, effectiveZoom) : null), [sizes, effectiveZoom]);

  // Keep the reader's place when the layout changes (zoom, window resize, a
  // page turning out to be a different size): remember which point of which
  // page was under the focus line, and put it back there.
  const prevLayout = useRef<typeof layout>(null);
  /** Where the pointer was for a zoom by wheel or pinch, in the view: that point stays put. */
  const zoomFocus = useRef<{ x: number; y: number } | null>(null);
  // A pinch scales the drawn pages (a CSS transform) until it ends, then asks
  // for the zoom; the transform goes when the pages are laid out at it.
  const zoomRef = useRef<HTMLDivElement>(null);
  const pinchShown = useRef(false);
  const endPinchPreview = useCallback(() => {
    if (!pinchShown.current) return;
    pinchShown.current = false;
    const wrap = zoomRef.current;
    if (wrap) wrap.style.transform = "";
  }, []);
  const restored = useRef(false);
  const openAt = useRef(initialAnchor);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!layout || !el) return;
    const prev = prevLayout.current;
    prevLayout.current = layout;
    if (!prev) {
      if (openAt.current && !restored.current) el.scrollTop = offsetOf(layout, openAt.current);
      restored.current = true;
    } else if (prev !== layout) {
      const focus = zoomFocus.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      zoomFocus.current = null;
      const anchor = anchorAt(prev, el.scrollTop + focus.y);
      const ratio = layout.maxWidth / (prev.maxWidth || 1);
      // Horizontally too (pages are centred in the content).
      const contentWidth = (l: NonNullable<typeof layout>) => Math.max(el.clientWidth, l.maxWidth + 2 * PADDING);
      const fromCentre = el.scrollLeft + focus.x - contentWidth(prev) / 2;
      el.scrollTop = offsetOf(layout, anchor) - focus.y;
      el.scrollLeft = contentWidth(layout) / 2 + fromCentre * ratio - focus.x;
      endPinchPreview();
    }
    setScrollTop(el.scrollTop);
  }, [layout]);

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

  // Ctrl+wheel and trackpad pinches (which arrive as Ctrl+wheel) zoom around
  // the pointer. Needs a non-passive listener to stop the webview's own page zoom.
  const zoomStep = useRef(onZoomStep);
  zoomStep.current = onZoomStep;
  const zoomTo = useRef(onZoomTo);
  zoomTo.current = onZoomTo;
  const zoomNow = useRef(effectiveZoom);
  zoomNow.current = effectiveZoom;
  useEffect(() => {
    const el = scrollRef.current!;
    let accumulated = 0;
    let pinch: { scale: number; x: number; y: number; timer: number } | null = null;
    const settle = () => {
      const p = pinch;
      pinch = null;
      if (!p) return;
      const z = zoomNow.current;
      const target = clampZoom(z * p.scale);
      if (Math.abs(target - z) < 1e-3) return endPinchPreview();
      zoomFocus.current = { x: p.x, y: p.y };
      zoomTo.current(target);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (isPinchWheel(e) || pinch) {
        const box = el.getBoundingClientRect();
        if (!pinch) {
          pinch = { scale: 1, x: e.clientX - box.left, y: e.clientY - box.top, timer: 0 };
          const wrap = zoomRef.current;
          if (wrap) wrap.style.transformOrigin = `${el.scrollLeft + pinch.x}px ${el.scrollTop + pinch.y}px`;
        }
        // Small steps stay smooth; a notch arriving mid-pinch counts as a few.
        const delta = Math.max(-50, Math.min(50, e.deltaMode === 0 ? e.deltaY : e.deltaY * 40));
        const z = zoomNow.current;
        pinch.scale = clampZoom(z * pinch.scale * pinchFactor(delta)) / z;
        const wrap = zoomRef.current;
        if (wrap) {
          wrap.style.transform = `scale(${pinch.scale})`;
          pinchShown.current = true;
        }
        clearTimeout(pinch.timer);
        pinch.timer = window.setTimeout(settle, PINCH_SETTLE);
        return;
      }
      accumulated += e.deltaY;
      if (Math.abs(accumulated) < WHEEL_STEP) return;
      const direction = accumulated < 0 ? 1 : -1;
      accumulated = 0;
      // At the zoom limit nothing will relayout, so don't leave a focus point
      // behind for some unrelated relayout to use later.
      const z = zoomNow.current;
      if ((direction === 1 && z >= MAX_ZOOM - 1e-6) || (direction === -1 && z <= MIN_ZOOM + 1e-6)) return;
      const box = el.getBoundingClientRect();
      zoomFocus.current = { x: e.clientX - box.left, y: e.clientY - box.top };
      zoomStep.current(direction);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (pinch) clearTimeout(pinch.timer);
    };
  }, [endPinchPreview]);

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

  // Mounted pages, for reading text selections off their text layers.
  const mountedPages = useRef(new Map<number, PageInfo>());
  const onRegister = useCallback((index: number, info: PageInfo | null) => {
    if (info) mountedPages.current.set(index, info);
    else mountedPages.current.delete(index);
  }, []);

  // Report where the selection ends once the mouse is released, so a toolbar
  // can offer to highlight it.
  const selectionReport = useRef(onSelectionChange);
  selectionReport.current = onSelectionChange;
  useEffect(() => {
    let pointerDown = false;
    let last: SelectionEnd | null = null;
    const emit = (end: SelectionEnd | null) => {
      if (end === last || (end && last && end.page === last.page && end.rect.every((v, i) => v === last!.rect[i]))) return;
      last = end;
      selectionReport.current?.(end);
    };
    const measure = () => {
      const sel = window.getSelection();
      const el = scrollRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !el || !isPageTextSelection(sel, el)) return emit(null);
      if (pointerDown) return;
      const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const lastRect = rects[rects.length - 1];
      if (!lastRect) return emit(null);
      for (const page of mountedPages.current.values()) {
        const box = page.element.getBoundingClientRect();
        const x = lastRect.left + lastRect.width / 2;
        const y = lastRect.top + lastRect.height / 2;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
        const local = { left: lastRect.left - box.left, top: lastRect.top - box.top, width: lastRect.width, height: lastRect.height };
        return emit({ page: page.index, rect: cssToPdf(page.viewport, local) });
      }
      emit(null);
    };
    const onDown = (e: PointerEvent) => {
      if (scrollRef.current?.contains(e.target as Node)) pointerDown = true;
    };
    const onUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      requestAnimationFrame(measure);
    };
    document.addEventListener("selectionchange", measure);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("selectionchange", measure);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
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
      goToAnchor(anchor) {
        const l = layoutRef.current;
        if (l) scrollToOffset(offsetOf(l, anchor));
      },
      async goToTarget(target) {
        const l = layoutRef.current;
        if (!l) return;
        // Destinations come from the PDF and can point outside it.
        const pageIndex = Math.min(Math.max(target.page, 0), l.tops.length - 1);
        if (target.y === null) return goToPage(pageIndex);
        try {
          const page = await doc.getPage(pageIndex + 1);
          // On a rotated page a destination's y alone doesn't give the
          // on-screen height (that needs its x too), so go to the page top.
          if (page.rotate % 180 !== 0) return goToPage(pageIndex);
          const vp = page.getViewport({ scale: l.zoom * PDF_TO_CSS });
          const [, y] = vp.convertToViewportPoint(0, target.y);
          scrollToOffset(l.tops[pageIndex] + y - PADDING / 2);
        } catch {
          goToPage(pageIndex);
        }
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
      async scrollToEye(pageIndex, rect, fraction) {
        const l = layoutRef.current;
        const el = scrollRef.current;
        if (!l || !el) return;
        const page = await doc.getPage(pageIndex + 1);
        const r = toCssRect(page.getViewport({ scale: l.zoom * PDF_TO_CSS }), rect);
        const top = Math.max(0, l.tops[pageIndex] + r.top - fraction * el.clientHeight);
        const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: calm ? "auto" : "smooth" });
        else el.scrollTop = top;
      },
      async pointAt(fraction) {
        const l = layoutRef.current;
        const el = scrollRef.current;
        if (!l || !el) return null;
        const anchor = anchorAt(l, el.scrollTop + fraction * el.clientHeight);
        const page = await doc.getPage(anchor.page + 1);
        const vp = page.getViewport({ scale: l.zoom * PDF_TO_CSS });
        const [x, y] = vp.convertToPdfPoint(vp.width / 2, anchor.fraction * vp.height);
        return { page: anchor.page, x, y };
      },
      async isInView(pageIndex, rect) {
        const l = layoutRef.current;
        const el = scrollRef.current;
        if (!l || !el) return false;
        const page = await doc.getPage(pageIndex + 1);
        const r = toCssRect(page.getViewport({ scale: l.zoom * PDF_TO_CSS }), rect);
        const top = l.tops[pageIndex] + r.top;
        return top + r.height > el.scrollTop && top < el.scrollTop + el.clientHeight;
      },
      captureSelection() {
        const sel = window.getSelection();
        const el = scrollRef.current;
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !el || !isPageTextSelection(sel, el)) return null;
        return captureSelection(sel.getRangeAt(0), [...mountedPages.current.values()]);
      },
      clearSelection() {
        window.getSelection()?.removeAllRanges();
      },
    };
  }, [doc]);

  // Area capture by keyboard: arrows place and move a rectangle on the
  // current page, Shift+arrows resize it, Enter captures it.
  const [keyRect, setKeyRect] = useState<{ page: number; rect: CssRect } | null>(null);
  useEffect(() => {
    if (!captureMode) setKeyRect(null);
  }, [captureMode]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!captureMode || !layout || e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return;
    const el = e.currentTarget;
    if (e.key === "Enter") {
      const info = keyRect && mountedPages.current.get(keyRect.page);
      if (!info || !keyRect || !onCapture) return;
      e.preventDefault();
      onCapture(keyRect.page, cssToPdf(info.viewport, keyRect.rect));
      return;
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [dx, dy] = step.map((v) => v * 10);
    setKeyRect((prev) => {
      if (!prev) {
        const page = currentPage(layout, el.scrollTop, el.clientHeight);
        const w = layout.widths[page];
        const h = layout.heights[page];
        const centre = el.scrollTop + el.clientHeight / 2 - layout.tops[page];
        const rect = { left: w / 4, top: centre - h / 16, width: w / 2, height: h / 8 };
        return { page, rect: clampRect(rect, w, h) };
      }
      const r = prev.rect;
      const next = e.shiftKey
        ? { ...r, width: Math.max(10, r.width + dx), height: Math.max(10, r.height + dy) }
        : { ...r, left: r.left + dx, top: r.top + dy };
      return { page: prev.page, rect: clampRect(next, layout.widths[prev.page], layout.heights[prev.page]) };
    });
  };

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
        marks={marks?.get(i)}
        onMarkClick={onMarkClick}
        captureMode={captureMode}
        onCapture={onCapture}
        keyRect={keyRect?.page === i ? keyRect.rect : null}
        overlay={overlay}
        hiddenAnnotations={hiddenAnnotations}
        focusRects={focus ? (focus.get(i) ?? NO_RECTS) : null}
        onPageClick={onPageClick}
        spotsFor={spotsFor}
        onSpotHover={onSpotHover}
        onSpotActivate={onSpotActivate}
        onRegister={onRegister}
        onSize={onPageSize}
      />,
    );
  }

  return (
    <div
      className={captureMode ? "viewer-scroll capturing" : "viewer-scroll"}
      ref={scrollRef}
      role="document"
      aria-label={name}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      {error && (
        <p className="viewer-error" role="alert">
          This PDF could not be displayed: {error}
        </p>
      )}
      {layout && (
        <div className="viewer-pages" style={{ height: layout.totalHeight, width: innerWidth }}>
          {/* What a pinch scales while it lasts; the box outside keeps the scroll range. */}
          <div className="viewer-zoom" ref={zoomRef}>
            {pages}
          </div>
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
  marks?: Mark[];
  onMarkClick?: (id: string | null) => void;
  captureMode: boolean;
  onCapture?: (page: number, rect: PdfRect) => void;
  /** The rectangle being placed with the keyboard on this page. */
  keyRect: CssRect | null;
  overlay?: Props["overlay"];
  /** Only its identity matters: the page redraws when it changes. */
  hiddenAnnotations: ReadonlySet<string>;
  /** Focus mode: what stays lit on this page (null: not in focus mode). */
  focusRects: readonly PdfRect[] | null;
  onPageClick?: Props["onPageClick"];
  spotsFor?: Props["spotsFor"];
  onSpotHover?: Props["onSpotHover"];
  onSpotActivate?: Props["onSpotActivate"];
  onRegister: (index: number, info: PageInfo | null) => void;
  onSize: (index: number, size: Size) => void;
}

/** Browsers refuse canvases much beyond this many pixels. */
const MAX_CANVAS_PIXELS = 16_000_000;

function PageView({
  doc,
  index,
  top,
  left,
  width,
  height,
  zoom,
  highlights,
  marks,
  onMarkClick,
  captureMode,
  onCapture,
  keyRect,
  overlay,
  hiddenAnnotations,
  focusRects,
  onPageClick,
  spotsFor,
  onSpotHover,
  onSpotActivate,
  onRegister,
  onSize,
}: PageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // pdf.js refuses to start a render on a canvas that is still busy, and
  // cancelling is asynchronous, so each render waits for the previous one.
  const lastRender = useRef<Promise<unknown>>(Promise.resolve());
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [failed, setFailed] = useState(false);

  const pageNumber = index + 1;
  const cssScale = zoom * PDF_TO_CSS;

  const [spots, setSpots] = useState<readonly LinkSpot[]>([]);
  useEffect(() => {
    if (!spotsFor) return;
    let cancelled = false;
    spotsFor(index)
      .then((list) => !cancelled && setSpots(list))
      .catch((e) => console.error(`Could not find the links on page ${index + 1}`, e));
    return () => {
      cancelled = true;
    };
  }, [spotsFor, index]);

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
      // Storage carries which annotations Tourmaline draws itself.
      task = page.render({ canvas, viewport: scaled, annotationMode: AnnotationMode.ENABLE_STORAGE });
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
  }, [page, viewport, cssScale, pageNumber, hiddenAnnotations]);

  // Text layer: invisible, selectable text positioned over the canvas; also
  // what screen readers read.
  const textLayer = useRef<TextLayer | null>(null);
  const itemOf = useRef(new Map<Element, number>());
  const [textReady, setTextReady] = useState(false);
  useEffect(() => {
    const container = textRef.current;
    if (!page || !viewport || !container) return;
    if (textLayer.current) {
      textLayer.current.update({ viewport });
      return;
    }
    let cancelled = false;
    getTextContent(doc, index)
      .then(async (content) => {
        if (cancelled) return;
        const layer = new TextLayer({ textContentSource: content, container, viewport });
        textLayer.current = layer;
        await layer.render();
        // The layer makes one span per text item (markers excluded), in order.
        const spans = layer.textDivs;
        let k = 0;
        content.items.forEach((item, i) => {
          if ("str" in item) {
            const span = spans[k++];
            if (span) itemOf.current.set(span, i);
          }
        });
        // Not `cancelled`: a zoom while rendering re-runs this effect, which
        // only updates the layer, and the page must still become selectable.
        // The layer is only replaced when the page unmounts.
        if (textLayer.current === layer) setTextReady(true);
      })
      .catch((err) => console.warn(`Text layer for page ${pageNumber} failed`, err));
    return () => {
      cancelled = true;
    };
  }, [doc, index, page, viewport, pageNumber]);

  useEffect(() => {
    const element = pageRef.current;
    const text = textRef.current;
    if (!textReady || !viewport || !element || !text) return;
    onRegister(index, { index, element, textLayer: text, viewport, itemOf: itemOf.current });
    return () => onRegister(index, null);
  }, [textReady, viewport, index, onRegister]);
  // When the page scrolls away, free what pdf.js cached for drawing it
  // (operator list, decoded images) once any render in flight has settled.
  const loadedPage = useRef<PDFPageProxy | null>(null);
  loadedPage.current = page;
  useEffect(
    () => () => {
      textLayer.current?.cancel();
      textLayer.current = null;
      const loaded = loadedPage.current;
      if (loaded) void lastRender.current.finally(() => loaded.cleanup());
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

  // A click that isn't the end of a text selection selects the smallest mark under it.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (captureMode || !viewport) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const box = e.currentTarget.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(e.clientX - box.left, e.clientY - box.top);
    onPageClick?.(index, x, y);
    if (!onMarkClick) return;
    let hit: { id: string; area: number } | null = null;
    for (const m of marks ?? []) {
      for (const [x0, y0, x1, y1] of m.rects) {
        const area = (x1 - x0) * (y1 - y0);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!hit || area < hit.area)) hit = { id: m.id, area };
      }
    }
    onMarkClick(hit?.id ?? null);
  };

  const toCss = useCallback((rect: PdfRect) => (viewport ? toCssRect(viewport, rect) : { left: 0, top: 0, width: 0, height: 0 }), [viewport]);

  return (
    <div
      ref={pageRef}
      className="page"
      style={{ top, left, width, height, ["--total-scale-factor" as string]: cssScale }}
      role="region"
      aria-label={`Page ${pageNumber} of ${doc.numPages}`}
      onClick={onClick}
    >
      <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
      {viewport && marks && marks.length > 0 && (
        <div className="mark-layer" aria-hidden="true">
          {marks.flatMap((m) =>
            m.rects.map((rect, j) => (
              <div
                key={`${m.id}-${j}`}
                className={`mark mark-${m.kind}${m.selected ? " selected" : ""}`}
                style={{ ...toCssRect(viewport, rect), ["--mark-colour" as string]: m.colour }}
              />
            )),
          )}
        </div>
      )}
      <div ref={textRef} className="textLayer" onPointerDown={onPointerDown} />
      {viewport && focusRects && <FocusLayer width={width} height={height} rects={focusRects.map((r) => toCssRect(viewport, r))} />}
      {viewport && spots.length > 0 && (
        <div className="link-layer">
          {spots.flatMap((spot) =>
            spot.rects.map((rect, j) => (
              <a
                key={`${spot.id}-${j}`}
                href="#"
                className="link-spot"
                style={toCssRect(viewport, rect)}
                draggable={false}
                // A middle click would follow href="#" in a new window.
                onAuxClick={(e) => e.preventDefault()}
                // One tab stop per link, even when it covers several rectangles.
                tabIndex={j === 0 ? 0 : -1}
                aria-label={spot.label}
                onMouseEnter={(e) => onSpotHover?.(index, spot, e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => onSpotHover?.(index, null)}
                onFocus={(e) => onSpotHover?.(index, spot, e.currentTarget.getBoundingClientRect())}
                onBlur={() => onSpotHover?.(index, null)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSpotActivate?.(index, spot, e.ctrlKey || e.metaKey);
                }}
              />
            )),
          )}
        </div>
      )}
      {viewport && highlights && highlights.length > 0 && (
        <div className="highlight-layer" aria-hidden="true">
          {highlights.flatMap((h, i) =>
            h.rects.map((rect, j) => (
              <div key={`${i}-${j}`} className={h.active ? "search-hit active" : "search-hit"} style={toCssRect(viewport, rect)} />
            )),
          )}
        </div>
      )}
      {captureMode && viewport && onCapture && (
        <CaptureLayer
          width={width}
          height={height}
          keyRect={keyRect}
          onDone={(r) => onCapture(index, cssToPdf(viewport, r))}
        />
      )}
      {overlay && viewport && (
        <div
          className="page-overlay"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {overlay(index, toCss)}
        </div>
      )}
      {failed && <p className="page-error">Page {pageNumber} could not be rendered.</p>}
    </div>
  );
}

/** Drag to draw a rectangle on a page (area capture). */
/** Keeps a rectangle inside a page of the given size. */
function clampRect(r: CssRect, width: number, height: number): CssRect {
  const w = Math.min(r.width, width);
  const h = Math.min(r.height, height);
  return {
    left: Math.min(Math.max(r.left, 0), width - w),
    top: Math.min(Math.max(r.top, 0), height - h),
    width: w,
    height: h,
  };
}

function CaptureLayer({
  width,
  height,
  keyRect,
  onDone,
}: {
  width: number;
  height: number;
  keyRect: CssRect | null;
  onDone: (rect: CssRect) => void;
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    // Pointer capture keeps reporting outside the page; stay on it.
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return [clamp(e.clientX - box.left, width), clamp(e.clientY - box.top, height)] as const;
  };
  const rect = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
  return (
    <div
      className="capture-layer"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, y] = local(e);
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const [x, y] = local(e);
        setDrag({ ...drag, x1: x, y1: y });
      }}
      onPointerUp={() => {
        setDrag(null);
        if (rect && rect.width > 4 && rect.height > 4) onDone(rect);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {(rect ?? keyRect) && <div className="capture-rect" style={(rect ?? keyRect)!} />}
    </div>
  );
}

/**
 * Whether a selection is PDF text in this viewer: both ends in a page's text
 * layer. Text selected in a note editor on a popover (also inside the viewer)
 * is not.
 */
function isPageTextSelection(sel: Selection, viewer: HTMLElement): boolean {
  const inTextLayer = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    const layer = element?.closest(".textLayer");
    return !!layer && viewer.contains(layer);
  };
  return inTextLayer(sel.anchorNode) && inTextLayer(sel.focusNode);
}
