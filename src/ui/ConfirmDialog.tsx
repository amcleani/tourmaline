import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A question with Cancel and one action. Escape or a click outside cancels;
// Cancel has focus, so Enter never overwrites anything by accident.
export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
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
        <div className="dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className="dialog-body">
          <div id={`${id}-body`}>{children}</div>
          <div className="dialog-actions">
            <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={danger ? "button danger" : "button primary"} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
