import { useId } from "react";
import type { Category } from "../annotations/types";
import { useShortcutHint } from "../commands/useShortcut";
import { EVERYTHING, EXPORT_KINDS, NO_CATEGORY, type ExportFilter, type ExportGrouping, type ExportPreset } from "../vault/export";

interface Props {
  presets: ExportPreset[];
  defaultId: string;
  /** The preset being edited (and previewed). */
  selectedId: string;
  categories: readonly Category[];
  onSelect: (id: string) => void;
  onChange: (presets: ExportPreset[], defaultId: string) => void;
}

const GROUPINGS: { value: ExportGrouping; label: string }[] = [
  { value: "none", label: "Not grouped (reading order)" },
  { value: "category", label: "By category" },
  { value: "section", label: "By section of the paper (from its outline)" },
];

/** What's wrong with a preset, if anything (Save waits until nothing is). */
export function presetProblem(p: ExportPreset, all: readonly ExportPreset[]): string | null {
  if (!p.name.trim()) return "Give the preset a name.";
  if (all.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase())) {
    return `Another preset is called “${p.name.trim()}”.`;
  }
  if (p.filter.kinds.length === 0) return "Choose at least one kind of annotation.";
  if (p.filter.categories?.length === 0) return "Choose at least one category, or every category.";
  return null;
}

function newName(presets: readonly ExportPreset[]): string {
  const taken = new Set(presets.map((p) => p.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? "New preset" : `New preset ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// Export settings › Presets: named filters and grouping. Export to Obsidian
// uses the default one; with several, each is a command of its own.
export function ExportPresetsEditor({ presets, defaultId, selectedId, categories, onSelect, onChange }: Props) {
  const id = useId();
  const exportHint = useShortcutHint("export.toVault");
  const preset = presets.find((p) => p.id === selectedId) ?? presets[0];
  const problem = presetProblem(preset, presets);

  const update = (patch: Partial<ExportPreset>) => onChange(presets.map((p) => (p.id === preset.id ? { ...p, ...patch } : p)), defaultId);
  const setFilter = (patch: Partial<ExportFilter>) => update({ filter: { ...preset.filter, ...patch } });
  const toggle = <T,>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));

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

  const categoryChoices = [...categories.map((c) => ({ id: c.id, name: c.name, colour: c.colour })), { id: NO_CATEGORY, name: "No category", colour: null }];
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
        Used by Export annotations to Obsidian{exportHint}
      </label>

      <fieldset className="fieldset">
        <legend>Which annotations</legend>
        {EXPORT_KINDS.map((k) => (
          <label key={k.value} className="checkbox">
            <input
              type="checkbox"
              checked={preset.filter.kinds.includes(k.value)}
              onChange={(e) => setFilter({ kinds: toggle(preset.filter.kinds, k.value, e.target.checked) })}
            />
            {k.label}
          </label>
        ))}
        <label className="checkbox">
          <input type="checkbox" checked={preset.filter.withNote} onChange={(e) => setFilter({ withNote: e.target.checked })} />
          Only those with a note
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={preset.filter.includeUnplaced}
            onChange={(e) => setFilter({ includeUnplaced: e.target.checked })}
          />
          Those not found in a new version of the PDF
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={preset.filter.categories === null}
            onChange={(e) => setFilter({ categories: e.target.checked ? null : categoryChoices.map((c) => c.id) })}
          />
          Every category
        </label>
        {preset.filter.categories !== null && (
          <div className="indented" role="group" aria-label="Categories">
            {categoryChoices.map((c) => (
              <label key={c.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={preset.filter.categories!.includes(c.id)}
                  onChange={(e) => setFilter({ categories: toggle(preset.filter.categories!, c.id, e.target.checked) })}
                />
                {c.colour && <span className="swatch small" style={{ background: c.colour }} aria-hidden="true" />}
                {c.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="fieldset">
        <legend>Grouped</legend>
        {GROUPINGS.map((g) => (
          <label key={g.value} className="checkbox">
            <input type="radio" name={field("group")} checked={preset.groupBy === g.value} onChange={() => update({ groupBy: g.value })} />
            {g.label}
          </label>
        ))}
        {preset.groupBy !== "none" && (
          <p className="muted small">Each group gets a subheading one level below the export heading.</p>
        )}
      </fieldset>
      {problem && (
        <p className="field-error" id={field("problem")} role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
