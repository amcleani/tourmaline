// The webview is created with its zoom gestures on, because otherwise it
// never passes trackpad pinches to the page (wry ties pinches to the zoom
// keys). The document viewer zooms the PDF itself; this stops the webview
// from also zooming the whole interface, by pinch or Ctrl+wheel outside the
// document, or by its own zoom keys. The app's zoom commands still run: only
// the browser's default is cancelled.

/** The webview's own zoom keys (Ctrl with +, = , -, 0, on the main keys or the keypad). */
export function isPageZoomKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  return ["+", "=", "-", "_", "0"].includes(e.key) || ["NumpadAdd", "NumpadSubtract", "Numpad0"].includes(e.code);
}

export function preventPageZoom(target: Window = window): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (isPageZoomKey(e)) e.preventDefault();
  };
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("keydown", onKey);
  return () => {
    target.removeEventListener("wheel", onWheel);
    target.removeEventListener("keydown", onKey);
  };
}
