import { useEffect, useRef } from "react";

interface Props {
  name: string;
  onSame: () => void;
  onDifferent: () => void;
}

// Asked when a file replaced another at the same path but its text looks like
// a different paper. Annotations stay hidden until it's answered. Escape
// chooses the safe answer (a separate paper; nothing is merged).
export function VersionDialog({ name, onSame, onDifferent }: Props) {
  const differentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => differentRef.current?.focus(), []);
  return (
    <div className="overlay">
      <div
        className="dialog small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="version-title"
        aria-describedby="version-body"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDifferent();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="version-title">Same paper?</h2>
        </header>
        <div className="dialog-body">
          <p id="version-body">
            “{name}” has changed since you last opened it, and its text looks like a different paper. Should it keep the
            annotations and reading position of the file it replaced?
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onSame}>
              Same paper, keep annotations
            </button>
            <button ref={differentRef} type="button" className="button primary" onClick={onDifferent}>
              Different paper
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
