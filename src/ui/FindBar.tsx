import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { SearchStatus } from "../pdf/useSearch";
import { useShortcutHint } from "../commands/useShortcut";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  count: number;
  active: number;
  status: SearchStatus;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Selects the current match in the page (to highlight it by keyboard). */
  onSelect: () => void;
  /** Incremented to re-focus and select the field when Find is invoked again. */
  focusToken: number;
}

export function FindBar({ query, onQueryChange, count, active, status, onNext, onPrevious, onClose, onSelect, focusToken }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextHint = useShortcutHint("nav.findNext");
  const previousHint = useShortcutHint("nav.findPrevious");
  const selectHint = useShortcutHint("nav.selectMatch");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  let summary = "";
  if (query.trim()) {
    if (count === 0) summary = status === "searching" ? "Searching…" : "No matches";
    else summary = `${active + 1} of ${count}${status === "searching" ? "+" : ""}`;
  }

  return (
    <div className="findbar" role="search" aria-label="Find in document">
      <input
        ref={inputRef}
        type="search"
        className="findbar-input"
        aria-label="Find in document"
        placeholder="Find in document"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="findbar-count" aria-live="polite">
        {summary}
      </span>
      <button type="button" className="icon-button" onClick={onPrevious} disabled={count === 0} aria-label={`Previous match${previousHint}`} title={`Previous match${previousHint}`}>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" onClick={onNext} disabled={count === 0} aria-label={`Next match${nextHint}`} title={`Next match${nextHint}`}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="button small"
        onClick={onSelect}
        aria-disabled={count === 0}
        title={`Select the found text, to highlight it or add a note${selectHint}`}
      >
        Select
      </button>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close find bar (Escape)" title="Close (Escape)">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
