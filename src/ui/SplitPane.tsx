import { useId, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useLinkPreview } from "../nav/useLinkPreview";
import { useReferences, type Spot } from "../nav/useReferences";
import { clampZoom, nextZoom, type Anchor } from "../pdf/layout";
import { PdfViewer, type Mark, type ViewerHandle, type ViewState, type ZoomSpec } from "../pdf/PdfViewer";
import { openExternal } from "../platform";
import { Icon } from "./icons";
import { ReferencePreview } from "./ReferencePreview";

export interface SplitTab {
  key: string;
  name: string;
  pdf: PDFDocumentProxy;
  fileId: string;
}

interface Props {
  tabs: readonly SplitTab[];
  /** The tab shown. */
  tab: SplitTab;
  onTab: (key: string) => void;
  zoom: ZoomSpec;
  onZoom: (zoom: ZoomSpec) => void;
  /** Where to open (read when the pane's document changes). */
  initialAnchor: Anchor | null;
  /** Highlights to show, when the pane shows the paper open on the left. */
  marks?: ReadonlyMap<number, Mark[]>;
  handleRef: React.RefObject<ViewerHandle | null>;
  onViewChange: (view: ViewState) => void;
  onClose: () => void;
  onError: (what: string, err: unknown) => void;
}

// View › Split view: a second pane beside the document, on the same paper
// (to keep its references or a figure in view) or another open tab. Ctrl+click
// on a link in the main pane opens it here. Links in this pane work as in
// the main one; its zoom has its own buttons (and the zoom keys act on it
// while it has focus).
export function SplitPane({ tabs, tab, onTab, zoom, onZoom, initialAnchor, marks, handleRef, onViewChange, onClose, onError }: Props) {
  const id = useId();
  const references = useReferences(tab.pdf);
  const { preview, onSpotHover, keep, close } = useLinkPreview(references.destinationOf, tab.key);
  const lastZoom = useRef(zoom.zoom);

  const follow = async (page: number, spot: Spot) => {
    close();
    try {
      const destination = await references.destinationOf(spot, page);
      if (!destination) return;
      if (destination.url) return await openExternal(destination.url);
      await handleRef.current?.goToTarget({ page: destination.page, y: destination.y === null ? null : destination.y + 12 });
    } catch (e) {
      onError("Could not follow the link", e);
    }
  };

  return (
    <section className="split-pane" aria-labelledby={`${id}-title`}>
      <header className="split-header">
        <h2 id={`${id}-title`} className="visually-hidden">
          Second pane
        </h2>
        <label className="visually-hidden" htmlFor={`${id}-tab`}>
          Document in the second pane
        </label>
        <select id={`${id}-tab`} className="select split-select" value={tab.key} onChange={(e) => onTab(e.target.value)}>
          {tabs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className="icon-button" aria-label="Zoom out (second pane)" onClick={() => onZoom({ mode: "custom", zoom: nextZoom(lastZoom.current, -1) })}>
          <Icon name="zoom-out" size={16} />
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in (second pane)" onClick={() => onZoom({ mode: "custom", zoom: nextZoom(lastZoom.current, 1) })}>
          <Icon name="zoom-in" size={16} />
        </button>
        <button type="button" className="icon-button" aria-label="Fit width (second pane)" onClick={() => onZoom({ mode: "fit-width", zoom: lastZoom.current })}>
          <Icon name="fit-width" size={16} />
        </button>
        <button type="button" className="icon-button" aria-label="Close the second pane" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="split-body">
        <PdfViewer
          key={`${tab.key}:${tab.fileId}`}
          doc={tab.pdf}
          name={`${tab.name} (second pane)`}
          zoom={zoom}
          initialAnchor={initialAnchor}
          onViewChange={(v) => {
            lastZoom.current = v.zoom;
            close();
            onViewChange(v);
          }}
          onZoomStep={(d) => onZoom({ mode: "custom", zoom: nextZoom(lastZoom.current, d) })}
          onZoomTo={(z) => onZoom({ mode: "custom", zoom: clampZoom(z) })}
          handleRef={handleRef}
          marks={marks}
          spotsFor={references.spotsFor}
          onSpotHover={onSpotHover}
          onSpotActivate={(page, spot) => void follow(page, spot as Spot)}
        />
        {preview && (
          <ReferencePreview
            key={preview.spot.id}
            pdf={tab.pdf}
            destination={preview.destination}
            anchor={preview.at}
            zoom={lastZoom.current}
            onMouseEnter={keep}
            onMouseLeave={() => onSpotHover(preview.page, null)}
          />
        )}
      </div>
    </section>
  );
}
