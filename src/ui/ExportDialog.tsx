import { useEffect, useId, useRef, useState } from "react";
import type { Annotation, Category } from "../annotations/types";
import { exportable, type ExportPreset } from "../vault/export";
import { ExportChoices, choicesProblem, type Choices } from "./ExportChoices";

interface Props {
  presets: readonly ExportPreset[];
  /** The preset the choices start from. */
  startWith: string;
  categories: readonly Category[];
  /** The paper's annotations, to say how many will be exported. */
  annotations: readonly Annotation[];
  /** The note they go into, relative to the vault. */
  notePath: string | null;
  /** `preset` is the one chosen if the choices are still exactly its own. */
  onExport: (choices: Choices, preset: ExportPreset | null) => void;
  onCancel: () => void;
}

const same = (a: Choices, b: Choices) => JSON.stringify([a.filter, a.groupBy]) === JSON.stringify([b.filter, b.groupBy]);

// Export › Export annotations to Obsidian: which annotations this time and
// how they're grouped, starting from a preset (the default one, or the one
// whose command was used). Enter exports.
export function ExportDialog({ presets, startWith, categories, annotations, notePath, onExport, onCancel }: Props) {
  const id = useId();
  const initial = presets.find((p) => p.id === startWith) ?? presets[0];
  const [presetId, setPresetId] = useState(initial.id);
  const [choices, setChoices] = useState<Choices>({ filter: initial.filter, groupBy: initial.groupBy });
  const exportRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    exportRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const preset = presets.find((p) => p.id === presetId) ?? initial;
  const problem = choicesProblem(choices);
  const total = exportable(annotations).length;
  const count = exportable(annotations, choices.filter).length;
  const field = (name: string) => `${id}-${name}`;

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog export-choices-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={field("title")}
        aria-describedby={field("count")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id={field("title")}>Export to Obsidian</h2>
        </div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) onExport(choices, same(choices, preset) ? preset : null);
          }}
        >
          {presets.length > 1 && (
            <div className="preset-row">
              <label className="field-label" htmlFor={field("preset")}>
                Start from
              </label>
              <select
                id={field("preset")}
                className="select"
                value={preset.id}
                onChange={(e) => {
                  const p = presets.find((x) => x.id === e.target.value) ?? initial;
                  setPresetId(p.id);
                  setChoices({ filter: p.filter, groupBy: p.groupBy });
                }}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!same(choices, p) && p.id === preset.id ? " (changed)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ExportChoices filter={choices.filter} groupBy={choices.groupBy} categories={categories} onChange={setChoices} />
          <p id={field("count")} className="small" role="status">
            {problem ??
              (count === total
                ? `All ${total} annotation${total === 1 ? "" : "s"}`
                : `${count} of ${total} annotations`) +
                (notePath ? ` into ${notePath}` : "") +
                (count === 0 ? ": the section will be empty." : ".")}
          </p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button ref={exportRef} type="submit" className="button primary" disabled={!!problem}>
              Export
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
