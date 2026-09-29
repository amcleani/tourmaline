import { useEffect, useRef } from "react";
import { MENU_ORDER, type CommandRegistry } from "../commands/registry";
import { formatShortcut } from "../commands/shortcuts";

// Help > Keyboard shortcuts: every command grouped by menu, with its shortcut.
export function ShortcutsDialog({ registry, onClose }: { registry: CommandRegistry; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const sections = MENU_ORDER.map((menu) => ({
    menu,
    commands: registry.menuGroups(menu).flat(),
  })).filter((s) => s.commands.length > 0);
  const unplaced = registry.all().filter((c) => !c.menu && !c.hideInPalette);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        }}
      >
        <header className="dialog-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          {[...sections, ...(unplaced.length ? [{ menu: "Other", commands: unplaced }] : [])].map((s) => (
            <section key={s.menu}>
              <h3>{s.menu}</h3>
              <table className="shortcut-table">
                <tbody>
                  {s.commands.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{c.title}</th>
                      <td>{c.shortcut ? <kbd>{formatShortcut(c.shortcut)}</kbd> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
