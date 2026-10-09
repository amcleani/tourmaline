import { useId } from "react";
import type { Category } from "../annotations/types";
import { EXPORT_KINDS, NO_CATEGORY, type ExportFilter, type ExportGrouping } from "../vault/export";

export interface Choices {
  filter: ExportFilter;
  groupBy: ExportGrouping;
}

interface Props extends Choices {
  categories: readonly Category[];
  onChange: (next: Choices) => void;
  /** Focus goes here when the form opens. */
  firstRef?: React.Ref<HTMLInputElement>;
}

const GROUPINGS: { value: ExportGrouping; label: string }[] = [
  { value: "none", label: "Not grouped (reading order)" },
  { value: "category", label: "By category" },
  { value: "section", label: "By section of the paper (from its outline)" },
];

/** What's wrong with some choices, if anything: they must let something through. */
export function choicesProblem({ filter }: Choices): string | null {
  if (filter.kinds.length === 0) return "Choose at least one kind of annotation.";
  if (filter.categories?.length === 0) return "Choose at least one category, or every category.";
  return null;
}

// Which annotations an export writes and how they're grouped: in the export
// prompt (each time) and for each preset in Export settings.
export function ExportChoices({ filter, groupBy, categories, onChange, firstRef }: Props) {
  const id = useId();
  const setFilter = (patch: Partial<ExportFilter>) => onChange({ filter: { ...filter, ...patch }, groupBy });
  const toggle = <T,>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));
  const categoryChoices = [
    ...categories.map((c) => ({ id: c.id, name: c.name, colour: c.colour as string | null })),
    { id: NO_CATEGORY, name: "No category", colour: null },
  ];

  return (
    <>
      <fieldset className="fieldset">
        <legend>Which annotations</legend>
        {EXPORT_KINDS.map((k, i) => (
          <label key={k.value} className="checkbox">
            <input
              ref={i === 0 ? firstRef : undefined}
              type="checkbox"
              checked={filter.kinds.includes(k.value)}
              onChange={(e) => setFilter({ kinds: toggle(filter.kinds, k.value, e.target.checked) })}
            />
            {k.label}
          </label>
        ))}
        <label className="checkbox">
          <input type="checkbox" checked={filter.withNote} onChange={(e) => setFilter({ withNote: e.target.checked })} />
          Only those with a note
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={filter.includeUnplaced} onChange={(e) => setFilter({ includeUnplaced: e.target.checked })} />
          Those not found in a new version of the PDF
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filter.categories === null}
            onChange={(e) => setFilter({ categories: e.target.checked ? null : categoryChoices.map((c) => c.id) })}
          />
          Every category
        </label>
        {filter.categories !== null && (
          <div className="indented" role="group" aria-label="Categories">
            {categoryChoices.map((c) => (
              <label key={c.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={filter.categories!.includes(c.id)}
                  onChange={(e) => setFilter({ categories: toggle(filter.categories!, c.id, e.target.checked) })}
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
            <input type="radio" name={`${id}-group`} checked={groupBy === g.value} onChange={() => onChange({ filter, groupBy: g.value })} />
            {g.label}
          </label>
        ))}
        {groupBy !== "none" && <p className="muted small">Each group gets a subheading one level below the export heading.</p>}
      </fieldset>
    </>
  );
}
