import { useEffect, useRef, useState } from "react";
import { assignShortcut, checkShortcut } from "../commands/keymap";
import { MENU_ORDER, type Command, type CommandRegistry, type ShortcutOverrides } from "../commands/registry";
import { eventToShortcut, formatShortcut, normaliseShortcut } from "../commands/shortcuts";

interface Props {
  registry: CommandRegistry;
  /** The user's shortcuts; changed through onChange (which saves them). */
  overrides: ShortcutOverrides;
  onChange: (overrides: ShortcutOverrides) => void;
  /** Category shortcuts (1-9) belong to Edit categories. */
  onEditCategories: () => void;
  onClose: () => void;
}

type Pending = { id: string; shortcut: string; other: Command };

const isCategory = (id: string) => id.startsWith("annot.category.");
const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"];

// Help › Keyboard shortcuts: every command grouped by menu, with its shortcut,
// each of which can be changed, removed or reset. "Change" listens for the
// next key combination (Escape cancels, Tab leaves); a shortcut another
// command has is only taken after asking.
export function ShortcutsDialog({ registry, overrides, onChange, onEditCategories, onClose }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    registry.setRecording(recording !== null);
  }, [registry, recording]);
  useEffect(() => () => registry.setRecording(false), [registry]);

  const titleOf = (id: string) => registry.get(id)?.title ?? id;
  const apply = (id: string, shortcut: string | null, announce: string) => {
    onChange(assignShortcut(registry, overrides, id, shortcut));
    setMessage(announce);
    setError(null);
    setPending(null);
    // The button that was pressed may be gone (Remove, Reset): back to the row's Change.
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) returnTo.current?.focus();
    });
  };
  const stopRecording = (focusBack = true) => {
    setRecording(null);
    if (focusBack) setTimeout(() => returnTo.current?.focus());
  };

  const onRecordKey = (id: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (MODIFIER_KEYS.includes(e.key)) return;
    // Tab leaves the field (and stops listening), as everywhere else.
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      stopRecording();
      return;
    }
    const shortcut = eventToShortcut(e.nativeEvent);
    if (!shortcut) return;
    const check = checkShortcut(registry, id, shortcut);
    if (check.kind === "invalid") {
      setError({ id, text: `${formatShortcut(shortcut)} can't be used: ${check.reason}` });
      return;
    }
    stopRecording(check.kind === "ok");
    if (check.kind === "ok") {
      apply(id, check.shortcut, `${formatShortcut(check.shortcut)} now runs “${titleOf(id)}”.`);
    } else {
      setError(null);
      setPending({ id, shortcut: check.shortcut, other: check.other });
    }
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (c: Command, menu: string) => {
    const text = `${c.title} ${menu} ${c.shortcut ? formatShortcut(c.shortcut) : ""} ${(c.keywords ?? []).join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const sections = [
    ...MENU_ORDER.map((menu) => ({ menu: menu as string, commands: registry.menuGroups(menu).flat() })),
    { menu: "Other", commands: registry.all().filter((c) => !c.menu && !c.hideInPalette) },
  ]
    .map((s) => ({ ...s, commands: s.commands.filter((c) => matches(c, s.menu)) }))
    .filter((s) => s.commands.length > 0);

  const changed = Object.keys(overrides).length > 0;

  const row = (c: Command) => {
    const def = registry.defaultShortcut(c.id);
    const isChanged = (c.shortcut ?? null) !== (def ? normaliseShortcut(def) : null);
    const labelId = `shortcut-${c.id}`;
    return (
      <tr key={c.id}>
        <th scope="row" id={labelId}>
          {c.title}
        </th>
        <td className="shortcut-keys">
          {recording === c.id ? (
            <input
              className="text-input key-recorder"
              readOnly
              autoFocus
              value=""
              placeholder="Press keys…"
              aria-label={`New shortcut for ${c.title}. Press the keys, or Escape to cancel.`}
              aria-invalid={error?.id === c.id}
              aria-describedby={error?.id === c.id ? `${labelId}-error` : undefined}
              onKeyDown={(e) => onRecordKey(c.id, e)}
              onBlur={() => stopRecording(false)}
            />
          ) : c.shortcut ? (
            <kbd>{formatShortcut(c.shortcut)}</kbd>
          ) : (
            <span className="muted">None</span>
          )}
          {isChanged && recording !== c.id && <span className="shortcut-changed"> (changed)</span>}
          {error?.id === c.id && (
            <p className="field-error" id={`${labelId}-error`} role="alert">
              {error.text}
            </p>
          )}
          {pending?.id === c.id && (
            <div className="shortcut-conflict" role="alert">
              <p>
                {formatShortcut(pending.shortcut)} runs “{pending.other.title}”. Use it for “{c.title}” instead?
              </p>
              <button
                type="button"
                className="button small primary"
                autoFocus
                onClick={() => apply(c.id, pending.shortcut, `${formatShortcut(pending.shortcut)} now runs “${c.title}”; “${pending.other.title}” has no shortcut.`)}
              >
                Use it here
              </button>{" "}
              <button type="button" className="button small" onClick={() => setPending(null)}>
                Keep it there
              </button>
            </div>
          )}
        </td>
        <td className="row-actions">
          {isCategory(c.id) ? (
            <button type="button" className="button small" onClick={onEditCategories} aria-describedby={labelId}>
              Edit categories…
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button small"
                aria-describedby={labelId}
                onClick={(e) => {
                  returnTo.current = e.currentTarget;
                  setError(null);
                  setPending(null);
                  setRecording(c.id);
                }}
              >
                Change
              </button>
              {c.shortcut && (
                <button
                  type="button"
                  className="button small"
                  aria-describedby={labelId}
                  onClick={(e) => {
                    returnTo.current = e.currentTarget.parentElement?.querySelector("button") ?? null;
                    apply(c.id, null, `“${c.title}” has no shortcut now.`);
                  }}
                >
                  Remove
                </button>
              )}
              {isChanged && def && (
                <button
                  type="button"
                  className="button small"
                  aria-describedby={labelId}
                  onClick={(e) => {
                    returnTo.current = e.currentTarget.parentElement?.querySelector("button") ?? null;
                    apply(c.id, def, `“${c.title}” is back to ${formatShortcut(def)}.`);
                  }}
                >
                  Reset
                </button>
              )}
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <label className="field-label" htmlFor="shortcut-search">
            Search commands and shortcuts
          </label>
          <input
            ref={searchRef}
            id="shortcut-search"
            className="text-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="visually-hidden" role="status">
            {message}
          </p>
          {sections.length === 0 && <p className="muted">No command matches.</p>}
          {sections.map((s) => (
            <section key={s.menu}>
              <h3>{s.menu}</h3>
              <table className="shortcut-table">
                <tbody>{s.commands.map(row)}</tbody>
              </table>
            </section>
          ))}
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="button"
            disabled={!changed}
            onClick={() => {
              onChange({});
              setMessage("Every shortcut is back to its default.");
            }}
          >
            Reset all shortcuts
          </button>
        </footer>
      </div>
    </div>
  );
}
