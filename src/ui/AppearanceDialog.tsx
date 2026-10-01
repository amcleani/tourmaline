import { useEffect, useRef } from "react";
import { PAGE_COLOURS, THEMES, UI_SCALES, percent, type Appearance } from "../app/appearance";

interface Props {
  appearance: Appearance;
  /** Applies (and saves) a change straight away. */
  onChange: (next: Appearance) => void;
  onClose: () => void;
}

// View › Appearance: theme, page colours and interface size, applied as they
// are chosen.
export function AppearanceDialog({ appearance, onChange, onClose }: Props) {
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // The chosen theme's radio button, as Tab into the group would.
    const checked = document.querySelector<HTMLInputElement>('.appearance-dialog input[name="theme"]:checked');
    (checked ?? firstRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog appearance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="appearance-title">Appearance</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <fieldset className="fieldset">
            <legend>Theme</legend>
            {THEMES.map((t, i) => (
              <label key={t.value} className="radio-label">
                <input
                  ref={i === 0 ? firstRef : undefined}
                  type="radio"
                  name="theme"
                  value={t.value}
                  checked={appearance.theme === t.value}
                  onChange={() => onChange({ ...appearance, theme: t.value })}
                />
                {t.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="fieldset">
            <legend>Page colours</legend>
            {PAGE_COLOURS.map((p) => (
              <label key={p.value} className="radio-label">
                <input
                  type="radio"
                  name="pages"
                  value={p.value}
                  checked={appearance.pages === p.value}
                  onChange={() => onChange({ ...appearance, pages: p.value })}
                />
                {p.label}
              </label>
            ))}
          </fieldset>
          <label className="field-label" htmlFor="appearance-scale">
            Interface size
          </label>
          <select
            id="appearance-scale"
            className="select"
            value={String(appearance.uiScale)}
            aria-describedby="appearance-scale-hint"
            onChange={(e) => onChange({ ...appearance, uiScale: Number(e.target.value) })}
          >
            {UI_SCALES.map((s) => (
              <option key={s} value={String(s)}>
                {percent(s)}
                {s === 1 ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p id="appearance-scale-hint" className="muted small">
            Everything grows or shrinks together, pages included; the page zoom is separate (View › Zoom in).
          </p>
        </div>
      </div>
    </div>
  );
}
