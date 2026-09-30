import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Bibliography } from "../vault/bibliography";
import { authorString } from "../vault/bibliography";
import type { BibEntry } from "../vault/bibtex";

interface Props {
  bibliography: Bibliography;
  /** The entry the paper is linked to now, listed first. */
  current: string | null;
  /** The PDF's name, shown so the user knows what they're linking. */
  fileName: string;
  onPick: (citekey: string) => void;
  onClose: () => void;
}

// File › Link to bibliography entry: the command palette's combobox pattern
// over JabRef entries. Every word typed must appear in the citekey, title,
// authors or year.
export function EntryPicker({ bibliography, current, fileName, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const found = bibliography.search(query);
    const linked = current ? bibliography.get(current) : undefined;
    if (!query.trim() && linked) return [linked, ...found.filter((e) => e !== linked)];
    return found;
  }, [bibliography, query, current]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const pick = (entry: BibEntry) => {
    onClose();
    onPick(entry.key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        setActive((i) => (results.length ? (i + 1) % results.length : 0));
        break;
      case "ArrowUp":
        setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
        break;
      case "Enter":
        if (results[active]) pick(results[active]);
        break;
      case "Escape":
        onClose();
        break;
      default:
        e.stopPropagation();
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="palette entry-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Link ${fileName} to a bibliography entry`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          aria-describedby={`${listId}-hint`}
          placeholder="Search citekey, title, author or year…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <p id={`${listId}-hint`} className="entry-picker-hint muted">
          Link <strong>{fileName}</strong> to its entry in {bibliography.path.replace(/^.*[\\/]/, "")}
        </p>
        <ul id={listId} className="palette-list" role="listbox" aria-label="Bibliography entries">
          {results.map((entry, i) => (
            <li
              key={entry.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="entry-option"
              onMouseMove={() => setActive(i)}
              onClick={() => pick(entry)}
            >
              <span className="entry-key">
                {entry.key}
                {entry.key === current && <span className="entry-current"> (linked)</span>}
              </span>
              <span className="entry-title">{entry.fields.title ?? "Untitled"}</span>
              <span className="entry-meta">
                {[authorString(entry), entry.fields.year].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
          {results.length === 0 && (
            <li className="palette-empty" role="presentation">
              No matching entries
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
