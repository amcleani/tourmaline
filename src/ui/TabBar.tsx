import { useRef } from "react";
import { X } from "lucide-react";
import { useShortcutHint } from "../commands/useShortcut";

export interface TabInfo {
  key: string;
  title: string;
  /** Full path, shown as a tooltip. */
  detail?: string | null;
}

interface Props {
  tabs: TabInfo[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  /** The tab whose right-click menu is open: no tooltip over the menu. */
  menuOpenFor?: string | null;
}

// ARIA tablist: Left/Right/Home/End move between tabs and activate them,
// Delete closes the focused tab. Middle-click also closes. A right-click (or
// Shift+F10 / the menu key on a tab) opens the tab's menu, which App builds
// from the registry for the tab marked data-tab-key.
export function TabBar({ tabs, activeKey, onActivate, onClose, menuOpenFor = null }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const closeHint = useShortcutHint("file.closeTab");
  if (tabs.length === 0) return null;

  const focusTab = (key: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else if (e.key === "Delete") {
      e.preventDefault();
      onClose(tabs[index].key);
      return;
    } else return;
    e.preventDefault();
    onActivate(tabs[next].key);
    focusTab(tabs[next].key);
  };

  return (
    <div className="tabbar" role="tablist" aria-label="Open documents" ref={listRef}>
      {tabs.map((tab, i) => {
        const selected = tab.key === activeKey;
        return (
          <div key={tab.key} className={selected ? "tab selected" : "tab"} data-tab-key={tab.key}>
            <button
              type="button"
              role="tab"
              data-key={tab.key}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className="tab-label"
              aria-keyshortcuts="Delete"
              title={tab.key === menuOpenFor ? undefined : (tab.detail ?? tab.title)}
              onClick={() => onActivate(tab.key)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {tab.title}
            </button>
            {/* For the mouse; the keyboard closes a tab with Delete or the Close tab command. */}
            <button
              type="button"
              className="tab-close"
              tabIndex={-1}
              aria-hidden="true"
              title={`Close tab${closeHint}`}
              onClick={() => onClose(tab.key)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
