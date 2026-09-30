import { useEffect, useRef, useState } from "react";
import { CALLOUT_TYPES, type Category } from "../annotations/types";
import { Icon } from "./icons";

interface Props {
  categories: readonly Category[];
  /** Resolves when saved; rejects with a message to show. */
  onSave: (categories: Category[]) => Promise<void>;
  onClose: () => void;
}

const PALETTE = ["#f7d14c", "#f28b82", "#8ab4f8", "#c58af9", "#81c995", "#fbbc6c", "#78d9ec", "#e6a4c8"];

/** Checks a category list before saving; returns an error message or null. */
export function validateCategories(list: readonly Category[]): string | null {
  if (list.some((c) => !c.name.trim())) return "Every category needs a name.";
  const keys = list.map((c) => c.hotkey).filter((k): k is number => k !== null);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup !== undefined) return `Key ${dup} is used by two categories.`;
  return null;
}

// Annotate › Edit categories: name, colour, the Obsidian callout used on
// export, and the key that highlights with it. Removing a category keeps its
// annotations (they keep the colour, and can be moved to another category).
export function CategoriesDialog({ categories, onSave, onClose }: Props) {
  const [list, setList] = useState<Category[]>(() => categories.filter((c) => !c.deleted).map((c) => ({ ...c })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const change = (i: number, patch: Partial<Category>) => {
    setError(null);
    setList((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };
  const move = (i: number, by: -1 | 1) =>
    setList((prev) => {
      const j = i + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    const usedKeys = new Set(list.map((c) => c.hotkey));
    const key = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((k) => !usedKeys.has(k)) ?? null;
    setList((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "New category",
        colour: PALETTE[prev.length % PALETTE.length],
        callout: "quote",
        hotkey: key,
        deleted: false,
      },
    ]);
  };

  const save = async () => {
    const problem = validateCategories(list);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      // Categories left out are marked deleted by the library.
      await onSave(list);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="categories-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="categories-title">Categories</h2>
        </header>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <table className="categories-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Colour</th>
                <th scope="col">Callout</th>
                <th scope="col">Key</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      className="text-input"
                      value={c.name}
                      aria-label={`Name of category ${i + 1}`}
                      onChange={(e) => change(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      value={c.colour}
                      aria-label={`Colour of ${c.name}`}
                      onChange={(e) => change(i, { colour: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={c.callout}
                      aria-label={`Obsidian callout for ${c.name}`}
                      onChange={(e) => change(i, { callout: e.target.value })}
                    >
                      {CALLOUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="select"
                      value={c.hotkey ?? ""}
                      aria-label={`Key for ${c.name}`}
                      onChange={(e) => change(i, { hotkey: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">None</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="icon-button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => move(i, 1)}
                      disabled={i === list.length - 1}
                      aria-label={`Move ${c.name} down`}
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setList((prev) => prev.filter((_, j) => j !== i))}
                      disabled={list.length === 1}
                      aria-label={`Remove ${c.name}`}
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="button" onClick={add}>
            <Icon name="add" size={16} /> Add category
          </button>
          <p className="muted small">Removing a category keeps its annotations and their colour.</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
