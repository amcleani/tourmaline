import { useEffect, useId, useRef, useState } from "react";

interface Props {
  name: string;
  count: number;
  onSave: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

// Asked before Tourmaline first writes into a PDF (File › Save annotations
// into PDF). Escape cancels; nothing is written until Save.
export function WriteBackDialog({ name, count, onSave, onCancel }: Props) {
  const saveRef = useRef<HTMLButtonElement>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    saveRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog small"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>Save annotations into the PDF?</h2>
        </header>
        <div className="dialog-body">
          <div id={`${id}-body`}>
            <p>
              {count === 1 ? "1 annotation" : `${count} annotations`} will be written into “{name}”, so other PDF readers
              (and Obsidian's) show them. Annotations deleted here are removed from the file.
            </p>
            <p className="muted">
              The changes are added to the end of the file, and the file as it is now is backed up in Tourmaline's data
              folder first.
            </p>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            Don't ask again
          </label>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button ref={saveRef} type="button" className="button primary" onClick={() => onSave(dontAsk)}>
              Save into PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
