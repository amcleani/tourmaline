import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ContextMenuEntry } from "../commands/contextMenus";
import type { Command, CommandRegistry } from "../commands/registry";
import { formatShortcut, toAriaShortcut } from "../commands/shortcuts";

interface Props {
  registry: CommandRegistry;
  entries: ContextMenuEntry[];
  /** Where it opens, in window coordinates (kept inside the window). */
  at: { x: number; y: number };
  label: string;
  onClose: () => void;
  /** Runs a chosen entry instead of executing it as a registry command (entries made for this menu). */
  onRun?: (entry: Command) => void;
}

// A right-click menu (ARIA menu): focus starts on the first item, Up/Down/
// Home/End move, Enter or Space runs one, Escape or Tab closes it. It closes
// on a click elsewhere, scrolling or the window losing focus; focus goes
// back where it was.
export function ContextMenu({ registry, entries, at, label, onClose, onRun }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.max(4, Math.min(at.x, window.innerWidth - el.offsetWidth - 4));
    const top = Math.max(4, at.y + el.offsetHeight > window.innerHeight - 4 ? at.y - el.offsetHeight : at.y);
    setPlace({ left, top: Math.min(top, Math.max(4, window.innerHeight - el.offsetHeight - 4)) });
  }, [at]);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      returnTo.current?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const run = (entry: Command) => {
    onClose();
    // After the menu has gone and focus is back on the document.
    setTimeout(() => (onRun ? onRun(entry) : registry.execute(entry.id, "menu")));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Escape" || e.key === "Tab" || (e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Type-ahead: the next item starting with that letter.
      const letter = e.key.toLowerCase();
      for (let k = 1; k <= items.length; k++) {
        const item = items[(i + k) % items.length];
        if (item.dataset.title?.toLowerCase().startsWith(letter)) {
          next = (i + k) % items.length;
          break;
        }
      }
    }
    // Every other key stays in the menu (no shortcuts run behind it).
    e.stopPropagation();
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={place ?? { left: at.x, top: at.y, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === "-" ? (
          <div key={`sep${i}`} role="separator" className="context-separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="context-item"
            data-title={entry.title}
            aria-keyshortcuts={entry.shortcut ? toAriaShortcut(entry.shortcut) : undefined}
            onClick={() => run(entry)}
          >
            <span>{entry.title}</span>
            {entry.shortcut && <kbd aria-hidden="true">{formatShortcut(entry.shortcut)}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
