import { useRef, useSyncExternalStore } from "react";
import type { CommandRegistry } from "../commands/registry";
import { formatShortcut } from "../commands/shortcuts";
import { Icon } from "./icons";

// ARIA toolbar: one Tab stop, arrow keys move between buttons. Disabled
// buttons stay focusable (aria-disabled) so keyboard users can discover them.
export function Toolbar({ registry, children }: { registry: CommandRegistry; children?: React.ReactNode }) {
  useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.getVersion(),
  );
  const ref = useRef<HTMLDivElement>(null);
  const commands = registry.all().filter((c) => c.toolbar && c.icon);
  const ctx = registry.context();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % buttons.length;
    if (e.key === "ArrowLeft") next = (i - 1 + buttons.length) % buttons.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = buttons.length - 1;
    if (next >= 0) {
      e.preventDefault();
      buttons.forEach((b, j) => (b.tabIndex = j === next ? 0 : -1));
      buttons[next].focus();
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar" ref={ref} onKeyDown={onKeyDown}>
      {commands.map((c, i) => {
        const enabled = registry.isEnabled(c.id, ctx);
        const label = c.shortcut ? `${c.title} (${formatShortcut(c.shortcut)})` : c.title;
        return (
          <button
            key={c.id}
            type="button"
            className="toolbar-button"
            tabIndex={i === 0 ? 0 : -1}
            aria-label={c.title}
            aria-keyshortcuts={c.shortcut}
            aria-disabled={!enabled}
            title={label}
            onClick={() => enabled && registry.execute(c.id, "toolbar")}
          >
            <Icon name={c.icon!} />
          </button>
        );
      })}
      <div className="toolbar-spacer" />
      {children}
    </div>
  );
}
