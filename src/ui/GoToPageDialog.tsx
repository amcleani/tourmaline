import { useEffect, useRef, useState } from "react";

interface Props {
  pageCount: number;
  current: number;
  /** Printed page labels (e.g. "xii", "37"), if the PDF defines them. */
  labels: string[] | null;
  onGo: (page: number) => void;
  onClose: () => void;
}

/** Resolves typed input to a 0-based page: a page label first, then a page number. */
export function parsePageInput(input: string, pageCount: number, labels: string[] | null): number | null {
  const value = input.trim();
  if (!value) return null;
  const byLabel = labels?.findIndex((l) => l.toLowerCase() === value.toLowerCase()) ?? -1;
  if (byLabel !== -1) return byLabel;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= pageCount ? n - 1 : null;
}

export function GoToPageDialog({ pageCount, current, labels, onGo, onClose }: Props) {
  const [value, setValue] = useState(labels?.[current] ?? String(current + 1));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.select();
    return () => previous?.focus?.();
  }, []);

  const submit = () => {
    const page = parsePageInput(value, pageCount, labels);
    if (page === null) {
      setError(`Enter a page from 1 to ${pageCount}${labels ? " or a printed page label" : ""}.`);
      return;
    }
    onClose();
    onGo(page);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goto-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id="goto-title">Go to page</h2>
        </div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="goto-input" className="field-label">
            Page (1–{pageCount}){labels ? " or printed label" : ""}
          </label>
          <input
            id="goto-input"
            ref={inputRef}
            className="text-input"
            value={value}
            aria-invalid={error !== null}
            aria-describedby={error ? "goto-error" : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id="goto-error" className="field-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary">
              Go
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
