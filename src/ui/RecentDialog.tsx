import { useEffect, useId, useRef, useState } from "react";
import type { DocumentInfo } from "../platform";
import { Icon } from "./icons";

interface Props {
  recent: DocumentInfo[];
  onOpen: (doc: DocumentInfo) => void;
  onClose: () => void;
}

// File › Open recent: a listbox of recently opened documents. Up/Down move,
// Enter opens, Escape closes; clicking an entry opens it.
export function RecentDialog({ recent, onOpen, onClose }: Props) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    listRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const open = (doc: DocumentInfo) => {
    onClose();
    onOpen(doc);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = recent.length - 1;
    switch (e.key) {
      case "ArrowDown":
        setActive((i) => Math.min(i + 1, last));
        break;
      case "ArrowUp":
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(Math.max(last, 0));
        break;
      case "Enter":
        if (recent[active]) open(recent[active]);
        break;
      case "Escape":
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 id="recent-title">Open recent</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        {recent.length === 0 ? (
          <p className="dialog-body muted">No recent documents.</p>
        ) : (
          <ul
            ref={listRef}
            id={listId}
            className="recent-list"
            role="listbox"
            aria-label="Recent documents"
            aria-activedescendant={`${listId}-${active}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            {recent.map((doc, i) => (
              <li
                key={doc.workId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="recent-option"
                title={doc.path ?? undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => open(doc)}
              >
                <Icon name="file" />
                <span className="recent-name">{doc.name}</span>
                <span className="recent-path muted">{doc.path}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
