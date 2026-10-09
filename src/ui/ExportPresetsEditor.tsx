import { useId } from "react";
import type { Category } from "../annotations/types";
import { EVERYTHING, type ExportPreset } from "../vault/export";
import { ExportChoices, choicesProblem } from "./ExportChoices";

interface Props {
  presets: ExportPreset[];
  defaultId: string;
  /** The preset being edited (and previewed). */
  selectedId: string;
  categories: readonly Category[];
  onSelect: (id: string) => void;
  onChange: (presets: ExportPreset[], defaultId: string) => void;
}

/** What's wrong with a preset, if anything (Save waits until nothing is). */
export function presetProblem(p: ExportPreset, all: readonly ExportPreset[]): string | null {
  if (!p.name.trim()) return "Give the preset a name.";
  if (all.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase())) {
    return `Another preset is called “${p.name.trim()}”.`;
  }
  return choicesProblem(p);
}

function newName(presets: readonly ExportPreset[]): string {
  const taken = new Set(presets.map((p) => p.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? "New preset" : `New preset ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// Export settings › Presets: named choices of which annotations and how
// they're grouped. Exporting asks each time, starting from the default
// preset (or another one picked there).
export function ExportPresetsEditor({ presets, defaultId, selectedId, categories, onSelect, onChange }: Props) {
  const id = useId();
  const preset = presets.find((p) => p.id === selectedId) ?? presets[0];
  const problem = presetProblem(preset, presets);

  const update = (patch: Partial<ExportPreset>) => onChange(presets.map((p) => (p.id === preset.id ? { ...p, ...patch } : p)), defaultId);

  const addPreset = () => {
    const added: ExportPreset = { id: `p-${Date.now().toString(36)}`, name: newName(presets), filter: EVERYTHING, groupBy: "none" };
    onChange([...presets, added], defaultId);
    onSelect(added.id);
  };
  const deletePreset = () => {
    const rest = presets.filter((p) => p.id !== preset.id);
    onChange(rest, defaultId === preset.id ? rest[0].id : defaultId);
    onSelect(rest[0].id);
  };
  const field = (name: string) => `${id}-${name}`;

  return (
    <fieldset className="fieldset">
      <legend>Presets</legend>
      <div className="preset-row">
        <label className="field-label" htmlFor={field("which")}>
          Preset
        </label>
        <select id={field("which")} className="select" value={preset.id} onChange={(e) => onSelect(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name.trim() || "(no name)"}
              {p.id === defaultId ? " (default)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="button small" onClick={addPreset}>
          New
        </button>
        <button type="button" className="button small" onClick={deletePreset} disabled={presets.length < 2}>
          Delete
        </button>
      </div>

      <label className="field-label" htmlFor={field("name")}>
        Name
      </label>
      <input
        id={field("name")}
        className="text-input"
        value={preset.name}
        aria-invalid={!!problem}
        aria-describedby={problem ? field("problem") : undefined}
        onChange={(e) => update({ name: e.target.value })}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={preset.id === defaultId}
          disabled={preset.id === defaultId}
          onChange={() => onChange(presets, preset.id)}
        />
        What the export starts with
      </label>

      <ExportChoices filter={preset.filter} groupBy={preset.groupBy} categories={categories} onChange={(c) => update(c)} />
      {problem && (
        <p className="field-error" id={field("problem")} role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
