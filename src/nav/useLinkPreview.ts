import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkSpot } from "../pdf/PdfViewer";
import type { Destination, Spot } from "./useReferences";

export interface LinkPreview {
  page: number;
  spot: Spot;
  destination: Destination;
  /** The link on screen. */
  at: DOMRect;
}

/**
 * Which link's preview is showing in a pane: it opens a moment after the
 * pointer (or keyboard focus) reaches a link, and stays while the pointer
 * moves onto the preview itself. `reset` changes (another document) close it.
 */
export function useLinkPreview(destinationOf: (spot: Spot, page: number) => Promise<Destination | null>, reset: unknown) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setPreview(null), [reset]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSpotHover = useCallback(
    (page: number, spot: LinkSpot | null, at?: DOMRect) => {
      clearTimeout(timer.current);
      if (!spot || !at) {
        // A moment to move onto the preview itself.
        timer.current = setTimeout(() => setPreview(null), 250);
        return;
      }
      timer.current = setTimeout(() => {
        destinationOf(spot as Spot, page)
          .then((destination) => setPreview(destination ? { page, spot: spot as Spot, destination, at } : null))
          .catch((e) => console.error("Could not find where the link leads", e));
      }, 300);
    },
    [destinationOf],
  );

  /** The pointer is on the preview: keep it. */
  const keep = useCallback(() => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setPreview(null);
  }, []);
  return { preview, onSpotHover, keep, close };
}
