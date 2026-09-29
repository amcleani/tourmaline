import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Command, CommandRegistry } from "../commands/registry";
import { rankByFuzzy } from "../commands/fuzzy";
import { formatShortcut } from "../commands/shortcuts";

interface Props {
  registry: CommandRegistry;
  onClose: () => void;
}

// Ctrl+K palette. Follows the ARIA combobox + listbox pattern: focus stays in
// the input, arrow keys move the active option, Enter runs it, Escape closes.
export function CommandPalette({ registry, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const ctx = registry.context();
    const available = registry.all().filter((c) => !c.hideInPalette && registry.isEnabled(c.id, ctx));
    if (!query.trim()) {
      return available
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((item) => ({ item, match: { score: 0, indices: [] as number[] } }));
    }
    return rankByFuzzy(query, available, (c) => [c.title, ...(c.keywords ?? []), c.menu?.menu ?? ""]);
  }, [registry, query]);

  useEffect(() => {
    // Remember what had focus so it can be restored when the palette closes.
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const run = (command: Command) => {
    onClose();
    // Run after closing so the command sees focus back in the document.
    queueMicrotask(() => registry.execute(command.id, "palette"));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (results.length ? (i + 1) % results.length : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
        break;
      case "Home":
        if (e.ctrlKey) { e.preventDefault(); setActive(0); }
        break;
      case "End":
        if (e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, results.length - 1)); }
        break;
      case "Enter":
        e.preventDefault();
        if (results[active]) run(results[active].item);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
    e.stopPropagation();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
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
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} className="palette-list" role="listbox" aria-label="Commands">
          {results.map(({ item, match }, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="palette-item"
              onMouseMove={() => setActive(i)}
              onClick={() => run(item)}
            >
              <span className="palette-menu">{item.menu?.menu}</span>
              <span className="palette-title">
                <Highlighted text={item.title} indices={match.indices} />
              </span>
              {item.shortcut && <kbd>{formatShortcut(item.shortcut)}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty" role="presentation">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch))}
    </>
  );
}
